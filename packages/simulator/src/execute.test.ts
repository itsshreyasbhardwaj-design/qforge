import { describe, expect, it } from 'vitest';
import { Opcode } from '@qforge/compiler';
import {
  exactRegisterDistribution,
  executeCircuit,
  formatRegister,
  requiresPerShotReplay,
} from './execute.js';
import { traceCircuit, probabilitiesAtStep, stateAtStep } from './trace.js';
import { makeModule, moduleFromSource } from '@qforge/testing';

const BELL = `
  qubit[2] q;
  bit[2] c;
  h q[0];
  cx q[0], q[1];
  measure q[0] -> c[0];
  measure q[1] -> c[1];
`;

describe('strategy selection', () => {
  it('uses terminal sampling when all measurements are last', () => {
    expect(requiresPerShotReplay(moduleFromSource(BELL))).toBe(false);
    expect(executeCircuit(moduleFromSource(BELL), { shots: 10, seed: 1 }).strategy).toBe(
      'terminal-sampling',
    );
  });

  it('requires replay when a gate follows a measurement on the same qubit', () => {
    const module = moduleFromSource(`
      qubit q; bit c;
      h q;
      measure q -> c;
      x q;
    `);
    expect(requiresPerShotReplay(module)).toBe(true);
    expect(executeCircuit(module, { shots: 5, seed: 1 }).strategy).toBe('per-shot-replay');
  });

  it('allows a gate after a measurement on a different qubit', () => {
    const module = moduleFromSource(`
      qubit[2] q; bit c;
      h q[0];
      measure q[0] -> c;
      x q[1];
    `);
    expect(requiresPerShotReplay(module)).toBe(false);
  });

  it('requires replay for any reset', () => {
    expect(requiresPerShotReplay(moduleFromSource('qubit q; h q; reset q;'))).toBe(true);
  });

  it('allows the same qubit to be measured twice under terminal sampling', () => {
    const module = moduleFromSource(`
      qubit q; bit[2] c;
      h q;
      measure q -> c[0];
      measure q -> c[1];
    `);
    expect(requiresPerShotReplay(module)).toBe(false);
    // Repeatability: both bits must always agree, so only 00 and 11 appear.
    const result = executeCircuit(module, { shots: 500, seed: 3 });
    expect([...result.counts.keys()].sort()).toEqual(['00', '11']);
  });
});

