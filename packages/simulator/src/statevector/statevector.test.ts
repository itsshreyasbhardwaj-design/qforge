import { describe, expect, it } from 'vitest';
import { Statevector, probabilityTable } from './statevector.js';
import { HADAMARD, PAULI_X, PAULI_Y, PAULI_Z, rx, ry, rz, phase } from '../gates/matrices.js';
import { complex } from '../complex/complex.js';

const INV_SQRT2 = 1 / Math.SQRT2;

/** Probability of each basis index, rounded for comparison. */
const probs = (state: Statevector, digits = 10): number[] =>
  Array.from(state.probabilities(), (p) => Number(p.toFixed(digits)));

describe('statevector: initialisation', () => {
  it('starts in |00...0> with all probability on index 0', () => {
    for (const n of [1, 2, 3, 5]) {
      const state = Statevector.zeroState(n);
      expect(state.size).toBe(2 ** n);
      expect(state.amplitude(0)).toEqual(complex(1, 0));
      expect(state.norm()).toBeCloseTo(1, 15);
      expect(state.probabilities()[0]).toBe(1);
    }
  });

  it('supports a zero-qubit state as the trivial scalar', () => {
    const state = Statevector.zeroState(0);
    expect(state.size).toBe(1);
    expect(state.norm()).toBe(1);
  });

  it('rejects an invalid or oversized qubit count', () => {
    expect(() => Statevector.zeroState(-1)).toThrow(RangeError);
    expect(() => Statevector.zeroState(1.5)).toThrow(RangeError);
    expect(() => Statevector.zeroState(64)).toThrow(/hard limit/);
  });

  it('rejects an amplitude list that is not a power of two', () => {
    expect(() => Statevector.fromAmplitudes([complex(1), complex(0), complex(0)])).toThrow(
      RangeError,
    );
  });
});

describe('statevector: bit-order convention', () => {
  // These circuits are deliberately asymmetric. A symmetric circuit like the
  // Bell state passes under either endianness and proves nothing about ordering.

  it('qubit 0 is the least significant bit of the amplitude index', () => {
    const state = Statevector.zeroState(3);
    state.applyMatrix(0, PAULI_X);
    // Only qubit 0 flipped, so the index is 2^0 = 1.
    expect(probs(state)[1]).toBe(1);
  });

  it('qubit 2 is the most significant bit of a three-qubit index', () => {
    const state = Statevector.zeroState(3);
    state.applyMatrix(2, PAULI_X);
    expect(probs(state)[4]).toBe(1);
  });

  it('ket labels print the most significant qubit first', () => {
    const state = Statevector.zeroState(3);
    expect(state.basisLabel(0)).toBe('|000>');
    expect(state.basisLabel(1)).toBe('|001>');
    expect(state.basisLabel(4)).toBe('|100>');
    expect(state.basisLabel(5)).toBe('|101>');
  });

  it('flipping qubit 0 shows up as the rightmost digit of the label', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, PAULI_X);
    const table = probabilityTable(state, 1e-12);
    expect([...table.keys()]).toEqual(['|01>']);
  });

  it('marginal probability reads the right qubit', () => {
    const state = Statevector.zeroState(3);
    state.applyMatrix(1, PAULI_X);
    expect(state.marginalProbability(0)).toBeCloseTo(0, 15);
    expect(state.marginalProbability(1)).toBeCloseTo(1, 15);
    expect(state.marginalProbability(2)).toBeCloseTo(0, 15);
  });
});

describe('statevector: single-qubit gates on known states', () => {
  it('X|0> = |1>, so the outcome 1 is certain', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, PAULI_X);
    expect(state.marginalProbability(0)).toBeCloseTo(1, 15);
    expect(probs(state)).toEqual([0, 1]);
  });

  it('H|0> is an equal superposition', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, HADAMARD);
    expect(state.amplitude(0).re).toBeCloseTo(INV_SQRT2, 15);
    expect(state.amplitude(1).re).toBeCloseTo(INV_SQRT2, 15);
    expect(probs(state, 12)).toEqual([0.5, 0.5]);
  });

  it('H H |0> = |0>: the superposition interferes back', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, HADAMARD);
    state.applyMatrix(0, HADAMARD);
    expect(probs(state, 12)).toEqual([1, 0]);
  });

  it('Z leaves |0> alone and negates |1>', () => {
    const zero = Statevector.zeroState(1);
    zero.applyMatrix(0, PAULI_Z);
    expect(zero.amplitude(0)).toEqual(complex(1, 0));

    const one = Statevector.zeroState(1);
    one.applyMatrix(0, PAULI_X);
    one.applyMatrix(0, PAULI_Z);
    expect(one.amplitude(1).re).toBeCloseTo(-1, 15);
  });

  it('Y|0> = i|1>', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, PAULI_Y);
    expect(state.amplitude(1).re).toBeCloseTo(0, 15);
    expect(state.amplitude(1).im).toBeCloseTo(1, 15);
  });

  it('H Z H = X: a phase flip in the X basis is a bit flip', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, HADAMARD);
    state.applyMatrix(0, PAULI_Z);
    state.applyMatrix(0, HADAMARD);
    // Deterministically |1>, up to sign.
    expect(probs(state, 12)).toEqual([0, 1]);
  });

  it('a phase gate changes no probability on a basis state', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, PAULI_X);
    const before = probs(state);
    state.applyMatrix(0, phase(1.234));
    expect(probs(state)).toEqual(before);
    // ...but it does change the amplitude.
    expect(state.amplitude(1).im).toBeCloseTo(Math.sin(1.234), 14);
  });

  it('a phase gate inside interference does change probabilities', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, HADAMARD);
    state.applyMatrix(0, phase(Math.PI));
    state.applyMatrix(0, HADAMARD);
    // H p(pi) H |0> = H Z H |0> = |1>
    expect(probs(state, 12)).toEqual([0, 1]);
  });
});

