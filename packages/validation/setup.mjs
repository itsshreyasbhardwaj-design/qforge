#!/usr/bin/env node
/**
 * Create the isolated Python environment the Qiskit comparison needs.
 *
 * Kept out of `pnpm install` on purpose: Qiskit is a development-time *oracle*,
 * not a dependency of QForge. Nothing in the compiler, simulator, CLI or studio
 * imports it, and `pnpm test` passes without it. This script exists so that
 * reproducing the validation report is one command rather than a paragraph of
 * instructions.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const VENV = `${HERE}.venv`;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: HERE, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n'${command} ${args.join(' ')}' failed with status ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;

if (hasUv) {
  if (!existsSync(VENV)) run('uv', ['venv', '--python', '3.12', '.venv']);
  run('uv', ['pip', 'install', '--python', `${VENV}/bin/python`, '-r', 'requirements.txt']);
} else {
  console.log('uv not found, falling back to python3 -m venv');
  if (!existsSync(VENV)) run('python3', ['-m', 'venv', '.venv']);
  run(`${VENV}/bin/python`, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt']);
}

console.log('\nValidation environment ready. Run: pnpm --filter @qforge/validation validate');