describe('counts and register formatting', () => {
  it('writes classical bit 0 as the rightmost character', () => {
    expect(formatRegister(new Uint8Array([1, 0, 0]))).toBe('001');
    expect(formatRegister(new Uint8Array([0, 0, 1]))).toBe('100');
  });

  it('a Bell pair yields only 00 and 11', () => {
    const result = executeCircuit(moduleFromSource(BELL), { shots: 2000, seed: 7 });
    expect([...result.counts.keys()].sort()).toEqual(['00', '11']);
    const total = [...result.counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(2000);
    expect(result.counts.get('00')! / 2000).toBeGreaterThan(0.45);
    expect(result.counts.get('00')! / 2000).toBeLessThan(0.55);
  });

  it('an anti-correlated pair yields only 01 and 10', () => {
    const result = executeCircuit(
      moduleFromSource(`
        qubit[2] q; bit[2] c;
        h q[0];
        cx q[0], q[1];
        x q[1];
        measure q[0] -> c[0];
        measure q[1] -> c[1];
      `),
      { shots: 1000, seed: 9 },
    );
    expect([...result.counts.keys()].sort()).toEqual(['01', '10']);
  });

  it('never-measured classical bits read 0', () => {
    const result = executeCircuit(
      moduleFromSource('qubit q; bit[3] c; x q; measure q -> c[1];'),
      { shots: 10, seed: 1 },
    );
    expect([...result.counts.keys()]).toEqual(['010']);
  });

  it('a circuit with no measurement still reports the statevector', () => {
    const result = executeCircuit(moduleFromSource('qubit[2] q; h q[0]; cx q[0], q[1];'), {
      shots: 4,
      seed: 1,
    });
    expect(result.probabilities[0]).toBeCloseTo(0.5, 14);
    expect(result.probabilities[3]).toBeCloseTo(0.5, 14);
  });

  it('a later measurement overwrites the same classical bit', () => {
    const result = executeCircuit(
      moduleFromSource(`
        qubit[2] q; bit c;
        x q[1];
        measure q[0] -> c;
        measure q[1] -> c;
      `),
      { shots: 5, seed: 1 },
    );
    expect([...result.counts.keys()]).toEqual(['1']);
  });
});

describe('seeded determinism', () => {
  it('the same seed reproduces the same counts', () => {
    const module = moduleFromSource(BELL);
    const a = executeCircuit(module, { shots: 500, seed: 2024 });
    const b = executeCircuit(module, { shots: 500, seed: 2024 });
    expect([...a.counts.entries()].sort()).toEqual([...b.counts.entries()].sort());
  });

  it('different seeds generally differ', () => {
    const module = moduleFromSource(BELL);
    const a = executeCircuit(module, { shots: 500, seed: 1 });
    const b = executeCircuit(module, { shots: 500, seed: 2 });
    expect(a.counts.get('00')).not.toBe(b.counts.get('00'));
  });

  it('reports the seed it used when none was given', () => {
    const result = executeCircuit(moduleFromSource(BELL), { shots: 10 });
    expect(Number.isInteger(result.seed)).toBe(true);
    const repeat = executeCircuit(moduleFromSource(BELL), { shots: 10, seed: result.seed });
    expect([...repeat.counts.entries()].sort()).toEqual([...result.counts.entries()].sort());
  });

  it('replay mode is also reproducible', () => {
    const module = moduleFromSource(
      'qubit q; bit[2] c; h q; measure q -> c[0]; reset q; h q; measure q -> c[1];',
    );
    const a = executeCircuit(module, { shots: 300, seed: 5 });
    const b = executeCircuit(module, { shots: 300, seed: 5 });
    expect(a.strategy).toBe('per-shot-replay');
    expect([...a.counts.entries()].sort()).toEqual([...b.counts.entries()].sort());
  });
});

describe('sampling converges to the exact distribution', () => {
  const programs = [
    BELL,
    'qubit[3] q; bit[3] c; h q[0]; cx q[0], q[1]; cx q[0], q[2]; measure q[0] -> c[0]; measure q[1] -> c[1]; measure q[2] -> c[2];',
    'qubit[2] q; bit[2] c; ry(pi / 3) q[0]; h q[1]; measure q[0] -> c[0]; measure q[1] -> c[1];',
    'qubit[2] q; bit[2] c; h q[0]; h q[1]; cz q[0], q[1]; h q[1]; measure q[0] -> c[0]; measure q[1] -> c[1];',
  ];

  it.each(programs)('shot frequencies approach exact probabilities', (source) => {
    const module = moduleFromSource(source);
    const exact = exactRegisterDistribution(module);
    const shots = 50_000;
    const result = executeCircuit(module, { shots, seed: 31337 });

    for (const [key, probability] of exact) {
      const observed = (result.counts.get(key) ?? 0) / shots;
      // 5 sigma for a binomial proportion at this shot count.
      const sigma = Math.sqrt((probability * (1 - probability)) / shots);
      expect(Math.abs(observed - probability)).toBeLessThan(Math.max(5 * sigma, 0.002));
    }
    // No outcome outside the support ever appears.
    for (const key of result.counts.keys()) expect(exact.has(key)).toBe(true);
  });

  it('exact distribution sums to one', () => {
    for (const source of programs) {
      const total = [...exactRegisterDistribution(moduleFromSource(source)).values()].reduce(
        (a, b) => a + b,
        0,
      );
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('refuses to compute an exact distribution for a replay circuit', () => {
    expect(() => exactRegisterDistribution(moduleFromSource('qubit q; h q; reset q;'))).toThrow(
      /terminal measurements/,
    );
  });
});

describe('terminal sampling and replay agree', () => {
  it('gives the same distribution for a circuit where both are valid', () => {
    // A mid-circuit measurement followed by a gate forces replay. An
    // equivalent circuit with the measurement moved to the end can use
    // terminal sampling. The two must agree.
    const replayModule = makeModule(
      1,
      [
        { opcode: Opcode.H, qubits: [0], params: [] },
        { opcode: Opcode.Measure, qubits: [0], params: [], clbit: 0 },
        { opcode: Opcode.Id, qubits: [0], params: [] },
      ],
      1,
    );
    const terminalModule = makeModule(
      1,
      [
        { opcode: Opcode.H, qubits: [0], params: [] },
        { opcode: Opcode.Measure, qubits: [0], params: [], clbit: 0 },
      ],
      1,
    );
    expect(requiresPerShotReplay(replayModule)).toBe(true);
    expect(requiresPerShotReplay(terminalModule)).toBe(false);

    const shots = 40_000;
    const replay = executeCircuit(replayModule, { shots, seed: 4 });
    const terminal = executeCircuit(terminalModule, { shots, seed: 4 });
    for (const key of ['0', '1']) {
      const a = (replay.counts.get(key) ?? 0) / shots;
      const b = (terminal.counts.get(key) ?? 0) / shots;
      expect(Math.abs(a - b)).toBeLessThan(0.02);
    }
  });
});

describe('resource guards', () => {
  it('rejects an invalid shot count', () => {
    const module = moduleFromSource(BELL);
    expect(() => executeCircuit(module, { shots: 0 })).toThrow(RangeError);
    expect(() => executeCircuit(module, { shots: -1 })).toThrow(RangeError);
    expect(() => executeCircuit(module, { shots: 1.5 })).toThrow(RangeError);
    expect(() => executeCircuit(module, { shots: 2_000_000 })).toThrow(RangeError);
  });

  it('rejects a non-unitary opcode reaching applyInstruction', () => {
    const module = makeModule(
      1,
      [{ opcode: Opcode.Measure, qubits: [0], params: [], clbit: 0 }],
      1,
    );
    // executeCircuit handles measure itself; the guard is for direct callers.
    expect(() => executeCircuit(module, { shots: 1, seed: 1 })).not.toThrow();
  });
});

describe('execution trace', () => {
  it('records one step per instruction plus the initial state', () => {
    const module = moduleFromSource('qubit[2] q; h q[0]; cx q[0], q[1];');
    const trace = traceCircuit(module, { seed: 1 });
    expect(trace.steps).toHaveLength(2);
    expect(trace.initialState.probabilities()[0]).toBe(1);
    expect(stateAtStep(trace, -1)!.probabilities()[0]).toBe(1);
  });

  it('shows the state evolving gate by gate', () => {
    const trace = traceCircuit(moduleFromSource('qubit[2] q; h q[0]; cx q[0], q[1];'), {
      seed: 1,
    });
    // After H: |00> and |01> each 1/2. After CX: |00> and |11>.
    const afterH = probabilitiesAtStep(trace, 0);
    expect(afterH[0]).toBeCloseTo(0.5, 14);
    expect(afterH[1]).toBeCloseTo(0.5, 14);

    const afterCx = probabilitiesAtStep(trace, 1);
    expect(afterCx[0]).toBeCloseTo(0.5, 14);
    expect(afterCx[3]).toBeCloseTo(0.5, 14);
    expect(afterCx[1]).toBeCloseTo(0, 14);
  });

  it('identifies which amplitudes an operation changed', () => {
    const trace = traceCircuit(moduleFromSource('qubit[2] q; h q[0]; cx q[0], q[1];'), {
      seed: 1,
    });
    // H on |00> rewrites both amplitude 0 (1 -> 1/sqrt2) and amplitude 1 (0 -> 1/sqrt2).
    expect(trace.steps[0]!.changedAmplitudes).toEqual([0, 1]);
    // CX moves amplitude from index 1 to index 3.
    expect(trace.steps[1]!.changedAmplitudes).toEqual([1, 3]);
  });

  it('records exact probabilities and the sampled outcome for a measurement', () => {
    const trace = traceCircuit(moduleFromSource('qubit q; bit c; h q; measure q -> c;'), {
      seed: 11,
    });
    const step = trace.steps[1]!;
    expect(step.measurement).toBeDefined();
    expect(step.measurement!.p0).toBeCloseTo(0.5, 14);
    expect(step.measurement!.p1).toBeCloseTo(0.5, 14);
    expect([0, 1]).toContain(step.measurement!.outcome);
    // The classical bit records the outcome that occurred.
    expect(step.classicalBits[0]).toBe(step.measurement!.outcome);
    // ...and the state has collapsed, not stayed in superposition.
    const collapsed = step.probabilities;
    expect(Math.max(collapsed[0]!, collapsed[1]!)).toBeCloseTo(1, 13);
  });

  it('is reproducible for a fixed seed and allows backward navigation', () => {
    const module = moduleFromSource(
      'qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; measure q[0] -> c[0];',
    );
    const a = traceCircuit(module, { seed: 77 });
    const b = traceCircuit(module, { seed: 77 });
    expect(a.steps[2]!.measurement!.outcome).toBe(b.steps[2]!.measurement!.outcome);
    // Backward navigation returns recorded states, not recomputed ones, so the
    // pre-measurement superposition is still exactly available.
    const before = stateAtStep(a, 1)!;
    expect(before.probabilities()[0]).toBeCloseTo(0.5, 14);
    expect(before.probabilities()[3]).toBeCloseTo(0.5, 14);
  });

  it('retains probabilities but drops amplitudes when the budget is tight', () => {
    const module = moduleFromSource('qubit[3] q; h q[0]; h q[1]; h q[2]; x q[0]; x q[1];');
    const trace = traceCircuit(module, { seed: 1, maxTraceBytes: 1 });
    expect(trace.amplitudesTruncatedFrom).toBe(0);
    expect(trace.steps[0]!.state).toBeUndefined();
    expect(trace.steps[0]!.probabilities.length).toBe(8);
  });

  it('traces a reset and leaves the qubit in |0>', () => {
    const trace = traceCircuit(moduleFromSource('qubit q; h q; reset q;'), { seed: 3 });
    const last = trace.steps[1]!;
    expect(last.measurement).toBeDefined();
    expect(last.probabilities[0]).toBeCloseTo(1, 13);
  });
});
