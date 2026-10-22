#!/usr/bin/env node
/**
 * Repeatable performance measurements for the QForge compiler and simulator.
 *
 * Numbers printed here are the only numbers that appear in docs/benchmarks.md.
 * Nothing in that document is estimated or extrapolated.
 *
 * Methodology
 *   - Each measurement runs a warm-up pass, then N timed repetitions, and
 *     reports the median. Medians rather than means because a single GC pause
 *     in one repetition should not move the headline number.
 *   - Timing uses `performance.now()`, which is microsecond-resolution here.
 *   - Allocation is measured with `process.memoryUsage().heapUsed` around a
 *     forced GC (run with `--expose-gc`, which `pnpm bench` does).
 *   - The statevector itself lives in two Float64Arrays, which V8 allocates
 *     outside the JS heap, so `external`/`arrayBuffers` is reported too.
 *
 * Usage:  pnpm bench            (or: node --expose-gc scripts/benchmark.mjs)
 *         pnpm bench -- --json
 */
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform, arch, release } from 'node:os';

const ROOT = new URL('..', import.meta.url);

const language = await import(new URL('packages/language/dist/index.js', ROOT).href);
const compiler = await import(new URL('packages/compiler/dist/index.js', ROOT).href);
const simulator = await import(new URL('packages/simulator/dist/index.js', ROOT).href);

const { checkSource, CLI_LIMITS, HARD_MAX_QUBITS, statevectorBytes } = language;
const { compile, lower, optimize, emitOpenQasm3 } = compiler;
const { Statevector, applyInstruction, executeCircuit, HADAMARD, Prng } = simulator;

const wantJson = process.argv.includes('--json');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Time `fn` `repetitions` times after a warm-up, returning the median in ms. */
function measure(fn, repetitions = 7) {
  fn();
  const samples = [];
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function heapUsed() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  const usage = process.memoryUsage();
  return { heap: usage.heapUsed, buffers: usage.arrayBuffers };
}

const results = { environment: {}, sections: {} };

results.environment = {
  node: process.version,
  v8: process.versions.v8,
  platform: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  cores: cpus().length,
  totalMemoryGiB: Number((totalmem() / 1024 ** 3).toFixed(1)),
  exposeGc: typeof globalThis.gc === 'function',
};

// ---------------------------------------------------------------- compiler

const COMPILER_SOURCES = {
  'bell (4 statements)': `
    qubit alice; qubit bob; bit a; bit b;
    h alice; cx alice, bob; measure alice -> a; measure bob -> b;
  `,
  'ghz-10 (31 statements)': (() => {
    const lines = ['qubit[10] q;', 'bit[10] c;', 'h q[0];'];
    for (let i = 1; i < 10; i++) lines.push(`cx q[0], q[${i}];`);
    for (let i = 0; i < 10; i++) lines.push(`measure q[${i}] -> c[${i}];`);
    return lines.join('\n');
  })(),
  'synthetic (1000 gates)': (() => {
    const lines = ['qubit[8] q;'];
    for (let i = 0; i < 1000; i++) {
      const q = i % 8;
      lines.push(i % 3 === 0 ? `rx(pi / ${(i % 7) + 2}) q[${q}];` : `h q[${q}];`);
    }
    return lines.join('\n');
  })(),
  'synthetic (10000 gates)': (() => {
    const lines = ['qubit[8] q;'];
    for (let i = 0; i < 10_000; i++) {
      const q = i % 8;
      lines.push(i % 3 === 0 ? `rz(pi / ${(i % 7) + 2}) q[${q}];` : `h q[${q}];`);
    }
    return lines.join('\n');
  })(),
};

results.sections.frontend = [];
for (const [name, source] of Object.entries(COMPILER_SOURCES)) {
  const frontendMs = measure(() => checkSource(source, { limits: CLI_LIMITS }));
  const checked = checkSource(source, { limits: CLI_LIMITS });
  if (!checked.ok) throw new Error(`benchmark source '${name}' does not compile`);
  const loweringMs = measure(() => lower(checked.semantics));
  const module = lower(checked.semantics);
  const optimizeMs = measure(() => optimize(module));
  const emitMs = measure(() => emitOpenQasm3(module));
  const endToEndMs = measure(() => compile(source, { limits: CLI_LIMITS }));

  results.sections.frontend.push({
    name,
    bytes: source.length,
    statements: checked.semantics.operations.length,
    frontendMs,
    loweringMs,
    optimizeMs,
    emitMs,
    endToEndMs,
    statementsPerSecond: Math.round(checked.semantics.operations.length / (frontendMs / 1000)),
  });
}

