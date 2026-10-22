import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLI_LIMITS } from '@qforge/language';
import { compile, conditionHolds } from '@qforge/compiler';
import {
  Prng,
  Statevector,
  applyInstruction,
  executeCircuit,
  measureQubit,
  resetQubit,
  traceCircuit,
  type Complex,
} from '@qforge/simulator';

/**
 * Mathematical validation of quantum teleportation.
 *
 * Counting measurement outcomes proves nothing here: Alice's Bell measurement
 * is unbiased, so all four outcomes appear a quarter of the time whether or not
 * Bob's corrections are right. A circuit with the corrections deleted produces
 * an identical counts table.
 *
 * The claim that actually needs checking is about Bob's *state*: after the
 * protocol he must hold the state `msg` started in, in every branch. So these
 * tests reconstruct Bob's reduced density matrix from the post-run statevector
 * and compute its fidelity with the intended pure state.
 */

const SOURCE = readFileSync(
  new URL('../../examples/teleportation.qf', import.meta.url),
  'utf8',
);

/** Run one shot of a module, returning the final state and classical register. */
function runOnce(source: string, seed: number): { state: Statevector; register: Uint8Array } {
  const result = compile(source, { limits: CLI_LIMITS });
  expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  const module = result.module!;

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
 * Fidelity between a pure state |psi> = (alpha, beta) and a one-qubit density
 * matrix: F = <psi| rho |psi>. Equals 1 exactly when rho is |psi><psi|.
 */
function fidelityWithPure(
  rho: readonly [Complex, Complex, Complex, Complex],
  alpha: Complex,
  beta: Complex,
): number {
  const terms: Array<[Complex, Complex, Complex]> = [
    [alpha, rho[0]!, alpha],
    [alpha, rho[1]!, beta],
    [beta, rho[2]!, alpha],
    [beta, rho[3]!, beta],
  ];
  let re = 0;
  for (const [left, element, right] of terms) {
    // conj(left) * element * right
    const ar = left.re;
    const ai = -left.im;
    const midRe = element.re * right.re - element.im * right.im;
    const midIm = element.re * right.im + element.im * right.re;
    re += ar * midRe - ai * midIm;
  }
  return re;
}

/** The pure state `ry(theta) rz(phi) |0>` prepares, as amplitudes. */
function preparedState(theta: number, phi: number): { alpha: Complex; beta: Complex } {
  const state = Statevector.zeroState(1);
  const source = `qubit q; ry(${theta}) q; rz(${phi}) q;`;
  const module = compile(source, { limits: CLI_LIMITS }).module!;
  for (const instruction of module.instructions) applyInstruction(state, instruction);
  return { alpha: state.amplitude(0), beta: state.amplitude(1) };
}

/** The teleportation circuit with an arbitrary preparation on `msg`. */
const circuitFor = (theta: number, phi: number): string => `
  qubit msg; qubit alice; qubit bob;
  bit m0; bit m1;
  ry(${theta}) msg;
  rz(${phi}) msg;
  h alice;
  cx alice, bob;
  cx msg, alice;
  h msg;
  measure msg -> m0;
  measure alice -> m1;
  if (m1 == 1) x bob;
  if (m0 == 1) z bob;
`;

/** Qubit indices follow declaration order: msg = 0, alice = 1, bob = 2. */
const BOB = 2;
const MSG = 0;

describe('teleportation transfers the state', () => {
  const inputs: Array<[string, number, number]> = [
    ['|0>', 0, 0],
    ['|1>', Math.PI, 0],
    ['|+>', Math.PI / 2, 0],
    ['|->', Math.PI / 2, Math.PI],
    ['|+i>', Math.PI / 2, Math.PI / 2],
    ['asymmetric real', (2 * Math.PI) / 5, 0],
    ['asymmetric complex', 1.1, 0.7],
    ['near the pole', 0.05, 2.3],
    ['generic', 2.4, -1.9],
  ];

  it.each(inputs)('delivers %s to Bob with fidelity 1', (_label, theta, phi) => {
    const { alpha, beta } = preparedState(theta, phi);
    let worst = 1;
    const branchesSeen = new Set<string>();

    // Enough seeds that all four Bell outcomes occur for each input.
    for (let seed = 1; seed <= 40; seed++) {
      const { state, register } = runOnce(circuitFor(theta, phi), seed);
      branchesSeen.add(`${register[0]}${register[1]}`);
      const fidelity = fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta);
      worst = Math.min(worst, fidelity);
    }

    expect(worst).toBeGreaterThan(1 - 1e-12);
    expect(branchesSeen.size, 'every Bell-measurement branch should occur').toBe(4);
  });

  it('is correct in each of the four branches individually', () => {
    const theta = 1.1;
    const phi = 0.7;
    const { alpha, beta } = preparedState(theta, phi);
    const perBranch = new Map<string, number>();

    for (let seed = 1; seed <= 200; seed++) {
      const { state, register } = runOnce(circuitFor(theta, phi), seed);
      const branch = `${register[0]}${register[1]}`;
      const fidelity = fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta);
      perBranch.set(branch, Math.min(perBranch.get(branch) ?? 1, fidelity));
    }

    expect([...perBranch.keys()].sort()).toEqual(['00', '01', '10', '11']);
    for (const [branch, fidelity] of perBranch) {
      expect(fidelity, `branch ${branch}`).toBeGreaterThan(1 - 1e-12);
    }
  });

  it('leaves Bob entangled and wrong when the corrections are removed', () => {
    // A control: without the feed-forward the counts are identical, so this is
    // the test that would catch a protocol that only *looks* right.
    const theta = 1.1;
    const phi = 0.7;
    const { alpha, beta } = preparedState(theta, phi);
    const broken = circuitFor(theta, phi)
      .replace('if (m1 == 1) x bob;', '')
      .replace('if (m0 == 1) z bob;', '');

    let worst = 1;
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = runOnce(broken, seed);
      worst = Math.min(worst, fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta));
    }
    expect(worst).toBeLessThan(0.95);
  });

  it('applying only one of the two corrections is not enough', () => {
    const theta = 1.1;
    const phi = 0.7;
    const { alpha, beta } = preparedState(theta, phi);
    for (const dropped of ['if (m1 == 1) x bob;', 'if (m0 == 1) z bob;']) {
      let worst = 1;
      for (let seed = 1; seed <= 40; seed++) {
        const { state } = runOnce(circuitFor(theta, phi).replace(dropped, ''), seed);
        worst = Math.min(worst, fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta));
      }
      expect(worst, `dropping "${dropped}"`).toBeLessThan(0.95);
    }
  });

  it('swapping the correction order still works, because X and Z act on disjoint bits', () => {
    // m0 controls Z and m1 controls X, and the two corrections commute up to a
    // global phase, so the written order is a readability choice rather than a
    // correctness one. Worth pinning down so a future edit does not "fix" it.
    const theta = 1.1;
    const phi = 0.7;
    const { alpha, beta } = preparedState(theta, phi);
    const swapped = circuitFor(theta, phi).replace(
      'if (m1 == 1) x bob;\n  if (m0 == 1) z bob;',
      'if (m0 == 1) z bob;\n  if (m1 == 1) x bob;',
    );
    let worst = 1;
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = runOnce(swapped, seed);
      worst = Math.min(worst, fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta));
    }
    expect(worst).toBeGreaterThan(1 - 1e-12);
  });
});

