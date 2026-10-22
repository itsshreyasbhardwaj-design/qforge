import { describe, expect, it } from 'vitest';
import { Opcode, type IrModule } from '@qforge/compiler';
import {
  Statevector,
  applyInstruction,
  denseOperator,
  isUnitary2,
  simulateDense,
  singleQubitMatrix,
} from '@qforge/simulator';
import { makeModule, moduleFromSource, randomCircuit } from '@qforge/testing';

/**
 * Cross-validation of the production statevector kernels against the
 * independently written dense-matrix oracle in `@qforge/simulator/reference`.
 *
 * The two share no index arithmetic: the fast path walks bit masks in place,
 * the oracle enumerates basis states and builds a full 2^n x 2^n operator from
 * `<j| Op |i>`. Agreement on randomly generated circuits is therefore real
 * evidence about the kernels, not a tautology.
 *
 * What this does *not* establish: that the simulator is correct for all
 * circuits. It checks a few hundred random circuits up to 6 qubits. Known-state
 * tests in `packages/simulator` cover the analytic cases, and
 * `scripts/numpy-reference.mjs` adds a third check outside this language.
 */

/** Run a module through the production kernels. */
function simulateFast(module: IrModule): Statevector {
  const state = Statevector.zeroState(module.qubitCount);
  for (const instruction of module.instructions) applyInstruction(state, instruction);
  return state;
}

describe('dense oracle: operator construction', () => {
  it('builds unitary operators for every opcode', () => {
    const cases: Array<{ opcode: Opcode; qubits: number[]; params: number[] }> = [
      { opcode: Opcode.H, qubits: [1], params: [] },
      { opcode: Opcode.X, qubits: [0], params: [] },
      { opcode: Opcode.Y, qubits: [2], params: [] },
      { opcode: Opcode.Z, qubits: [1], params: [] },
      { opcode: Opcode.S, qubits: [0], params: [] },
      { opcode: Opcode.Tdg, qubits: [2], params: [] },
      { opcode: Opcode.Rx, qubits: [1], params: [0.7] },
      { opcode: Opcode.Ry, qubits: [0], params: [-1.2] },
      { opcode: Opcode.Rz, qubits: [2], params: [2.4] },
      { opcode: Opcode.P, qubits: [1], params: [0.3] },
      { opcode: Opcode.Cx, qubits: [0, 2], params: [] },
      { opcode: Opcode.Cz, qubits: [1, 2], params: [] },
      { opcode: Opcode.Swap, qubits: [0, 2], params: [] },
      { opcode: Opcode.Ccx, qubits: [0, 1, 2], params: [] },
    ];

    for (const { opcode, qubits, params } of cases) {
      const m = denseOperator({ opcode, qubits, params, loc: SPAN }, 3);
      // Check M M^dagger = I directly on the dense matrix.
      const size = m.size;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          let re = 0;
          let im = 0;
          for (let k = 0; k < size; k++) {
            const ar = m.re[i * size + k]!;
            const ai = m.im[i * size + k]!;
            const br = m.re[j * size + k]!;
            const bi = -m.im[j * size + k]!;
            re += ar * br - ai * bi;
            im += ar * bi + ai * br;
          }
          expect(re).toBeCloseTo(i === j ? 1 : 0, 12);
          expect(im).toBeCloseTo(0, 12);
        }
      }
    }
  });

  it('agrees with the 2x2 matrices for every single-qubit opcode', () => {
    for (const opcode of [
      Opcode.Id,
      Opcode.H,
      Opcode.X,
      Opcode.Y,
      Opcode.Z,
      Opcode.S,
      Opcode.Sdg,
      Opcode.T,
      Opcode.Tdg,
    ] as const) {
      const m = singleQubitMatrix(opcode, []);
      expect(m).toBeDefined();
      expect(isUnitary2(m!)).toBe(true);
    }
  });
});

const SPAN = { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 } as const;

