import { describe, expect, it } from 'vitest';
import {
  measureQubit,
  resetQubit,
  sampleBasisState,
  sampleManyBasisStates,
} from './measure.js';
import { Statevector } from '../statevector/statevector.js';
import { HADAMARD, PAULI_X, ry } from '../gates/matrices.js';
import { Prng } from '../rng/prng.js';

const bell = (): Statevector => {
  const state = Statevector.zeroState(2);
  state.applyMatrix(0, HADAMARD);
  state.applyCx(0, 1);
  return state;
};

describe('measurement: exact probabilities', () => {
  it('reports p0 and p1 from the state, independent of the sampled outcome', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, ry(Math.PI / 3));
    const expectedP1 = Math.sin(Math.PI / 6) ** 2;

    const outcome = measureQubit(state, 0, new Prng(1));
    expect(outcome.p1).toBeCloseTo(expectedP1, 14);
    expect(outcome.p0).toBeCloseTo(1 - expectedP1, 14);
    expect(outcome.p0 + outcome.p1).toBeCloseTo(1, 14);
  });

  it('is deterministic for a basis state', () => {
    const zero = Statevector.zeroState(1);
    const zeroOutcome = measureQubit(zero, 0, new Prng(7));
    expect(zeroOutcome.outcome).toBe(0);
    expect(zeroOutcome.p1).toBeCloseTo(0, 15);

    const one = Statevector.zeroState(1);
    one.applyMatrix(0, PAULI_X);
    expect(measureQubit(one, 0, new Prng(7)).outcome).toBe(1);
  });

  it('collapses the state so a repeated measurement agrees', () => {
    const state = Statevector.zeroState(1);
    state.applyMatrix(0, HADAMARD);
    const rng = new Prng(42);
    const first = measureQubit(state, 0, rng);
    for (let i = 0; i < 5; i++) {
      const again = measureQubit(state, 0, rng);
      expect(again.outcome).toBe(first.outcome);
      expect(again.p1).toBeCloseTo(first.outcome === 1 ? 1 : 0, 14);
    }
  });
});

describe('measurement: statistics', () => {
  it('a fair superposition is within sampling error of 50/50', () => {
    const shots = 20_000;
    const rng = new Prng(2024);
    let ones = 0;
    for (let i = 0; i < shots; i++) {
      const state = Statevector.zeroState(1);
      state.applyMatrix(0, HADAMARD);
      ones += measureQubit(state, 0, rng).outcome;
    }
    // Standard error is 0.5/sqrt(shots) ~ 0.0035; 5 sigma is ~0.018.
    expect(ones / shots).toBeGreaterThan(0.482);
    expect(ones / shots).toBeLessThan(0.518);
  });

  it('a biased rotation converges to sin^2(theta/2)', () => {
    const theta = Math.PI / 3;
    const expected = Math.sin(theta / 2) ** 2; // 0.25
    const shots = 20_000;
    const rng = new Prng(99);
    let ones = 0;
    for (let i = 0; i < shots; i++) {
      const state = Statevector.zeroState(1);
      state.applyMatrix(0, ry(theta));
      ones += measureQubit(state, 0, rng).outcome;
    }
    expect(Math.abs(ones / shots - expected)).toBeLessThan(0.02);
  });

  it('Bell-pair outcomes are perfectly correlated in every shot', () => {
    const rng = new Prng(5);
    for (let i = 0; i < 300; i++) {
      const state = bell();
      const a = measureQubit(state, 0, rng).outcome;
      const b = measureQubit(state, 1, rng).outcome;
      expect(b).toBe(a);
    }
  });

  it('measuring the second Bell qubit first gives the same correlation', () => {
    const rng = new Prng(6);
    for (let i = 0; i < 300; i++) {
      const state = bell();
      const b = measureQubit(state, 1, rng).outcome;
      const a = measureQubit(state, 0, rng).outcome;
      expect(a).toBe(b);
    }
  });

  it('both Bell outcomes actually occur', () => {
    const rng = new Prng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(measureQubit(bell(), 0, rng).outcome);
    expect(seen).toEqual(new Set([0, 1]));
  });
});

describe('measurement: reset', () => {
  it('always leaves the qubit in |0>', () => {
    const rng = new Prng(3);
    for (let i = 0; i < 50; i++) {
      const state = Statevector.zeroState(1);
      state.applyMatrix(0, HADAMARD);
      resetQubit(state, 0, rng);
      expect(state.marginalProbability(0)).toBeCloseTo(0, 14);
      expect(state.norm()).toBeCloseTo(1, 14);
    }
  });

  it('keeps an entangled partner correlated with the discarded outcome', () => {
    const rng = new Prng(4);
    let sawOne = false;
    let sawZero = false;
    for (let i = 0; i < 200; i++) {
      const state = bell();
      const outcome = resetQubit(state, 0, rng);
      // Qubit 1 must now be definite, matching the outcome that occurred.
      const partner = state.marginalProbability(1);
      expect(partner).toBeCloseTo(outcome.outcome, 13);
      if (outcome.outcome === 1) sawOne = true;
      else sawZero = true;
    }
    expect(sawOne && sawZero).toBe(true);
  });
});

describe('measurement: seeded reproducibility', () => {
  it('the same seed gives the same outcome sequence', () => {
    const run = (seed: number): number[] => {
      const rng = new Prng(seed);
      return Array.from({ length: 40 }, () => {
        const state = Statevector.zeroState(1);
        state.applyMatrix(0, HADAMARD);
        return measureQubit(state, 0, rng).outcome;
      });
    };
    expect(run(123)).toEqual(run(123));
    expect(run(123)).not.toEqual(run(124));
  });

  it('nearby seeds give uncorrelated streams', () => {
    const first = Array.from({ length: 64 }, (_, i) => new Prng(i).nextUint32());
    expect(new Set(first).size).toBe(64);
  });
});

describe('sampling', () => {
  it('samples a point mass exactly', () => {
    const probabilities = new Float64Array([0, 1, 0, 0]);
    const rng = new Prng(1);
    for (let i = 0; i < 20; i++) expect(sampleBasisState(probabilities, rng)).toBe(1);
  });

  it('respects the distribution', () => {
    const probabilities = new Float64Array([0.1, 0.2, 0.3, 0.4]);
    const shots = 40_000;
    const rng = new Prng(77);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < shots; i++) counts[sampleBasisState(probabilities, rng)]!++;
    counts.forEach((count, i) => {
      expect(Math.abs(count / shots - probabilities[i]!)).toBeLessThan(0.01);
    });
  });

  it('batch sampling matches the distribution', () => {
    const probabilities = new Float64Array([0.5, 0, 0.25, 0.25]);
    const shots = 40_000;
    const samples = sampleManyBasisStates(probabilities, shots, new Prng(8));
    const counts = [0, 0, 0, 0];
    for (const s of samples) counts[s]!++;
    expect(counts[1]).toBe(0);
    expect(Math.abs(counts[0]! / shots - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(counts[2]! / shots - 0.25)).toBeLessThan(0.01);
  });

  it('never returns an out-of-range index even if probabilities sum slightly under 1', () => {
    const probabilities = new Float64Array([0.3, 0.3, 0.3999999]);
    const rng = new Prng(12);
    for (let i = 0; i < 2000; i++) {
      const index = sampleBasisState(probabilities, rng);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });
});
