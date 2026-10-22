import { describe, expect, it } from 'vitest';
import { CLI_LIMITS } from '@qforge/language';
import { compile, conditionHolds, gateCount, optimize, type IrModule } from '@qforge/compiler';
import {
  Prng,
  Statevector,
  applyInstruction,
  measureQubit,
  resetQubit,
} from '@qforge/simulator';

/**
 * The optimiser must not change what a classically controlled circuit does.
 *
 * This is the sharpest edge in the whole compiler. The adjacency scan decides
 * whether two instructions are neighbours by looking at the resources between
 * them; before predication existed it tracked qubits only, and that is exactly
 * wrong once a gate's behaviour depends on a classical bit. The canonical
 * counterexample is
 *
 *   if (c == 1) h q1;   measure q0 -> c;   if (c == 1) h q1;
 *
 * where a qubit-only scan sees two adjacent self-inverse gates on q1 and
 * cancels them -- but the measurement in between can flip `c`, so at runtime
 * one may fire and the other not, and the pair is not the identity.
 *
 * Every test here is about a rewrite the optimiser must *refuse*.
 */

const ir = (source: string): IrModule => {
  const result = compile(source, { limits: CLI_LIMITS });
  expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  return result.module!;
};

/** Execute one shot, honouring predicates. Returns the register and state. */
function runShot(module: IrModule, seed: number) {
  const state = Statevector.zeroState(module.qubitCount);
  const register = new Uint8Array(module.clbitCount);
  const rng = new Prng(seed);
  for (const instruction of module.instructions) {
    if (instruction.condition && !conditionHolds(instruction.condition, register)) continue;
    if (instruction.opcode === 'measure') {
      const outcome = measureQubit(state, instruction.qubits[0]!, rng);
      if (instruction.clbit !== undefined) register[instruction.clbit] = outcome.outcome;
      continue;
    }
    if (instruction.opcode === 'reset') {
      resetQubit(state, instruction.qubits[0]!, rng);
      continue;
    }
    applyInstruction(state, instruction);
  }
  return { state, register };
}

/**
 * Compare a circuit against its optimised form shot by shot, with the *same*
 * seed. Because both circuits consume randomness in the same order for the
 * instructions they share, identical seeds must give identical states -- a far
 * stronger check than comparing aggregate distributions.
 */
function expectShotIdentical(source: string, shots = 60) {
  const plain = ir(source);
  const tuned = optimize(plain).module;
  for (let seed = 1; seed <= shots; seed++) {
    const a = runShot(plain, seed);
    const b = runShot(tuned, seed);
    expect(
      a.state.maxAmplitudeDifference(b.state),
      `seed ${seed}: optimisation changed the state`,
    ).toBeLessThan(1e-12);
    expect(
      [...a.register],
      `seed ${seed}: optimisation changed the classical register`,
    ).toEqual([...b.register]);
  }
}