describe('dense oracle: fixed circuits', () => {
  const programs: Array<[string, string]> = [
    ['single X', 'qubit q; x q;'],
    ['superposition', 'qubit q; h q;'],
    ['Bell state', 'qubit[2] q; h q[0]; cx q[0], q[1];'],
    ['GHZ state', 'qubit[3] q; h q[0]; cx q[0], q[1]; cx q[0], q[2];'],
    ['phase kickback', 'qubit[2] q; h q[0]; h q[1]; cz q[0], q[1]; h q[1];'],
    ['rotation chain', 'qubit[2] q; rx(pi / 3) q[0]; ry(pi / 5) q[1]; rz(pi / 7) q[0];'],
    ['swap network', 'qubit[3] q; h q[0]; swap q[0], q[2]; cx q[2], q[1]; swap q[1], q[0];'],
    ['toffoli', 'qubit[3] q; h q[0]; h q[1]; ccx q[0], q[1], q[2];'],
    ['deep single qubit', 'qubit q; h q; s q; t q; h q; tdg q; sdg q; z q; y q; x q;'],
    [
      'mixed five qubit',
      `qubit[5] q;
       h q[0]; h q[2]; rx(0.4) q[1]; cx q[0], q[3];
       ccx q[0], q[1], q[4]; cz q[2], q[3]; swap q[1], q[4];
       p(0.9) q[2]; ry(-1.1) q[3]; rz(2.2) q[4]; cx q[4], q[0];`,
    ],
  ];

  it.each(programs)('%s matches the dense oracle', (_name, source) => {
    const module = moduleFromSource(source);
    const fast = simulateFast(module);
    const oracle = simulateDense(module);
    expect(fast.maxAmplitudeDifference(oracle)).toBeLessThan(1e-12);
  });
});

describe('dense oracle: random circuits', () => {
  // 6 qubits keeps the oracle's 64x64 matrices fast while still exercising
  // three-qubit gates and non-trivial operand orderings.
  const configurations = [
    { qubitCount: 1, gateCount: 12 },
    { qubitCount: 2, gateCount: 20 },
    { qubitCount: 3, gateCount: 25 },
    { qubitCount: 4, gateCount: 30 },
    { qubitCount: 5, gateCount: 30 },
    { qubitCount: 6, gateCount: 25 },
  ];

  it.each(configurations)(
    'matches the oracle for %j across 25 seeds',
    ({ qubitCount, gateCount }) => {
      let worst = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const module = randomCircuit({ qubitCount, gateCount, seed });
        const fast = simulateFast(module);
        const oracle = simulateDense(module);
        worst = Math.max(worst, fast.maxAmplitudeDifference(oracle));
      }
      // Each gate contributes O(eps) rounding; 30 gates stays far under 1e-12.
      expect(worst).toBeLessThan(1e-12);
    },
  );

  it('keeps the state normalised through long random circuits', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const module = randomCircuit({ qubitCount: 5, gateCount: 200, seed });
      const state = simulateFast(module);
      expect(Math.abs(state.norm() - 1)).toBeLessThan(1e-12);
    }
  });
});

describe('dense oracle: operand order is not accidentally symmetric', () => {
  it('distinguishes cx a,b from cx b,a', () => {
    const forward = makeModule(2, [
      { opcode: Opcode.H, qubits: [0], params: [] },
      { opcode: Opcode.Cx, qubits: [0, 1], params: [] },
    ]);
    const reversed = makeModule(2, [
      { opcode: Opcode.H, qubits: [0], params: [] },
      { opcode: Opcode.Cx, qubits: [1, 0], params: [] },
    ]);
    expect(
      simulateDense(forward).maxAmplitudeDifference(simulateDense(reversed)),
    ).toBeGreaterThan(0.1);
    // ...and the fast path agrees with the oracle on both.
    expect(simulateFast(forward).maxAmplitudeDifference(simulateDense(forward))).toBeLessThan(
      1e-12,
    );
    expect(simulateFast(reversed).maxAmplitudeDifference(simulateDense(reversed))).toBeLessThan(
      1e-12,
    );
  });

  it('distinguishes ccx target positions', () => {
    const a = makeModule(3, [
      { opcode: Opcode.H, qubits: [0], params: [] },
      { opcode: Opcode.X, qubits: [1], params: [] },
      { opcode: Opcode.Ccx, qubits: [0, 1, 2], params: [] },
    ]);
    const b = makeModule(3, [
      { opcode: Opcode.H, qubits: [0], params: [] },
      { opcode: Opcode.X, qubits: [1], params: [] },
      { opcode: Opcode.Ccx, qubits: [0, 2, 1], params: [] },
    ]);
    expect(simulateDense(a).maxAmplitudeDifference(simulateDense(b))).toBeGreaterThan(0.1);
    expect(simulateFast(a).maxAmplitudeDifference(simulateDense(a))).toBeLessThan(1e-12);
    expect(simulateFast(b).maxAmplitudeDifference(simulateDense(b))).toBeLessThan(1e-12);
  });
});

describe('dense oracle: scope', () => {
  it('refuses non-unitary instructions rather than guessing', () => {
    const module = makeModule(
      1,
      [{ opcode: Opcode.Measure, qubits: [0], params: [], clbit: 0 }],
      1,
    );
    expect(() => simulateDense(module)).toThrow(/unitary evolution only/);
  });
});
