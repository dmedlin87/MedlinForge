import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createWindowsBuildEnv } from './windows-build-env.mjs';

const { env, notes } = createWindowsBuildEnv();
const issues = [];
const info = [];

if (process.platform !== 'win32') {
  console.error('doctor:windows only applies to Windows builder machines.');
  process.exit(1);
}

const cargoBinDir = join(homedir(), '.cargo', 'bin');
const cargoExePath = join(cargoBinDir, 'cargo.exe');

for (const note of notes) {
  info.push(note);
}

function run(command, args) {
  return spawnSync(command, args, {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function formatVersionOutput(output) {
  return output.split(/\r?\n/).find(Boolean) ?? output.trim();
}

function checkCommand(label, command, args = ['--version']) {
  const result = run(command, args);

  if (result.error || result.status !== 0) {
    issues.push(`${label}: missing or not runnable in this shell`);
    return;
  }

  const summary = formatVersionOutput(result.stdout || result.stderr || 'available');
  info.push(`${label}: ${summary}`);
}

function checkLinker() {
  const result = run('where.exe', ['link.exe']);

  if (!result.error && result.status === 0) {
    const matches = (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (matches.length > 0) {
      info.push(`MSVC linker: ${matches[0]}`);
      return;
    }
  }

  const vswherePath = join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

  if (!existsSync(vswherePath)) {
    issues.push('MSVC tools: Visual Studio Build Tools not found. Install Desktop development with C++ and an MSVC v143 toolset.');
    return;
  }

  const installResult = spawnSync(
    vswherePath,
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { env, encoding: 'utf8' },
  );

  const installationPath = (installResult.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!installationPath) {
    issues.push('MSVC tools: x64/x86 C++ build tools were not found. Install Desktop development with C++ and an MSVC v143 toolset.');
    return;
  }

  info.push(`MSVC tools installed at ${installationPath}`);
}

console.log('BronzeForge Windows build doctor');
console.log('');

checkCommand('Node.js', 'node');
checkCommand('npm', 'npm');

if (existsSync(cargoExePath)) {
  info.push(`Cargo install detected at ${cargoExePath}`);
} else {
  issues.push(`Cargo install not found at ${cargoExePath}`);
}

checkCommand('cargo', 'cargo');
checkCommand('rustc', 'rustc');
checkCommand('rustup', 'rustup');
checkCommand('Tauri CLI', 'tauri');
checkLinker();

for (const line of info) {
  console.log(`OK   ${line}`);
}

if (issues.length > 0) {
  console.log('');
  console.log('Problems detected:');

  for (const issue of issues) {
    console.log(`FAIL ${issue}`);
  }

  console.log('');
  console.log('Expected builder setup: Rust, Cargo, Tauri CLI, and Visual Studio Build Tools with Desktop development with C++.');
  process.exit(1);
}

console.log('');
console.log('Environment looks ready for Tauri development and packaging on Windows.');