describe('statevector: rotations against their definitions', () => {
  it('rx(theta)|0> has probability sin^2(theta/2) of outcome 1', () => {
    for (const theta of [0, 0.3, Math.PI / 3, Math.PI / 2, Math.PI, 2.7, -1.1]) {
      const state = Statevector.zeroState(1);
      state.applyMatrix(0, rx(theta));
      const expected = Math.sin(theta / 2) ** 2;
      expect(state.marginalProbability(0)).toBeCloseTo(expected, 14);
    }
  });

  it('ry(theta)|0> has probability sin^2(theta/2) of outcome 1 with real amplitudes', () => {
    for (const theta of [0.4, Math.PI / 2, 1.9]) {
      const state = Statevector.zeroState(1);
      state.applyMatrix(0, ry(theta));
      expect(state.amplitude(0).re).toBeCloseTo(Math.cos(theta / 2), 14);
      expect(state.amplitude(1).re).toBeCloseTo(Math.sin(theta / 2), 14);
      expect(state.amplitude(0).im).toBeCloseTo(0, 15);
      expect(state.amplitude(1).im).toBeCloseTo(0, 15);
    }
  });

  it('rz only adds phase, never probability, to a basis state', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, rz(1.7));
    expect(state.marginalProbability(0)).toBeCloseTo(0, 15);
    expect(state.amplitude(0).re).toBeCloseTo(Math.cos(-1.7 / 2), 14);
    expect(state.amplitude(0).im).toBeCloseTo(Math.sin(-1.7 / 2), 14);
  });

  it('ry(pi/2) then measurement is a fair coin', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, ry(Math.PI / 2));
    expect(state.marginalProbability(0)).toBeCloseTo(0.5, 14);
  });

  it('rotations preserve the norm', () => {
    const state = Statevector.zeroState(3);
    for (const theta of [0.3, 1.1, 2.2, -0.9]) {
      state.applyMatrix(0, rx(theta));
      state.applyMatrix(1, ry(theta));
      state.applyMatrix(2, rz(theta));
    }
    expect(state.norm()).toBeCloseTo(1, 13);
  });
});