describe('rewrites the optimiser must refuse', () => {
  it('does not cancel identically predicated gates across a write to their bit', () => {
    const source = `
      qubit[2] q; bit c;
      h q[0];
      if (c == 1) h q[1];
      measure q[0] -> c;
      if (c == 1) h q[1];
    `;
    const module = ir(source);
    const { module: optimized } = optimize(module);
    expect(gateCount(optimized), 'the two conditional h gates must survive').toBe(3);
    expectShotIdentical(source);
  });

  it('does not cancel a conditional gate against an unconditional one', () => {
    const source = `
      qubit q; bit c;
      measure q -> c;
      h q;
      if (c == 1) h q;
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(2);
    expectShotIdentical(source);
  });

  it('does not cancel gates predicated on different values', () => {
    const source = `
      qubit[2] q; bit c;
      measure q[0] -> c;
      if (c == 0) h q[1];
      if (c == 1) h q[1];
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(2);
    expectShotIdentical(source);
  });

  it('does not cancel gates predicated on different bits', () => {
    const source = `
      qubit[3] q; bit[2] c;
      measure q[0] -> c[0];
      measure q[1] -> c[1];
      if (c[0] == 1) h q[2];
      if (c[1] == 1) h q[2];
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(2);
    expectShotIdentical(source);
  });

  it('does not treat == and != as the same predicate', () => {
    const source = `
      qubit[2] q; bit c;
      measure q[0] -> c;
      if (c == 1) h q[1];
      if (c != 1) h q[1];
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(2);
    expectShotIdentical(source);
  });

  it('does not merge rotations under different predicates', () => {
    const source = `
      qubit[2] q; bit c;
      measure q[0] -> c;
      if (c == 1) rx(0.3) q[1];
      rx(0.4) q[1];
    `;
    const { module: optimized } = optimize(ir(source));
    expect(optimized.instructions.filter((i) => i.opcode === 'rx')).toHaveLength(2);
    expectShotIdentical(source);
  });

  it('does not merge rotations across a write to their predicate bit', () => {
    const source = `
      qubit[2] q; bit c;
      if (c == 1) rx(0.3) q[1];
      measure q[0] -> c;
      if (c == 1) rx(0.4) q[1];
    `;
    expect(
      optimize(ir(source)).module.instructions.filter((i) => i.opcode === 'rx'),
    ).toHaveLength(2);
    expectShotIdentical(source);
  });

  it('does not cancel conditional s/sdg across a write to their bit', () => {
    const source = `
      qubit[2] q; bit c;
      if (c == 1) s q[1];
      measure q[0] -> c;
      if (c == 1) sdg q[1];
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(2);
    expectShotIdentical(source);
  });

  it('does not reorder a conditional measurement past its own predicate', () => {
    const source = `
      qubit[2] q; bit[2] c;
      h q[0];
      measure q[0] -> c[0];
      if (c[0] == 1) measure q[1] -> c[1];
    `;
    expectShotIdentical(source);
  });
});

describe('rewrites the optimiser may still make', () => {
  it('cancels identically predicated gates when nothing touches their bit', () => {
    const source = `
      qubit[2] q; bit c;
      measure q[0] -> c;
      if (c == 1) h q[1];
      if (c == 1) h q[1];
    `;
    // Both fire or neither does, so the pair is the identity either way.
    expect(gateCount(optimize(ir(source)).module)).toBe(0);
    expectShotIdentical(source);
  });

  it('removes a predicated identity rotation regardless of the predicate', () => {
    const source = `
      qubit q; bit c;
      measure q -> c;
      if (c == 1) rx(4 * pi) q;
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(0);
    expectShotIdentical(source);
  });

  it('merges identically predicated rotations', () => {
    const source = `
      qubit[2] q; bit c;
      measure q[0] -> c;
      if (c == 1) rz(0.3) q[1];
      if (c == 1) rz(0.4) q[1];
    `;
    const { module: optimized } = optimize(ir(source));
    const rotations = optimized.instructions.filter((i) => i.opcode === 'rz');
    expect(rotations).toHaveLength(1);
    expect(rotations[0]!.params[0]).toBeCloseTo(0.7, 15);
    expect(rotations[0]!.condition?.text).toBe('c == 1');
    expectShotIdentical(source);
  });

  it('still optimises the unconditional part of a mixed circuit', () => {
    const source = `
      qubit[2] q; bit c;
      h q[1]; h q[1];
      measure q[0] -> c;
      if (c == 1) x q[1];
    `;
    expect(gateCount(optimize(ir(source)).module)).toBe(1);
    expectShotIdentical(source);
  });
});

describe('teleportation survives optimisation', () => {
  const source = `
    qubit msg; qubit alice; qubit bob;
    bit m0; bit m1;
    ry(1.1) msg;
    h alice;
    cx alice, bob;
    cx msg, alice;
    h msg;
    measure msg -> m0;
    measure alice -> m1;
    if (m1 == 1) x bob;
    if (m0 == 1) z bob;
  `;

  it('leaves the corrections in place', () => {
    const { module: optimized } = optimize(ir(source));
    const conditional = optimized.instructions.filter((i) => i.condition !== undefined);
    expect(conditional).toHaveLength(2);
    expect(conditional.map((i) => i.opcode)).toEqual(['x', 'z']);
  });

  it('produces identical states shot for shot', () => {
    expectShotIdentical(source, 80);
  });
});

describe('predicate-aware adjacency, generatively', () => {
  /**
   * Random circuits built from a small alphabet that deliberately includes
   * measurements writing the same bit several predicates read. Any unsound
   * rewrite shows up as a per-shot state difference.
   */
  it('optimisation never changes a random predicated circuit', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new Prng(seed);
      const lines = ['qubit[3] q;', 'bit[2] c;'];
      const gates = ['h', 'x', 'z', 's', 'sdg', 't', 'tdg'];
      for (let i = 0; i < 14; i++) {
        const roll = rng.nextFloat();
        const q = rng.nextInt(3);
        if (roll < 0.25) {
          lines.push(`measure q[${rng.nextInt(3)}] -> c[${rng.nextInt(2)}];`);
        } else if (roll < 0.65) {
          const bit = rng.nextInt(2);
          const value = rng.nextInt(2);
          const op = rng.nextFloat() < 0.5 ? '==' : '!=';
          lines.push(
            `if (c[${bit}] ${op} ${value}) ${gates[rng.nextInt(gates.length)]} q[${q}];`,
          );
        } else {
          lines.push(`${gates[rng.nextInt(gates.length)]} q[${q}];`);
        }
      }
      expectShotIdentical(lines.join('\n'), 12);
    }
  });
});
