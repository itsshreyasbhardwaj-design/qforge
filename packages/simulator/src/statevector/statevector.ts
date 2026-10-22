import { HARD_MAX_QUBITS, statevectorBytes } from '@qforge/language';
import { absSquared, complex, type Complex, type Matrix2 } from '../complex/complex.js';

/**
 * A pure quantum state of `qubitCount` qubits, as `2^n` complex amplitudes.
 *
 * ## Indexing convention
 *
 * Amplitude `k` is the coefficient of the computational basis state whose
 * qubit `j` has value `(k >> j) & 1`. So **qubit 0 is the least significant
 * bit** of the amplitude index — the same little-endian convention Qiskit and
 * OpenQASM use.
 *
 * Ket labels follow ordinary binary writing, most significant bit first:
 * `|b_{n-1} ... b_1 b_0>`, so **qubit 0 appears rightmost**. On two qubits,
 * `x q[0]` therefore produces amplitude index 1, displayed as `|01>`.
 *
 * This one convention is used by the simulator, the studio and the OpenQASM
 * backend without exception; `docs/quantum-math.md` works through the
 * consequences, and `bit-order.test.ts` pins it down with asymmetric circuits
 * that would pass under either convention if they were symmetric.
 *
 * ## Storage
 *
 * Real and imaginary parts live in two separate `Float64Array`s rather than an
 * array of objects. A gate kernel then reads and writes contiguous doubles with
 * no allocation and no pointer chasing, which is the difference between a
 * 14-qubit circuit running in milliseconds and in seconds.
 */
export class Statevector {
  readonly qubitCount: number;
  /** Number of amplitudes, `2^qubitCount`. */
  readonly size: number;
  readonly re: Float64Array;
  readonly im: Float64Array;

  private constructor(qubitCount: number, re: Float64Array, im: Float64Array) {
    this.qubitCount = qubitCount;
    this.size = re.length;
    this.re = re;
    this.im = im;
  }

  /**
   * Allocate the all-zeros basis state `|00...0>`.
   *
   * @throws RangeError if `qubitCount` exceeds the hard ceiling. The limit is
   * enforced here as well as in the frontend because the simulator is a public
   * API that can be called without going through the compiler.
   */
  static zeroState(qubitCount: number): Statevector {
    if (!Number.isInteger(qubitCount) || qubitCount < 0) {
      throw new RangeError(`qubitCount must be a non-negative integer, got ${qubitCount}`);
    }
    if (qubitCount > HARD_MAX_QUBITS) {
      throw new RangeError(
        `${qubitCount} qubits would need ${statevectorBytes(qubitCount)} bytes of amplitudes; the hard limit is ${HARD_MAX_QUBITS} qubits`,
      );
    }
    const size = 2 ** qubitCount;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    re[0] = 1;
    return new Statevector(qubitCount, re, im);
  }

  /** Build a state from explicit amplitudes. Used by tests and the reference oracle. */
  static fromAmplitudes(amplitudes: readonly Complex[]): Statevector {
    const size = amplitudes.length;
    const qubitCount = Math.log2(size);
    if (!Number.isInteger(qubitCount)) {
      throw new RangeError(`Amplitude count must be a power of two, got ${size}`);
    }
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    amplitudes.forEach((a, i) => {
      re[i] = a.re;
      im[i] = a.im;
    });
    return new Statevector(qubitCount, re, im);
  }

  clone(): Statevector {
    return new Statevector(this.qubitCount, this.re.slice(), this.im.slice());
  }

  amplitude(index: number): Complex {
    return complex(this.re[index] ?? 0, this.im[index] ?? 0);
  }

  amplitudes(): Complex[] {
    return Array.from({ length: this.size }, (_, i) => this.amplitude(i));
  }

