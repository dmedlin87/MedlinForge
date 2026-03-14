import { spawnSync } from 'node:child_process';
import { createWindowsBuildEnv } from './windows-build-env.mjs';

const tauriArgs = process.argv.slice(2);

if (tauriArgs.length === 0) {
  console.error('Usage: node scripts/tauri-runner.mjs <tauri-args>');
  process.exit(1);
}

const { env } = createWindowsBuildEnv();

const tauriCommand = process.platform === 'win32' ? 'tauri' : 'tauri';
const result = spawnSync(tauriCommand, tauriArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error('Unable to find the Tauri CLI. Install it or ensure the `tauri` command is on PATH.');
  } else {
    console.error(result.error.message);
  }

  process.exit(1);
}

process.exit(result.status ?? 0);