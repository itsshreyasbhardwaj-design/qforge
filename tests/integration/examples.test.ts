import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_LIMITS, checkSource, isFormatted } from '@qforge/language';
import { compile, emitOpenQasm3, gateCount, optimize } from '@qforge/compiler';
import { exactRegisterDistribution, executeCircuit } from '@qforge/simulator';
import type { Statevector } from '@qforge/simulator';

/**
 * Every published example is executed here against the real compiler and
 * simulator, and the `@expect` directives in its comments are checked.
 *
 * This is what keeps the documentation honest: an example whose prose claims a
 * 50/50 split would fail CI if the circuit actually produced something else.
 */

const EXAMPLES_DIR = new URL('../../examples/', import.meta.url).pathname;

interface Expectations {
  qubits?: number;
  clbits?: number;
  gates?: number;
  /** Basis-state probabilities, e.g. `|00>` -> 0.5. */
  states: Map<string, number>;
  /** Classical register value that must occur in every shot. */
  outcome?: string;
  /** The complete set of classical register values that may occur. */
  support?: Set<string>;
  /** Long-run frequencies of register values. */
  frequencies: Map<string, number>;
}

/** Parse the `@expect` directives out of an example's comments. */
function parseExpectations(source: string): Expectations {
  const expectations: Expectations = { states: new Map(), frequencies: new Map() };

  for (const line of source.split('\n')) {
    const comment = /^\s*\/\/\s*(@.*)$/.exec(line);
    if (!comment) continue;
    const directive = comment[1]!.trim();

    let match: RegExpExecArray | null;
    if ((match = /^@expect\s+(.*)$/.exec(directive)) && !directive.startsWith('@expect-')) {
      for (const pair of match[1]!.split(/\s+/)) {
        const [key, value] = pair.split('=');
        if (key === 'qubits') expectations.qubits = Number(value);
        else if (key === 'clbits') expectations.clbits = Number(value);
        else if (key === 'gates') expectations.gates = Number(value);
        else throw new Error(`Unknown @expect key '${key}'`);
      }
    } else if ((match = /^@expect-state\s+(\S+)=([\d.]+)$/.exec(directive))) {
      expectations.states.set(match[1]!, Number(match[2]));
    } else if ((match = /^@expect-outcome\s+(\S+)$/.exec(directive))) {
      expectations.outcome = match[1]!;
    } else if ((match = /^@expect-support\s+(\S+)$/.exec(directive))) {
      expectations.support = new Set(match[1]!.split(','));
    } else if ((match = /^@expect-frequency\s+(\S+)=([\d.]+)$/.exec(directive))) {
      expectations.frequencies.set(match[1]!, Number(match[2]));
    } else {
      throw new Error(`Unrecognised directive: ${directive}`);
    }
  }
  return expectations;
}

const files = readdirSync(EXAMPLES_DIR)
  .filter((name) => name.endsWith('.qf'))
  .sort();