  /** Born-rule probability of each basis state. Sums to 1 for a valid state. */
  probabilities(): Float64Array {
    const out = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const r = this.re[i]!;
      const m = this.im[i]!;
      out[i] = r * r + m * m;
    }
    return out;
  }

  /** Total probability. Should be 1; the deviation measures accumulated error. */
  norm(): number {
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      const r = this.re[i]!;
      const m = this.im[i]!;
      sum += r * r + m * m;
    }
    return sum;
  }

  /** Probability that qubit `target` is measured as 1, without collapsing. */
  marginalProbability(target: number): number {
    this.assertQubit(target);
    const bit = 1 << target;
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      if ((i & bit) !== 0) {
        const r = this.re[i]!;
        const m = this.im[i]!;
        sum += r * r + m * m;
      }
    }
    return sum;
  }

  /**
   * Ket label for amplitude index `k`, most significant qubit first.
   * Index 1 on two qubits renders as `|01>`: qubit 0 is the rightmost digit.
   */
  basisLabel(index: number): string {
    if (this.qubitCount === 0) return '|>';
    let bits = '';
    for (let j = this.qubitCount - 1; j >= 0; j--) bits += (index >> j) & 1;
    return `|${bits}>`;
  }

  // ------------------------------------------------------------------ kernels

  /**
   * Apply a 2x2 matrix to `target`.
   *
   * The loop pairs each amplitude index with `target`'s bit clear against the
   * one with it set. Those two amplitudes are the qubit's `|0>` and `|1>`
   * components with all other qubits held fixed, so the 2x2 matrix acts on them
   * directly. Stepping over blocks of `2 * stride` visits every pair exactly
   * once with no index arithmetic in the inner loop.
   *
   * Cost: `2^(n-1)` pair updates, i.e. O(2^n) time and no extra space.
   */
  applyMatrix(target: number, m: Matrix2): void {
    this.assertQubit(target);
    const [m00, m01, m10, m11] = m;
    const stride = 1 << target;
    const { re, im, size } = this;

    for (let base = 0; base < size; base += stride << 1) {
      for (let offset = 0; offset < stride; offset++) {
        const i0 = base + offset;
        const i1 = i0 + stride;

        const a0 = re[i0]!;
        const b0 = im[i0]!;
        const a1 = re[i1]!;
        const b1 = im[i1]!;

        re[i0] = m00.re * a0 - m00.im * b0 + (m01.re * a1 - m01.im * b1);
        im[i0] = m00.re * b0 + m00.im * a0 + (m01.re * b1 + m01.im * a1);
        re[i1] = m10.re * a0 - m10.im * b0 + (m11.re * a1 - m11.im * b1);
        im[i1] = m10.re * b0 + m10.im * a0 + (m11.re * b1 + m11.im * a1);
      }
    }
  }

  /**
   * Apply a 2x2 matrix to `target`, but only on amplitudes where every qubit in
   * `controls` is 1. This covers controlled gates generally; `cx`, `cz`, `swap`
   * and `ccx` have faster dedicated kernels below.
   */
  applyControlledMatrix(controls: readonly number[], target: number, m: Matrix2): void {
    this.assertQubit(target);
    let mask = 0;
    for (const control of controls) {
      this.assertQubit(control);
      if (control === target) {
        throw new RangeError(`Control and target must differ (both are qubit ${target})`);
      }
      mask |= 1 << control;
    }

    const [m00, m01, m10, m11] = m;
    const targetBit = 1 << target;
    const { re, im, size } = this;

    for (let i0 = 0; i0 < size; i0++) {
      if ((i0 & targetBit) !== 0) continue;
      if ((i0 & mask) !== mask) continue;
      const i1 = i0 | targetBit;

      const a0 = re[i0]!;
      const b0 = im[i0]!;
      const a1 = re[i1]!;
      const b1 = im[i1]!;

      re[i0] = m00.re * a0 - m00.im * b0 + (m01.re * a1 - m01.im * b1);
      im[i0] = m00.re * b0 + m00.im * a0 + (m01.re * b1 + m01.im * a1);
      re[i1] = m10.re * a0 - m10.im * b0 + (m11.re * a1 - m11.im * b1);
      im[i1] = m10.re * b0 + m10.im * a0 + (m11.re * b1 + m11.im * a1);
    }
  }

  /**
   * Controlled-NOT. Exchanges the amplitudes that differ only in `target`,
   * among indices where `control` is 1 — a permutation, so no arithmetic is
   * needed at all.
   */
  applyCx(control: number, target: number): void {
    this.assertDistinct(control, target);
    const controlBit = 1 << control;
    const targetBit = 1 << target;
    const { re, im, size } = this;

    for (let i = 0; i < size; i++) {
      // Visit each pair once by only acting from the target-clear side.
      if ((i & controlBit) === 0 || (i & targetBit) !== 0) continue;
      const j = i | targetBit;
      const tr = re[i]!;
      const ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }

  /**
   * Toffoli. Same permutation as `cx` with two control bits.
   */
  applyCcx(control1: number, control2: number, target: number): void {
    this.assertDistinct(control1, target);
    this.assertDistinct(control2, target);
    this.assertDistinct(control1, control2);
    const mask = (1 << control1) | (1 << control2);
    const targetBit = 1 << target;
    const { re, im, size } = this;

    for (let i = 0; i < size; i++) {
      if ((i & mask) !== mask || (i & targetBit) !== 0) continue;
      const j = i | targetBit;
      const tr = re[i]!;
      const ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }

  /**
   * Controlled-Z: negate the amplitudes where both qubits are 1. Diagonal, so
   * this is a sign flip on a quarter of the amplitudes and nothing else. It is
   * symmetric in its operands, which the compiler's cancellation pass relies on.
   */
  applyCz(a: number, b: number): void {
    this.assertDistinct(a, b);
    const mask = (1 << a) | (1 << b);
    const { re, im, size } = this;
    for (let i = 0; i < size; i++) {
      if ((i & mask) === mask) {
        re[i] = -re[i]!;
        im[i] = -im[i]!;
      }
    }
  }

  /** SWAP: exchange amplitudes whose `a` and `b` bits differ. */
  applySwap(a: number, b: number): void {
    this.assertDistinct(a, b);
    const bitA = 1 << a;
    const bitB = 1 << b;
    const { re, im, size } = this;

    for (let i = 0; i < size; i++) {
      // Act only on the (a=1, b=0) half so each pair is swapped once.
      if ((i & bitA) === 0 || (i & bitB) !== 0) continue;
      const j = (i & ~bitA) | bitB;
      const tr = re[i]!;
      const ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }

  /**
   * Project onto `outcome` for `target` and renormalise: the state-update rule
   * for a measurement whose result is already known.
   *
   * @returns the probability of that outcome before projection
   * @throws RangeError if the outcome had zero probability, which would make
   * the post-measurement state undefined rather than merely unlikely.
   */
  collapse(target: number, outcome: 0 | 1): number {
    this.assertQubit(target);
    const bit = 1 << target;
    const { re, im, size } = this;

    let probability = 0;
    for (let i = 0; i < size; i++) {
      const matches = ((i & bit) !== 0 ? 1 : 0) === outcome;
      if (matches) {
        const r = re[i]!;
        const m = im[i]!;
        probability += r * r + m * m;
      }
    }

    if (probability <= 0) {
      throw new RangeError(
        `Cannot collapse qubit ${target} to ${outcome}: that outcome has probability 0`,
      );
    }

    const scale = 1 / Math.sqrt(probability);
    for (let i = 0; i < size; i++) {
      if (((i & bit) !== 0 ? 1 : 0) === outcome) {
        re[i] = re[i]! * scale;
        im[i] = im[i]! * scale;
      } else {
        re[i] = 0;
        im[i] = 0;
      }
    }
    return probability;
  }

  /**
   * Reset `target` to `|0>`.
   *
   * Implemented as the physical operation it is: measure, discard the result,
   * then flip if the result was 1. Modelling it as "zero the |1> amplitudes"
   * would be wrong for an entangled qubit, because reset is not a projection —
   * it is a measurement followed by a conditional flip, and the partner qubit
   * must stay correlated with the outcome that actually occurred.
   */
  resetToZero(target: number, outcome: 0 | 1): void {
    this.collapse(target, outcome);
    if (outcome === 1)
      this.applyMatrix(target, [
        { re: 0, im: 0 },
        { re: 1, im: 0 },
        { re: 1, im: 0 },
        { re: 0, im: 0 },
      ]);
  }

  /**
   * Reduced density matrix of one qubit, as `[rho00, rho01, rho10, rho11]`.
   *
   * `rho_ab = sum over the other qubits of psi_{a,rest} * conj(psi_{b,rest})`,
   * i.e. the partial trace over everything except `target`. For an entangled
   * qubit this is a genuinely mixed state, which is why the studio draws its
   * Bloch vector shorter than the unit sphere instead of pretending the qubit
   * has a pure state of its own.
   */
  reducedDensityMatrix(target: number): [Complex, Complex, Complex, Complex] {
    this.assertQubit(target);
    const bit = 1 << target;
    const { re, im, size } = this;

    let r00 = 0;
    let r11 = 0;
    let r01re = 0;
    let r01im = 0;

    for (let i = 0; i < size; i++) {
      if ((i & bit) !== 0) continue;
      const j = i | bit;
      const a0 = re[i]!;
      const b0 = im[i]!;
      const a1 = re[j]!;
      const b1 = im[j]!;

      r00 += a0 * a0 + b0 * b0;
      r11 += a1 * a1 + b1 * b1;
      // rho01 = sum psi_0 * conj(psi_1)
      r01re += a0 * a1 + b0 * b1;
      r01im += b0 * a1 - a0 * b1;
    }

    return [complex(r00), complex(r01re, r01im), complex(r01re, -r01im), complex(r11)];
  }

  /**
   * Bloch vector of one qubit, from its reduced density matrix.
   *
   * With `rho = (I + x X + y Y + z Z) / 2` we have `rho01 = (x - i y) / 2` and
   * `z = rho00 - rho11`, hence the expressions below. `length` is 1 exactly for
   * a pure single-qubit state and strictly less than 1 when the qubit is
   * entangled with others or otherwise mixed.
   */
  blochVector(target: number): {
    x: number;
    y: number;
    z: number;
    length: number;
    purity: number;
  } {
    const [rho00, rho01, , rho11] = this.reducedDensityMatrix(target);
    const x = 2 * rho01.re;
    const y = -2 * rho01.im;
    const z = rho00.re - rho11.re;
    const length = Math.hypot(x, y, z);
    // purity = tr(rho^2) = (1 + |r|^2) / 2
    return { x, y, z, length, purity: (1 + length * length) / 2 };
  }

  /** Renormalise to unit length, correcting accumulated floating-point drift. */
  normalize(): void {
    const norm = this.norm();
    if (norm <= 0) throw new RangeError('Cannot normalise a zero state');
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < this.size; i++) {
      this.re[i] = this.re[i]! * scale;
      this.im[i] = this.im[i]! * scale;
    }
  }

  /** Largest absolute difference in amplitudes. Used by the reference tests. */
  maxAmplitudeDifference(other: Statevector): number {
    if (other.size !== this.size) {
      throw new RangeError(`Size mismatch: ${this.size} vs ${other.size}`);
    }
    let worst = 0;
    for (let i = 0; i < this.size; i++) {
      worst = Math.max(
        worst,
        Math.hypot(this.re[i]! - other.re[i]!, this.im[i]! - other.im[i]!),
      );
    }
    return worst;
  }

  /**
   * Fidelity-style comparison that ignores a global phase: `|<psi|phi>|`.
   *
   * Two states differing only by an overall factor `exp(i*alpha)` are the same
   * physical state and give identical measurement statistics, so comparisons
   * against an independent implementation use this rather than amplitude-wise
   * equality, which would flag a harmless phase convention difference.
   */
  overlapMagnitude(other: Statevector): number {
    if (other.size !== this.size) {
      throw new RangeError(`Size mismatch: ${this.size} vs ${other.size}`);
    }
    let re = 0;
    let im = 0;
    for (let i = 0; i < this.size; i++) {
      // <psi|phi> = sum conj(psi_i) phi_i
      re += this.re[i]! * other.re[i]! + this.im[i]! * other.im[i]!;
      im += this.re[i]! * other.im[i]! - this.im[i]! * other.re[i]!;
    }
    return Math.hypot(re, im);
  }

  private assertQubit(target: number): void {
    if (!Number.isInteger(target) || target < 0 || target >= this.qubitCount) {
      throw new RangeError(
        `Qubit index ${target} is out of range for a ${this.qubitCount}-qubit state`,
      );
    }
  }

  private assertDistinct(a: number, b: number): void {
    this.assertQubit(a);
    this.assertQubit(b);
    if (a === b) throw new RangeError(`Operands must be distinct qubits (both are ${a})`);
  }
}

/** Probabilities of each measured basis state, keyed by ket label. */
export function probabilityTable(state: Statevector, threshold = 0): Map<string, number> {
  const out = new Map<string, number>();
  const probabilities = state.probabilities();
  for (let i = 0; i < state.size; i++) {
    const p = probabilities[i]!;
    if (p > threshold) out.set(state.basisLabel(i), p);
  }
  return out;
}

export { absSquared };