describe('statevector: two-qubit gates', () => {
  it('cx flips the target only when the control is 1', () => {
    const idle = Statevector.zeroState(2);
    idle.applyCx(0, 1);
    expect(probs(idle)[0]).toBe(1);

    const active = Statevector.zeroState(2);
    active.applyMatrix(0, PAULI_X); // control = qubit 0 -> index 1
    active.applyCx(0, 1);
    // Both qubits now 1 -> index 3
    expect(probs(active)[3]).toBe(1);
  });

  it('cx is not symmetric in its operands', () => {
    const forward = Statevector.zeroState(2);
    forward.applyMatrix(0, PAULI_X);
    forward.applyCx(0, 1);

    const reversed = Statevector.zeroState(2);
    reversed.applyMatrix(0, PAULI_X);
    reversed.applyCx(1, 0);

    expect(probs(forward)).not.toEqual(probs(reversed));
    expect(probs(reversed)[1]).toBe(1); // unchanged: control qubit 1 was 0
  });

  it('cz applies -1 exactly to |11> and is symmetric', () => {
    const state = Statevector.fromAmplitudes([
      complex(0.5),
      complex(0.5),
      complex(0.5),
      complex(0.5),
    ]);
    state.applyCz(0, 1);
    expect(state.amplitude(3).re).toBeCloseTo(-0.5, 15);
    expect(state.amplitude(1).re).toBeCloseTo(0.5, 15);

    const swapped = Statevector.fromAmplitudes([
      complex(0.5),
      complex(0.5),
      complex(0.5),
      complex(0.5),
    ]);
    swapped.applyCz(1, 0);
    expect(swapped.maxAmplitudeDifference(state)).toBeCloseTo(0, 15);
  });

  it('swap exchanges the two qubits', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, PAULI_X); // |01> in label terms, index 1
    state.applySwap(0, 1);
    expect(probs(state)[2]).toBe(1); // now qubit 1 is set
  });

  it('swap is its own inverse', () => {
    const state = Statevector.zeroState(3);
    state.applyMatrix(0, HADAMARD);
    state.applyMatrix(1, rx(0.7));
    const before = state.clone();
    state.applySwap(0, 2);
    state.applySwap(0, 2);
    expect(state.maxAmplitudeDifference(before)).toBeLessThan(1e-15);
  });

  it('ccx flips only when both controls are 1', () => {
    for (const [c1, c2, expectFlip] of [
      [0, 0, false],
      [1, 0, false],
      [0, 1, false],
      [1, 1, true],
    ] as const) {
      const state = Statevector.zeroState(3);
      if (c1) state.applyMatrix(0, PAULI_X);
      if (c2) state.applyMatrix(1, PAULI_X);
      state.applyCcx(0, 1, 2);
      const targetSet = state.marginalProbability(2);
      expect(targetSet).toBeCloseTo(expectFlip ? 1 : 0, 15);
    }
  });

  it('a controlled matrix matches the dedicated cx kernel', () => {
    const viaGeneric = Statevector.zeroState(2);
    viaGeneric.applyMatrix(0, HADAMARD);
    viaGeneric.applyControlledMatrix([0], 1, PAULI_X);

    const viaKernel = Statevector.zeroState(2);
    viaKernel.applyMatrix(0, HADAMARD);
    viaKernel.applyCx(0, 1);

    expect(viaGeneric.maxAmplitudeDifference(viaKernel)).toBeLessThan(1e-15);
  });

  it('rejects a gate whose control equals its target', () => {
    const state = Statevector.zeroState(2);
    expect(() => state.applyCx(1, 1)).toThrow(/distinct/);
    expect(() => state.applyControlledMatrix([0], 0, PAULI_X)).toThrow(/differ/);
  });

  it('rejects an out-of-range qubit index', () => {
    const state = Statevector.zeroState(2);
    expect(() => state.applyMatrix(2, PAULI_X)).toThrow(/out of range/);
    expect(() => state.applyMatrix(-1, PAULI_X)).toThrow(/out of range/);
  });
});

describe('statevector: entangled states', () => {
  it('prepares the Bell state (|00> + |11>) / sqrt 2', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, HADAMARD);
    state.applyCx(0, 1);

    expect(state.amplitude(0).re).toBeCloseTo(INV_SQRT2, 15);
    expect(state.amplitude(3).re).toBeCloseTo(INV_SQRT2, 15);
    expect(state.amplitude(1).re).toBeCloseTo(0, 15);
    expect(state.amplitude(2).re).toBeCloseTo(0, 15);

    const table = probabilityTable(state, 1e-12);
    expect(table.get('|00>')).toBeCloseTo(0.5, 14);
    expect(table.get('|11>')).toBeCloseTo(0.5, 14);
    expect(table.size).toBe(2);
  });

  it('prepares a three-qubit GHZ state', () => {
    const state = Statevector.zeroState(3);
    state.applyMatrix(0, HADAMARD);
    state.applyCx(0, 1);
    state.applyCx(0, 2);

    const table = probabilityTable(state, 1e-12);
    expect(table.get('|000>')).toBeCloseTo(0.5, 14);
    expect(table.get('|111>')).toBeCloseTo(0.5, 14);
    expect(table.size).toBe(2);
    expect(state.norm()).toBeCloseTo(1, 14);
  });

  it('gives each qubit of a Bell pair a maximally mixed reduced state', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, HADAMARD);
    state.applyCx(0, 1);

    for (const q of [0, 1]) {
      const bloch = state.blochVector(q);
      // An entangled half has a zero-length Bloch vector: the sphere picture
      // does not apply to it on its own.
      expect(bloch.length).toBeCloseTo(0, 14);
      expect(bloch.purity).toBeCloseTo(0.5, 14);
      const [rho00, rho01, , rho11] = state.reducedDensityMatrix(q);
      expect(rho00.re).toBeCloseTo(0.5, 14);
      expect(rho11.re).toBeCloseTo(0.5, 14);
      expect(rho01.re).toBeCloseTo(0, 14);
      expect(rho01.im).toBeCloseTo(0, 14);
    }
  });

  it('gives a product state unit-length Bloch vectors', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, HADAMARD);
    state.applyMatrix(1, ry(0.9));

    const b0 = state.blochVector(0);
    expect(b0.length).toBeCloseTo(1, 13);
    expect(b0.x).toBeCloseTo(1, 13);
    expect(b0.z).toBeCloseTo(0, 13);
    expect(b0.purity).toBeCloseTo(1, 13);

    const b1 = state.blochVector(1);
    expect(b1.length).toBeCloseTo(1, 13);
    expect(b1.z).toBeCloseTo(Math.cos(0.9), 13);
    expect(b1.x).toBeCloseTo(Math.sin(0.9), 13);
  });

  it('places |0> at the north pole and |1> at the south pole', () => {
    const zero = Statevector.zeroState(1);
    expect(zero.blochVector(0).z).toBeCloseTo(1, 15);
    const one = Statevector.zeroState(1);
    one.applyMatrix(0, PAULI_X);
    expect(one.blochVector(0).z).toBeCloseTo(-1, 15);
  });

  it('puts H|0> on the +x axis and S H |0> on the +y axis', () => {
    const plus = Statevector.zeroState(1);
    plus.applyMatrix(0, HADAMARD);
    const bx = plus.blochVector(0);
    expect(bx.x).toBeCloseTo(1, 14);
    expect(bx.y).toBeCloseTo(0, 14);

    const plusI = Statevector.zeroState(1);
    plusI.applyMatrix(0, HADAMARD);
    plusI.applyMatrix(0, phase(Math.PI / 2));
    const by = plusI.blochVector(0);
    expect(by.y).toBeCloseTo(1, 14);
    expect(by.x).toBeCloseTo(0, 14);
  });
});

