#!/usr/bin/env node
/**
 * Run the Qiskit cross-validation and print a report.
 *
 *   pnpm --filter @qforge/validation setup      # once, creates .venv
 *   pnpm --filter @qforge/validation validate
 *
 * Exits non-zero if any *mathematical* comparison fails. Interoperability
 * failures are reported in a compatibility matrix but do not fail the run:
 * an OpenQASM 3 construct Qiskit's importer does not support says nothing
 * about whether QForge's physics is right, and conflating the two would make
 * the signal useless.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportCases } from './src/export.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// CI already has Qiskit on the system Python, so it points here rather than
// paying to build a venv that would only duplicate it.
const PYTHON = process.env.QFORGE_VALIDATION_PYTHON ?? `${HERE}.venv/bin/python`;
const wantJson = process.argv.includes('--json');

if (!process.env.QFORGE_VALIDATION_PYTHON && !existsSync(PYTHON)) {
  console.error(
    'The validation environment is missing.\n' +
      'Run: pnpm --filter @qforge/validation setup\n\n' +
      'Qiskit is a development-time oracle, not a dependency of QForge: nothing\n' +
      'in the compiler, simulator, CLI or studio imports it, and `pnpm test`\n' +
      'passes without it.',
  );
  process.exit(2);
}

const payload = exportCases();

const result = spawnSync(PYTHON, [`${HERE}src/compare.py`], {
  input: JSON.stringify(payload),
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

if (result.status !== 0) {
  console.error(`The Qiskit comparison failed (exit ${result.status}):`);
  console.error(result.stderr);
  process.exit(3);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('Could not parse the comparison output:');
  console.error(result.stdout.slice(0, 4000));
  console.error(result.stderr.slice(0, 4000));
  process.exit(3);
}

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const exponent = (x) => (x === 0 ? '0' : x.toExponential(2));
let mathematicalFailures = 0;

console.log('# QForge vs Qiskit\n');
console.log(
  `Qiskit ${report.versions.qiskit}, NumPy ${report.versions.numpy}, Python ${report.versions.python}`,
);
console.log(
  `Tolerances: amplitude ${exponent(report.tolerances.amplitude)}, probability ${exponent(report.tolerances.probability)}\n`,
);

console.log('## Unitary evolution (statevector, global phase included)\n');
console.log('| Case | max |dA| | optimised | passes preserve operator |');
console.log('|---|---:|---:|---:|');
for (const entry of report.unitary) {
  if (entry.error) {
    mathematicalFailures++;
    console.log(`| ${entry.name} | ERROR | ${entry.error} | |`);
    continue;
  }
  const marks = [entry.direct, entry.optimised, entry.optimiserPreservesOperator];
  if (marks.some((m) => !m.ok)) mathematicalFailures++;
  console.log(
    `| ${entry.name} | ${exponent(entry.direct.maxAmplitudeDifference)} | ${exponent(entry.optimised.maxAmplitudeDifference)} | ${exponent(entry.optimiserPreservesOperator.maxAmplitudeDifference)} |`,
  );
}

console.log('\n## Exact measurement distributions\n');
console.log('| Case | max |dP| | worst outcome | support |');
console.log('|---|---:|---|---|');
for (const entry of report.distribution) {
  if (entry.error) {
    mathematicalFailures++;
    console.log(`| ${entry.name} | ERROR | ${entry.error} | |`);
    continue;
  }
  const c = entry.comparison;
  if (!c.ok) mathematicalFailures++;
  console.log(
    `| ${entry.name} | ${exponent(c.maxProbabilityDifference)} | ${c.worstOutcome ?? '-'} | ${c.support.join(', ')} |`,
  );
}

console.log('\n## Circuits with measurement-dependent evolution\n');
console.log('| Case | shots | total variation | within 0.01 |');
console.log('|---|---:|---:|---|');
for (const entry of report.stochastic) {
  if (entry.error || entry.qiskitSupported === false) {
    console.log(
      `| ${entry.name} | ${entry.shots} | - | not comparable: ${entry.error ?? ''} |`,
    );
    continue;
  }
  if (!entry.ok) mathematicalFailures++;
  console.log(
    `| ${entry.name} | ${entry.shots.toLocaleString()} | ${entry.totalVariationDistance.toFixed(5)} | ${entry.ok ? 'yes' : 'NO'} |`,
  );
}

console.log('\n## Interoperability: Qiskit reading QForge-generated OpenQASM 3\n');
const loaded = report.interop.filter((e) => e.loads);
const notLoaded = report.interop.filter((e) => !e.loads);
console.log(`${loaded.length} of ${report.interop.length} generated files load into Qiskit.\n`);
if (notLoaded.length > 0) {
  console.log('| Case | group | reason |');
  console.log('|---|---|---|');
  for (const entry of notLoaded) {
    console.log(`| ${entry.name} | ${entry.group} | ${entry.error} |`);
  }
  console.log('');
}
const interopMismatch = loaded.filter((e) => e.comparison && e.comparison.ok === false);
if (interopMismatch.length > 0) {
  console.log('Loaded but disagreed:\n');
  for (const entry of interopMismatch) {
    console.log(`  ${entry.name}: ${JSON.stringify(entry.comparison)}`);
  }
  console.log('');
}

writeFileSync(`${HERE}report.json`, JSON.stringify(report, null, 2));
console.log(`Full report written to packages/validation/report.json`);

if (mathematicalFailures > 0) {
  console.error(`\n${mathematicalFailures} mathematical comparison(s) failed.`);
  process.exit(1);
}
console.log('\nAll mathematical comparisons agree with Qiskit.');
