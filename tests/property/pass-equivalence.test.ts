import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSES,
  Opcode,
  cancelInversePair,
  cancelSelfInverse,
  gateCount,
  mergeRotations,
  optimize,
  removeIdentity,
  type IrModule,
} from '@qforge/compiler';
import { Statevector, applyInstruction, simulateDense } from '@qforge/simulator';
import { makeModule, moduleFromSource, randomCircuit } from '@qforge/testing';
import { Prng } from '@qforge/simulator';

/**
 * Property tests for the optimisation passes.
 *
 * The contract every QForge pass signs is stronger than "same measurement
 * statistics": the optimised circuit must implement the *same operator*, global
 * phase included. These tests check that on randomly generated circuits by
 * comparing full statevectors, not just probabilities — a pass that dropped a
 * `-I` would pass a probability-only check and fail here, which is the point.
 */

function simulate(module: IrModule): Statevector {
  const state = Statevector.zeroState(module.qubitCount);
  for (const instruction of module.instructions) applyInstruction(state, instruction);
  return state;
}

/**
 * Build a random circuit biased towards *cancellable* structure, so the passes
 * actually fire. A uniformly random circuit rarely contains an adjacent
 * inverse pair, which would make the property test vacuous.
 */
function cancellableCircuit(qubitCount: number, gateCount: number, seed: number): IrModule {
  const rng = new Prng(seed);
  const instructions: Array<{ opcode: Opcode; qubits: number[]; params: number[] }> = [];
  const oneQubit = [
    Opcode.H,
    Opcode.X,
    Opcode.Y,
    Opcode.Z,
    Opcode.S,
    Opcode.Sdg,
    Opcode.T,
    Opcode.Tdg,
    Opcode.Id,
  ] as const;
  const rotations = [Opcode.Rx, Opcode.Ry, Opcode.Rz, Opcode.P] as const;
  const twoQubit = [Opcode.Cx, Opcode.Cz, Opcode.Swap] as const;

  const pick = (count: number): number[] => {
    const pool = Array.from({ length: qubitCount }, (_, i) => i);
    return Array.from({ length: count }, () => pool.splice(rng.nextInt(pool.length), 1)[0]!);
  };

  while (instructions.length < gateCount) {
    const roll = rng.nextFloat();
    if (roll < 0.3) {
      // Deliberate repeat: same gate twice on the same qubit(s).
      const useTwo = qubitCount >= 2 && rng.nextFloat() < 0.4;
      const opcode = useTwo
        ? twoQubit[rng.nextInt(twoQubit.length)]!
        : oneQubit[rng.nextInt(oneQubit.length)]!;
      const qubits = pick(useTwo ? 2 : 1);
      instructions.push({ opcode, qubits: [...qubits], params: [] });
      instructions.push({ opcode, qubits: [...qubits], params: [] });
    } else if (roll < 0.5) {
      // Deliberate inverse pair or same-axis rotation run.
      const opcode = rotations[rng.nextInt(rotations.length)]!;
      const qubits = pick(1);
      const theta = (rng.nextFloat() - 0.5) * 6;
      instructions.push({ opcode, qubits: [...qubits], params: [theta] });
      instructions.push({ opcode, qubits: [...qubits], params: [-theta] });
    } else if (roll < 0.65) {
      const qubits = pick(1);
      instructions.push({ opcode: Opcode.S, qubits: [...qubits], params: [] });
      instructions.push({ opcode: Opcode.Sdg, qubits: [...qubits], params: [] });
    } else if (qubitCount >= 2 && roll < 0.8) {
      const opcode = twoQubit[rng.nextInt(twoQubit.length)]!;
      instructions.push({ opcode, qubits: pick(2), params: [] });
    } else {
      const opcode = rotations[rng.nextInt(rotations.length)]!;
      instructions.push({ opcode, qubits: pick(1), params: [(rng.nextFloat() - 0.5) * 8] });
    }
  }

  return makeModule(qubitCount, instructions.slice(0, gateCount));
}