describe('teleportation does not clone the state', () => {
  it('destroys the original: msg ends in a computational basis state', () => {
    const theta = 1.1;
    const phi = 0.7;
    const { alpha, beta } = preparedState(theta, phi);

    for (let seed = 1; seed <= 40; seed++) {
      const { state, register } = runOnce(circuitFor(theta, phi), seed);

      // msg has been measured, so its Bloch vector points along +z or -z and
      // its fidelity with the original state is just |amplitude|^2 -- it no
      // longer carries the phase information that made the state what it was.
      const bloch = state.blochVector(MSG);
      expect(Math.abs(Math.abs(bloch.z) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(bloch.x)).toBeLessThan(1e-12);
      expect(Math.abs(bloch.y)).toBeLessThan(1e-12);

      // ...and it agrees with the bit Alice recorded.
      expect(bloch.z > 0 ? 0 : 1).toBe(register[0]);
    }

    // The original state is not recoverable from msg: its fidelity with the
    // input is |alpha|^2 or |beta|^2, never 1 for a genuine superposition.
    const { state } = runOnce(circuitFor(theta, phi), 1);
    const msgFidelity = fidelityWithPure(state.reducedDensityMatrix(MSG), alpha, beta);
    expect(msgFidelity).toBeLessThan(0.99);
  });

  it('Bob alone learns nothing before the classical bits arrive', () => {
    // Averaged over Alice's outcomes and with no correction applied, Bob's
    // qubit is maximally mixed. This is why teleportation is not
    // faster-than-light signalling: the two classical bits carry the
    // information, and they travel at most at light speed.
    const theta = 1.1;
    const phi = 0.7;
    const uncorrected = circuitFor(theta, phi)
      .replace('if (m1 == 1) x bob;', '')
      .replace('if (m0 == 1) z bob;', '');

    let x = 0;
    let y = 0;
    let z = 0;
    const runs = 400;
    for (let seed = 1; seed <= runs; seed++) {
      const { state } = runOnce(uncorrected, seed);
      const bloch = state.blochVector(BOB);
      x += bloch.x;
      y += bloch.y;
      z += bloch.z;
    }
    // The average Bloch vector is the zero vector, to sampling error.
    expect(Math.hypot(x / runs, y / runs, z / runs)).toBeLessThan(0.12);
  });
});

describe('the published example behaves as documented', () => {
  it('compiles and produces all four measurement outcomes', () => {
    const result = executeCircuit(compile(SOURCE, { limits: CLI_LIMITS }).module!, {
      shots: 4000,
      seed: 7,
    });
    expect(result.strategy).toBe('per-shot-replay');
    expect(new Set(result.counts.keys())).toEqual(new Set(['00', '01', '10', '11']));
    for (const count of result.counts.values()) {
      expect(count / 4000).toBeGreaterThan(0.2);
      expect(count / 4000).toBeLessThan(0.3);
    }
  });

  it('delivers the example’s own prepared state to Bob', () => {
    const { alpha, beta } = preparedState((2 * Math.PI) / 5, 0);
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = runOnce(SOURCE, seed);
      expect(fidelityWithPure(state.reducedDensityMatrix(BOB), alpha, beta)).toBeGreaterThan(
        1 - 1e-12,
      );
    }
  });

  it('the trace records whether each correction fired', () => {
    const module = compile(SOURCE, { limits: CLI_LIMITS }).module!;
    const trace = traceCircuit(module, { seed: 3 });
    const conditional = trace.steps.filter((s) => s.instruction.condition !== undefined);
    expect(conditional).toHaveLength(2);
    for (const step of conditional) {
      expect(typeof step.conditionHeld).toBe('boolean');
      // A correction that did not fire must leave the state untouched.
      if (step.conditionHeld === false) expect(step.changedAmplitudes).toEqual([]);
    }
    // The recorded decision must match the bits measured earlier in the run.
    const bits = trace.steps[trace.steps.length - 1]!.classicalBits;
    const xCorrection = conditional[0]!;
    expect(xCorrection.conditionHeld).toBe(bits[1] === 1);
  });
});
