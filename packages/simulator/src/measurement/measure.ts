import type { Prng } from '../rng/prng.js';
import type { Statevector } from '../statevector/statevector.js';

export interface MeasurementOutcome {
  readonly qubit: number;
  readonly outcome: 0 | 1;
  /** Probability of outcome 0 *before* the measurement. */
  readonly p0: number;
  /** Probability of outcome 1 *before* the measurement. */
  readonly p1: number;
}

/**
 * Measure one qubit in the computational basis and collapse the state.
 *
 * The three things that have to be kept distinct, and are:
 *
 *  1. **The exact probabilities** `p0` and `p1`, computed from the amplitudes
 *     by the Born rule. These are properties of the state, not of this run.
 *  2. **The sampled outcome**, drawn from that distribution with the seeded
 *     PRNG. A single run yields one outcome, not a distribution.
 *  3. **The post-measurement state**, obtained by projecting onto the observed
 *     outcome and renormalising.
 *
 * The studio shows all three, because conflating them is the single most common
 * misunderstanding about quantum measurement — and a simulator that reported
 * `p1` as "the result" would be teaching the misunderstanding.
 */
export function measureQubit(state: Statevector, qubit: number, rng: Prng): MeasurementOutcome {
  const p1 = state.marginalProbability(qubit);
  const p0 = 1 - p1;
  const outcome: 0 | 1 = rng.nextFloat() < p1 ? 1 : 0;
  state.collapse(qubit, outcome);
  return { qubit, outcome, p0, p1 };
}

/**
 * Measure and discard the result, forcing the qubit back to `|0>`.
 *
 * `reset` is a measurement followed by a conditional bit flip, not a
 * projection onto `|0>`. The distinction matters whenever the qubit is
 * entangled: resetting one half of a Bell pair must leave the other half in a
 * definite state correlated with the outcome that actually occurred, and the
 * only way to get that right is to sample the outcome.
 */
export function resetQubit(state: Statevector, qubit: number, rng: Prng): MeasurementOutcome {
  const p1 = state.marginalProbability(qubit);
  const p0 = 1 - p1;
  const outcome: 0 | 1 = rng.nextFloat() < p1 ? 1 : 0;
  state.resetToZero(qubit, outcome);
  return { qubit, outcome, p0, p1 };
}

/**
 * Draw one basis-state index from `|amplitude|^2` by inverse-transform
 * sampling over the cumulative distribution.
 *
 * The final clamp guards against the cumulative sum falling a few ulps short
 * of 1: without it a draw very close to 1 could fall through the loop and
 * return an invalid index.
 */
export function sampleBasisState(probabilities: Float64Array, rng: Prng): number {
  const u = rng.nextFloat();
  let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i]!;
    if (u < cumulative) return i;
  }
  return probabilities.length - 1;
}

/**
 * Draw `shots` basis-state indices at once.
 *
 * Builds the cumulative distribution once and binary-searches it per shot, so
 * sampling 1e6 shots from a 14-qubit state costs O(2^n + shots * n) rather
 * than O(shots * 2^n).
 */
export function sampleManyBasisStates(
  probabilities: Float64Array,
  shots: number,
  rng: Prng,
): Int32Array {
  const size = probabilities.length;
  const cumulative = new Float64Array(size);
  let running = 0;
  for (let i = 0; i < size; i++) {
    running += probabilities[i]!;
    cumulative[i] = running;
  }

  const out = new Int32Array(shots);
  for (let s = 0; s < shots; s++) {
    const u = rng.nextFloat() * running;
    let low = 0;
    let high = size - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid]! < u) low = mid + 1;
      else high = mid;
    }
    out[s] = low;
  }
  return out;
}