// ------------------------------------------------------- gate kernels

results.sections.kernels = [];
for (let n = 4; n <= 20; n += 2) {
  const state = Statevector.zeroState(n);
  const gates = 100;

  const hadamardMs = measure(() => {
    for (let i = 0; i < gates; i++) state.applyMatrix(i % n, HADAMARD);
  }, 5);

  const cxMs = measure(() => {
    for (let i = 0; i < gates; i++) state.applyCx(i % n, (i + 1) % n);
  }, 5);

  results.sections.kernels.push({
    qubits: n,
    amplitudes: 2 ** n,
    bytes: statevectorBytes(n),
    hadamardUsPerGate: (hadamardMs * 1000) / gates,
    cxUsPerGate: (cxMs * 1000) / gates,
    hadamardAmplitudesPerSecond: Math.round((gates * 2 ** n) / (hadamardMs / 1000)),
  });
}

// ------------------------------------------------------- whole circuits

function ghzModule(n) {
  const lines = [`qubit[${n}] q;`, `bit[${n}] c;`, 'h q[0];'];
  for (let i = 1; i < n; i++) lines.push(`cx q[0], q[${i}];`);
  for (let i = 0; i < n; i++) lines.push(`measure q[${i}] -> c[${i}];`);
  const result = compile(lines.join('\n'), {
    limits: { ...CLI_LIMITS, maxQubits: HARD_MAX_QUBITS },
  });
  if (!result.ok) throw new Error(`ghz-${n} does not compile`);
  return result.module;
}

/** A dense circuit: `layers` layers of single-qubit gates plus a CX ladder. */
function denseModule(n, layers) {
  const lines = [`qubit[${n}] q;`];
  for (let layer = 0; layer < layers; layer++) {
    for (let q = 0; q < n; q++) lines.push(`h q[${q}];`);
    for (let q = 0; q + 1 < n; q++) lines.push(`cx q[${q}], q[${q + 1}];`);
  }
  const result = compile(lines.join('\n'), {
    limits: { ...CLI_LIMITS, maxQubits: HARD_MAX_QUBITS },
  });
  if (!result.ok) throw new Error(`dense-${n} does not compile`);
  return result.module;
}

results.sections.circuits = [];
for (let n = 8; n <= 20; n += 2) {
  const module = denseModule(n, 10);
  const gates = module.instructions.length;
  const before = heapUsed();
  const ms = measure(() => {
    const state = Statevector.zeroState(n);
    for (const instruction of module.instructions) applyInstruction(state, instruction);
  }, 5);
  const after = heapUsed();

  results.sections.circuits.push({
    qubits: n,
    gates,
    ms,
    usPerGate: (ms * 1000) / gates,
    statevectorBytes: statevectorBytes(n),
    heapDeltaBytes: after.heap - before.heap,
    bufferDeltaBytes: after.buffers - before.buffers,
  });
}

// ------------------------------------------------------- shot sampling

results.sections.sampling = [];
for (const shots of [1, 1_000, 100_000, 1_000_000]) {
  const module = ghzModule(12);
  const ms = measure(() => executeCircuit(module, { shots, seed: 1 }), 3);
  results.sections.sampling.push({
    qubits: 12,
    shots,
    ms,
    shotsPerSecond: Math.round(shots / (ms / 1000)),
    strategy: executeCircuit(module, { shots: 1, seed: 1 }).strategy,
  });
}

// Replay path, which is inherently far slower.
{
  const result = compile(
    'qubit q; bit[2] c; h q; measure q -> c[0]; reset q; h q; measure q -> c[1];',
    { limits: CLI_LIMITS },
  );
  for (const shots of [1_000, 10_000]) {
    const ms = measure(() => executeCircuit(result.module, { shots, seed: 1 }), 3);
    results.sections.sampling.push({
      qubits: 1,
      shots,
      ms,
      shotsPerSecond: Math.round(shots / (ms / 1000)),
      strategy: 'per-shot-replay',
    });
  }
}

// ------------------------------------------------------- PRNG

{
  const rng = new Prng(1);
  const draws = 5_000_000;
  const ms = measure(() => {
    let sink = 0;
    for (let i = 0; i < draws; i++) sink += rng.nextFloat();
    if (sink < 0) throw new Error('unreachable');
  }, 3);
  results.sections.prng = { draws, ms, drawsPerSecond: Math.round(draws / (ms / 1000)) };
}