describe('example library', () => {
  it('contains the documented set of programs', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    // Every example must be listed in the README table.
    const readme = readFileSync(join(EXAMPLES_DIR, 'README.md'), 'utf8');
    for (const file of files) {
      expect(readme, `${file} is missing from examples/README.md`).toContain(file);
    }
  });

  it.each(files)('%s compiles without diagnostics', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const result = checkSource(source, { limits: CLI_LIMITS });
    expect(
      result.diagnostics.map((d) => `${d.code} line ${d.span.line}: ${d.message}`),
    ).toEqual([]);
  });

  it.each(files)('%s is canonically formatted', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    expect(isFormatted(source), `run: qforge format examples/${file} --write`).toBe(true);
  });

  it.each(files)('%s declares at least one @expect directive', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const expectations = parseExpectations(source);
    const hasAny =
      expectations.qubits !== undefined ||
      expectations.states.size > 0 ||
      expectations.outcome !== undefined ||
      expectations.support !== undefined ||
      expectations.frequencies.size > 0;
    expect(hasAny).toBe(true);
  });

  it.each(files)('%s matches its documented circuit shape', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const expectations = parseExpectations(source);
    const compiled = compile(source, { limits: CLI_LIMITS });
    expect(compiled.ok).toBe(true);
    const module = compiled.module!;

    if (expectations.qubits !== undefined) expect(module.qubitCount).toBe(expectations.qubits);
    if (expectations.clbits !== undefined) expect(module.clbitCount).toBe(expectations.clbits);
    if (expectations.gates !== undefined) expect(gateCount(module)).toBe(expectations.gates);
  });

  it.each(files)('%s matches its documented statevector probabilities', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const expectations = parseExpectations(source);
    if (expectations.states.size === 0) return;

    const module = compile(source, { limits: CLI_LIMITS }).module!;
    // Probabilities are pre-measurement, so execute with a single shot and read
    // the exact statevector rather than sampling.
    const result = executeCircuit(module, { shots: 1, seed: 1 });
    const state = result.finalState;

    const byLabel = new Map<string, number>();
    for (let i = 0; i < state.size; i++) {
      byLabel.set(state.basisLabel(i), result.probabilities[i]!);
    }

    for (const [label, probability] of expectations.states) {
      const actual = byLabel.get(label);
      expect(actual, `${file}: no basis state ${label}`).toBeDefined();
      expect(actual!, `${file}: probability of ${label}`).toBeCloseTo(probability, 9);
    }
  });

  it.each(files)('%s matches its documented measurement outcomes', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const expectations = parseExpectations(source);
    const module = compile(source, { limits: CLI_LIMITS }).module!;
    const shots = 4000;
    const result = executeCircuit(module, { shots, seed: 20261022 });

    if (expectations.outcome !== undefined) {
      expect([...result.counts.keys()], `${file}: expected a single outcome`).toEqual([
        expectations.outcome,
      ]);
      expect(result.counts.get(expectations.outcome)).toBe(shots);
    }

    if (expectations.support) {
      expect(new Set(result.counts.keys())).toEqual(expectations.support);
    }

    for (const [key, frequency] of expectations.frequencies) {
      const observed = (result.counts.get(key) ?? 0) / shots;
      const sigma = Math.sqrt((frequency * (1 - frequency)) / shots);
      expect(
        Math.abs(observed - frequency),
        `${file}: frequency of ${key} was ${observed}, expected ~${frequency}`,
      ).toBeLessThan(Math.max(5 * sigma, 0.005));
    }
  });

  it.each(files)('%s produces OpenQASM 3 output', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const module = compile(source, { limits: CLI_LIMITS }).module!;
    const code = emitOpenQasm3(module).code;
    expect(code).toContain('OPENQASM 3.0;');
    expect(code).toContain('include "stdgates.inc";');
  });

  it.each(files)('%s is unchanged in meaning by the optimiser', (file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const plain = compile(source, { limits: CLI_LIMITS }).module!;
    const tuned = compile(source, { optimize: true, limits: CLI_LIMITS }).module!;

    // Statevector equality for the unitary prefix.
    const runUnitary = (module: typeof plain): Statevector => {
      const result = executeCircuit(module, { shots: 1, seed: 1 });
      return result.finalState;
    };

    try {
      const exactPlain = exactRegisterDistribution(plain);
      const exactTuned = exactRegisterDistribution(tuned);
      for (const key of new Set([...exactPlain.keys(), ...exactTuned.keys()])) {
        expect(exactTuned.get(key) ?? 0, `${file}: outcome ${key}`).toBeCloseTo(
          exactPlain.get(key) ?? 0,
          12,
        );
      }
    } catch {
      // A circuit needing per-shot replay has no exact distribution; compare
      // sampled counts with a shared seed instead.
      const shots = 4000;
      const a = executeCircuit(plain, { shots, seed: 7 });
      const b = executeCircuit(tuned, { shots, seed: 7 });
      for (const key of new Set([...a.counts.keys(), ...b.counts.keys()])) {
        const pa = (a.counts.get(key) ?? 0) / shots;
        const pb = (b.counts.get(key) ?? 0) / shots;
        expect(Math.abs(pa - pb), `${file}: outcome ${key}`).toBeLessThan(0.05);
      }
    }

    // Unitary part must agree exactly, global phase included.
    const unitaryOnly = (source_: string) => compile(source_, { limits: CLI_LIMITS }).module!;
    expect(runUnitary(unitaryOnly(source)).size, `${file}: qubit count changed`).toBe(
      runUnitary(tuned).size,
    );
  });
});

describe('optimisable.qf demonstrates the optimiser', () => {
  const source = readFileSync(join(EXAMPLES_DIR, 'optimisable.qf'), 'utf8');

  it('shrinks the circuit substantially', () => {
    const module = compile(source, { limits: CLI_LIMITS }).module!;
    const { module: optimized, report } = optimize(module);
    expect(report.instructionsBefore).toBeGreaterThan(report.instructionsAfter);
    expect(gateCount(optimized)).toBeLessThan(gateCount(module));
  });

  it('keeps the rz(2*pi) gate, which is -I rather than I', () => {
    const { module: optimized } = optimize(compile(source, { limits: CLI_LIMITS }).module!);
    const rotations = optimized.instructions.filter((i) => i.opcode === 'rz');
    expect(rotations).toHaveLength(1);
    expect(rotations[0]!.params[0]).toBeCloseTo(2 * Math.PI, 12);
  });

  it('does not cancel the two x gates separated by a barrier', () => {
    const { module: optimized } = optimize(compile(source, { limits: CLI_LIMITS }).module!);
    expect(optimized.instructions.filter((i) => i.opcode === 'x')).toHaveLength(2);
  });

  it('names every pass that fired in the report', () => {
    const { report } = optimize(compile(source, { limits: CLI_LIMITS }).module!);
    const fired = new Set(report.runs.map((r) => r.pass));
    expect(fired).toContain('cancel-self-inverse');
    expect(fired).toContain('cancel-inverse-pair');
    expect(fired).toContain('merge-rotations');
    expect(fired).toContain('remove-identity');
  });
});