describe('statevector: collapse and reset', () => {
  it('collapse projects and renormalises, returning the prior probability', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, ry(Math.PI / 3));
    const expectedP1 = Math.sin(Math.PI / 6) ** 2;

    const p = state.collapse(0, 1);
    expect(p).toBeCloseTo(expectedP1, 14);
    expect(state.norm()).toBeCloseTo(1, 14);
    expect(probs(state, 12)).toEqual([0, 1]);
  });

  it('collapse of one Bell qubit determines the other', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, HADAMARD);
    state.applyCx(0, 1);
    state.collapse(0, 1);
    // Collapsing qubit 0 to 1 forces qubit 1 to 1 as well.
    expect(state.marginalProbability(1)).toBeCloseTo(1, 14);
    expect(probs(state, 12)[3]).toBe(1);
  });

  it('refuses to collapse onto a zero-probability outcome', () => {
    const state = Statevector.zeroState(1);
    expect(() => state.collapse(0, 1)).toThrow(/probability 0/);
  });

  it('reset returns a qubit to |0> and keeps its partner correlated', () => {
    const state = Statevector.zeroState(2);
    state.applyMatrix(0, HADAMARD);
    state.applyCx(0, 1);
    // Reset qubit 0 having observed outcome 1: qubit 1 must stay at 1.
    state.resetToZero(0, 1);
    expect(state.marginalProbability(0)).toBeCloseTo(0, 14);
    expect(state.marginalProbability(1)).toBeCloseTo(1, 14);
  });

  it('reset of an unentangled qubit just clears it', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, PAULI_X);
    state.resetToZero(0, 1);
    expect(probs(state, 12)).toEqual([1, 0]);
  });
});

describe('statevector: comparison helpers', () => {
  it('overlapMagnitude ignores a global phase', () => {
    const a = Statevector.zeroState(1);
    a.applyMatrix(0, HADAMARD);
    const b = a.clone();
    b.applyMatrix(0, phase(0)); // no-op
    // Multiply b by exp(i * 1.0) by hand.
    for (let i = 0; i < b.size; i++) {
      const re = b.re[i]!;
      const im = b.im[i]!;
      b.re[i] = re * Math.cos(1) - im * Math.sin(1);
      b.im[i] = re * Math.sin(1) + im * Math.cos(1);
    }
    expect(a.maxAmplitudeDifference(b)).toBeGreaterThan(0.1);
    expect(a.overlapMagnitude(b)).toBeCloseTo(1, 14);
  });

  it('overlapMagnitude is 0 for orthogonal states', () => {
    const zero = Statevector.zeroState(1);
    const one = Statevector.zeroState(1);
    one.applyMatrix(0, PAULI_X);
    expect(zero.overlapMagnitude(one)).toBeCloseTo(0, 15);
  });

  it('normalize fixes accumulated drift', () => {
    const state = Statevector.fromAmplitudes([complex(2), complex(0)]);
    expect(state.norm()).toBe(4);
    state.normalize();
    expect(state.norm()).toBeCloseTo(1, 15);
  });
});