describe('passes preserve the operator on random circuits', () => {
  const configurations = [
    { qubitCount: 1, gateCount: 24 },
    { qubitCount: 2, gateCount: 30 },
    { qubitCount: 3, gateCount: 40 },
    { qubitCount: 4, gateCount: 40 },
    { qubitCount: 5, gateCount: 30 },
  ];

  it.each(configurations)(
    'uniformly random circuits %j survive optimisation unchanged',
    ({ qubitCount, gateCount: count }) => {
      for (let seed = 1; seed <= 30; seed++) {
        const original = randomCircuit({ qubitCount, gateCount: count, seed });
        const { module: optimized } = optimize(original);
        const before = simulate(original);
        const after = simulate(optimized);
        expect(
          before.maxAmplitudeDifference(after),
          `seed ${seed}: amplitudes diverged`,
        ).toBeLessThan(1e-11);
      }
    },
  );

  it.each(configurations)(
    'cancellation-rich circuits %j survive optimisation unchanged',
    ({ qubitCount, gateCount: count }) => {
      let totalRemoved = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const original = cancellableCircuit(qubitCount, count, seed);
        const { module: optimized, report } = optimize(original);
        totalRemoved += report.instructionsBefore - report.instructionsAfter;
        const before = simulate(original);
        const after = simulate(optimized);
        expect(
          before.maxAmplitudeDifference(after),
          `seed ${seed}: amplitudes diverged`,
        ).toBeLessThan(1e-11);
      }
      // Guard against a vacuous test: the passes must actually be doing work.
      expect(totalRemoved).toBeGreaterThan(40);
    },
  );

  it('matches the independent dense oracle after optimisation', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const original = cancellableCircuit(4, 30, seed);
      const { module: optimized } = optimize(original);
      const oracleBefore = simulateDense(original);
      const oracleAfter = simulateDense(optimized);
      expect(oracleBefore.maxAmplitudeDifference(oracleAfter)).toBeLessThan(1e-11);
    }
  });
});

describe('each pass individually preserves the operator', () => {
  const passes = [removeIdentity, cancelSelfInverse, cancelInversePair, mergeRotations];

  it.each(passes.map((p) => [p.name, p] as const))('%s', (_name, pass) => {
    for (let seed = 1; seed <= 40; seed++) {
      const original = cancellableCircuit(3, 30, seed);
      const result = pass.run(original);
      const before = simulate(original);
      const after = simulate(result.module);
      expect(before.maxAmplitudeDifference(after)).toBeLessThan(1e-12);
    }
  });

  it('every pass documents its justification', () => {
    for (const pass of DEFAULT_PASSES) {
      expect(pass.justification.length).toBeGreaterThan(40);
      expect(pass.description.length).toBeGreaterThan(10);
    }
  });
});

describe('passes never grow the circuit', () => {
  it('instruction and gate counts are monotonically non-increasing', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const original = cancellableCircuit(4, 40, seed);
      const { module: optimized, report } = optimize(original);
      expect(optimized.instructions.length).toBeLessThanOrEqual(original.instructions.length);
      expect(gateCount(optimized)).toBeLessThanOrEqual(gateCount(original));
      expect(report.hitRoundLimit).toBe(false);
    }
  });

  it('reaches a fixpoint: a second run changes nothing', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const original = cancellableCircuit(3, 30, seed);
      const first = optimize(original);
      const second = optimize(first.module);
      expect(second.report.instructionsAfter).toBe(first.report.instructionsAfter);
    }
  });
});

describe('passes respect barriers and non-unitary operations', () => {
  it('does not cancel across a barrier', () => {
    const module = moduleFromSource('qubit q; h q; barrier; h q;');
    const { module: optimized } = optimize(module);
    expect(gateCount(optimized)).toBe(2);
  });

  it('does not cancel across a barrier that covers the qubit explicitly', () => {
    const module = moduleFromSource('qubit[2] q; h q[0]; barrier q[0]; h q[0];');
    expect(gateCount(optimize(module).module)).toBe(2);
  });

  it('does cancel across a barrier on an unrelated qubit', () => {
    const module = moduleFromSource('qubit[2] q; h q[0]; barrier q[1]; h q[0];');
    expect(gateCount(optimize(module).module)).toBe(0);
  });

  it('does not cancel across a measurement', () => {
    const module = moduleFromSource('qubit q; bit c; h q; measure q -> c; h q;');
    expect(gateCount(optimize(module).module)).toBe(2);
  });

  it('does not cancel across a reset', () => {
    const module = moduleFromSource('qubit q; h q; reset q; h q;');
    expect(gateCount(optimize(module).module)).toBe(2);
  });

  it('does not cancel across an intervening gate on a shared qubit', () => {
    // cx a,b ; h a ; cx a,b is not the identity.
    const module = moduleFromSource(`
      qubit[2] q;
      cx q[0], q[1];
      h q[0];
      cx q[0], q[1];
    `);
    expect(gateCount(optimize(module).module)).toBe(3);
  });

  it('keeps measurement statistics intact when it does optimise', () => {
    const module = moduleFromSource(`
      qubit[2] q; bit[2] c;
      h q[0]; h q[0];
      h q[0];
      cx q[0], q[1];
      measure q[0] -> c[0]; measure q[1] -> c[1];
    `);
    const { module: optimized } = optimize(module);
    expect(gateCount(optimized)).toBe(2);
  });
});
