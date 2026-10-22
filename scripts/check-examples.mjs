#!/usr/bin/env node
/**
 * Run every published example through the built CLI and report the result.
 *
 * The authoritative check is `tests/integration/examples.test.ts`, which
 * verifies each example's `@expect` directives against the compiler and
 * simulator. This script exists for two other reasons: it exercises the *built*
 * CLI rather than the sources, and its output is a readable summary suitable
 * for a demo or a release check.
 *
 * Usage:  pnpm examples
 */
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const EXAMPLES = join(ROOT, 'examples');

/** The `@expect-outcome` directive, if the example declares one. */
function expectedOutcome(source) {
  const match = /^\s*\/\/\s*@expect-outcome\s+(\S+)\s*$/m.exec(source);
  return match ? match[1] : undefined;
}

const files = readdirSync(EXAMPLES)
  .filter((name) => name.endsWith('.qf'))
  .sort();

let failures = 0;
console.log(`Checking ${files.length} examples with the built CLI\n`);

for (const file of files) {
  const path = join(EXAMPLES, file);
  const source = readFileSync(path, 'utf8');
  const label = file.padEnd(30);

  try {
    await execFileAsync(process.execPath, [CLI, 'check', path], { cwd: ROOT });
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label} did not compile`);
    console.log(
      String(error.stderr ?? error)
        .split('\n')
        .map((l) => `          ${l}`)
        .join('\n'),
    );
    continue;
  }

  let payload;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI, 'run', path, '--shots', '2000', '--seed', '20261022', '--json'],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    payload = JSON.parse(stdout);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label} did not run: ${String(error.stderr ?? error).trim()}`);
    continue;
  }

  const outcomes = Object.entries(payload.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => `${key || '(none)'}=${((count / payload.shots) * 100).toFixed(1)}%`)
    .join('  ');

  const expected = expectedOutcome(source);
  const keys = Object.keys(payload.counts);
  const deterministicMismatch =
    expected !== undefined && (keys.length !== 1 || keys[0] !== expected);

  // `qforge format --check` exits 1 when the file is not canonically formatted.
  let formatted = true;
  try {
    await execFileAsync(process.execPath, [CLI, 'format', path, '--check'], { cwd: ROOT });
  } catch {
    formatted = false;
  }

  if (deterministicMismatch || !formatted) {
    failures++;
    const reasons = [];
    if (deterministicMismatch)
      reasons.push(`expected only '${expected}', got ${keys.join(',')}`);
    if (!formatted) reasons.push('not canonically formatted');
    console.log(`  FAIL  ${label} ${reasons.join('; ')}`);
    continue;
  }

  console.log(
    `  ok    ${label} ${String(payload.qubits).padStart(2)}q ${payload.strategy.padEnd(18)} ${outcomes}`,
  );
}

console.log();
if (failures > 0) {
  console.error(`${failures} example(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`All ${files.length} examples compile, run and are canonically formatted.`);
}
