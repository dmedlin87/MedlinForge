import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

function prependCargoBin(env, notes) {
  const cargoBinDir = join(homedir(), '.cargo', 'bin');
  const cargoExePath = join(cargoBinDir, 'cargo.exe');
  const currentPath = env.Path ?? env.PATH ?? '';

  if (existsSync(cargoExePath) && !currentPath.toLowerCase().includes(cargoBinDir.toLowerCase())) {
    env.Path = currentPath ? `${cargoBinDir}${delimiter}${currentPath}` : cargoBinDir;
    env.PATH = env.Path;
    notes.push(`Prepended Cargo bin directory for this process: ${cargoBinDir}`);
  }
}

function loadVisualStudioEnvironment(env, notes) {
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswherePath = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

  if (!existsSync(vswherePath)) {
    return;
  }

  const installResult = spawnSync(
    vswherePath,
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Workload.VCTools', '-property', 'installationPath'],
    { env, encoding: 'utf8' },
  );

  if (installResult.status !== 0) {
    return;
  }

  const installationPath = (installResult.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!installationPath) {
    return;
  }

  const vsDevCmdPath = join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat');

  if (!existsSync(vsDevCmdPath)) {
    return;
  }

  const command = `"\"${vsDevCmdPath}\" -arch=x64 -host_arch=x64 >nul && set"`;
  const envResult = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
    env,
    encoding: 'utf8',
  });

  if (envResult.status !== 0) {
    return;
  }

  for (const line of (envResult.stdout || '').split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    env[key] = value;

    if (key.toUpperCase() === 'PATH') {
      env.Path = value;
      env.PATH = value;
    }
  }

  notes.push(`Loaded Visual Studio build environment from ${vsDevCmdPath}`);
}

export function createWindowsBuildEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const notes = [];

  if (process.platform !== 'win32') {
    return { env, notes };
  }

  prependCargoBin(env, notes);
  loadVisualStudioEnvironment(env, notes);

  return { env, notes };
}