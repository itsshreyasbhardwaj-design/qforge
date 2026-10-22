/**
 * Minimal complex arithmetic.
 *
 * The statevector itself does *not* store values of this type: it keeps two
 * `Float64Array`s (real and imaginary parts) so that applying a gate touches
 * contiguous memory and allocates nothing. `Complex` is for gate matrices,
 * density-matrix entries and anything user-facing, where there are a handful of
 * values and clarity matters more than throughput.
 */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const complex = (re: number, im = 0): Complex => ({ re, im });

export const ZERO: Complex = { re: 0, im: 0 };
export const ONE: Complex = { re: 1, im: 0 };
export const I: Complex = { re: 0, im: 1 };

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });

export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

/** Squared modulus |z|^2. This is the Born-rule probability weight. */
export const absSquared = (a: Complex): number => a.re * a.re + a.im * a.im;

export const abs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Argument in (-pi, pi]. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);

/** exp(i * theta). */
export const expI = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) });

export const equalsApprox = (a: Complex, b: Complex, tolerance = 1e-12): boolean =>
  Math.abs(a.re - b.re) <= tolerance && Math.abs(a.im - b.im) <= tolerance;

/**
 * Format as `a + bi` with a fixed number of decimals.
 * Exact zeros print as `0` so a sparse statevector reads cleanly.
 */
export function formatComplex(a: Complex, digits = 4): string {
  if (a.re === 0 && a.im === 0) return '0';
  const re = a.re.toFixed(digits);
  const im = Math.abs(a.im).toFixed(digits);
  const sign = a.im < 0 ? '-' : '+';
  return `${re} ${sign} ${im}i`;
}

/**
 * A 2x2 complex matrix in row-major order: `[m00, m01, m10, m11]`.
 *
 * Stored flat rather than nested so a gate kernel can destructure it once
 * outside its inner loop.
 */
export type Matrix2 = readonly [Complex, Complex, Complex, Complex];

export function matrix2(m00: Complex, m01: Complex, m10: Complex, m11: Complex): Matrix2 {
  return [m00, m01, m10, m11];
}

/** Matrix product A * B. */
export function multiply2(a: Matrix2, b: Matrix2): Matrix2 {
  return [
    add(mul(a[0], b[0]), mul(a[1], b[2])),
    add(mul(a[0], b[1]), mul(a[1], b[3])),
    add(mul(a[2], b[0]), mul(a[3], b[2])),
    add(mul(a[2], b[1]), mul(a[3], b[3])),
  ];
}

/** Conjugate transpose. */
export function dagger2(m: Matrix2): Matrix2 {
  return [conj(m[0]), conj(m[2]), conj(m[1]), conj(m[3])];
}

export const IDENTITY2: Matrix2 = [ONE, ZERO, ZERO, ONE];

/**
 * Is `m` unitary, i.e. `m m^dagger = I` to within `tolerance`?
 *
 * Every gate matrix is checked against this in the test suite. A non-unitary
 * gate would silently break normalisation and therefore every probability the
 * simulator reports, so it is worth asserting rather than assuming.
 */
export function isUnitary2(m: Matrix2, tolerance = 1e-12): boolean {
  const product = multiply2(m, dagger2(m));
  return (
    equalsApprox(product[0], ONE, tolerance) &&
    equalsApprox(product[1], ZERO, tolerance) &&
    equalsApprox(product[2], ZERO, tolerance) &&
    equalsApprox(product[3], ONE, tolerance)
  );
}