// ------------------------------------------------------- memory ceiling

results.sections.memory = [];
for (const n of [10, 14, 18, 20, 22, 24, 26]) {
  results.sections.memory.push({
    qubits: n,
    amplitudes: 2 ** n,
    bytes: statevectorBytes(n),
    humanBytes:
      statevectorBytes(n) >= 1024 ** 3
        ? `${(statevectorBytes(n) / 1024 ** 3).toFixed(2)} GiB`
        : `${(statevectorBytes(n) / 1024 ** 2).toFixed(2)} MiB`,
  });
}

// ---------------------------------------------------------------- output

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const e = results.environment;
  const fixed = (x, d = 3) => x.toFixed(d);

  console.log('# QForge benchmark results\n');
  console.log('## Environment\n');
  console.log(`- CPU: ${e.cpu} (${e.cores} logical cores)`);
  console.log(`- Memory: ${e.totalMemoryGiB} GiB`);
  console.log(`- OS: ${e.platform}`);
  console.log(`- Node: ${e.node} (V8 ${e.v8})`);
  console.log(`- \`--expose-gc\`: ${e.exposeGc ? 'yes' : 'no (heap deltas are unreliable)'}`);
  console.log('\nMedian of 7 timed repetitions after a warm-up, unless noted.\n');

  console.log('## Compiler frontend\n');
  console.log(
    '| Program | Bytes | Ops | Frontend (ms) | Lower (ms) | Optimise (ms) | Emit QASM (ms) | End to end (ms) | Ops/s |',
  );
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results.sections.frontend) {
    console.log(
      `| ${r.name} | ${r.bytes} | ${r.statements} | ${fixed(r.frontendMs)} | ${fixed(r.loweringMs)} | ${fixed(r.optimizeMs)} | ${fixed(r.emitMs)} | ${fixed(r.endToEndMs)} | ${r.statementsPerSecond.toLocaleString()} |`,
    );
  }

  console.log('\n## Gate kernels (microseconds per gate, median of 5 x 100 gates)\n');
  console.log('| Qubits | Amplitudes | Statevector | H (us) | CX (us) | H amplitudes/s |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  for (const r of results.sections.kernels) {
    const size =
      r.bytes >= 1024 ** 2
        ? `${(r.bytes / 1024 ** 2).toFixed(1)} MiB`
        : `${(r.bytes / 1024).toFixed(0)} KiB`;
    console.log(
      `| ${r.qubits} | ${r.amplitudes.toLocaleString()} | ${size} | ${fixed(r.hadamardUsPerGate)} | ${fixed(r.cxUsPerGate)} | ${r.hadamardAmplitudesPerSecond.toLocaleString()} |`,
    );
  }

  console.log('\n## Whole circuits (10 layers of H plus a CX ladder)\n');
  console.log('| Qubits | Gates | Total (ms) | Per gate (us) | Statevector |');
  console.log('|---:|---:|---:|---:|---:|');
  for (const r of results.sections.circuits) {
    const size =
      r.statevectorBytes >= 1024 ** 2
        ? `${(r.statevectorBytes / 1024 ** 2).toFixed(1)} MiB`
        : `${(r.statevectorBytes / 1024).toFixed(0)} KiB`;
    console.log(
      `| ${r.qubits} | ${r.gates} | ${fixed(r.ms)} | ${fixed(r.usPerGate)} | ${size} |`,
    );
  }

  console.log('\n## Shot sampling\n');
  console.log('| Qubits | Shots | Strategy | Total (ms) | Shots/s |');
  console.log('|---:|---:|---|---:|---:|');
  for (const r of results.sections.sampling) {
    console.log(
      `| ${r.qubits} | ${r.shots.toLocaleString()} | ${r.strategy} | ${fixed(r.ms)} | ${r.shotsPerSecond.toLocaleString()} |`,
    );
  }

  const p = results.sections.prng;
  console.log(
    `\n## PRNG\n\n${p.draws.toLocaleString()} doubles in ${fixed(p.ms)} ms = ${p.drawsPerSecond.toLocaleString()} draws/s\n`,
  );

  console.log('## Memory required by qubit count\n');
  console.log('| Qubits | Amplitudes | Statevector (re + im, f64) |');
  console.log('|---:|---:|---:|');
  for (const r of results.sections.memory) {
    console.log(`| ${r.qubits} | ${r.amplitudes.toLocaleString()} | ${r.humanBytes} |`);
  }
}
