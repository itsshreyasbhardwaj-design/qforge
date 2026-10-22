/**
 * Deterministic pseudo-random number generator: xoshiro128** seeded by
 * splitmix32.
 *
 * Why not `Math.random()`: measurement sampling has to be reproducible. Given
 * the same circuit, shot count and seed, QForge must produce the same outcomes
 * on every machine and in every run — that is what makes a measurement bug
 * debuggable and a documented example checkable in CI.
 *
 * xoshiro128** has a period of 2^128 - 1 and passes the standard statistical
 * batteries, which is well beyond what shot sampling needs; the choice is for
 * the quality of the low bits, where simple linear congruential generators are
 * weak and would bias per-shot outcomes.
 */
export class Prng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    // splitmix32 expands a single 32-bit seed into four well-mixed words, so
    // nearby seeds (0, 1, 2) give unrelated streams.
    let x = seed | 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    // An all-zero state is a fixed point of xoshiro; splitmix32 makes this
    // essentially impossible, but the guard costs nothing.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);

    return result;
  }

  /** Uniform double in [0, 1). Uses 53 bits of randomness. */
  nextFloat(): number {
    const high = this.nextUint32() >>> 5; // 27 bits
    const low = this.nextUint32() >>> 6; // 26 bits
    return (high * 67108864 + low) / 9007199254740992;
  }

  /** Uniform integer in [0, bound). */
  nextInt(bound: number): number {
    return Math.floor(this.nextFloat() * bound);
  }
}

/**
 * Derive a seed when the caller did not supply one.
 *
 * Returning a value rather than silently using `Math.random()` internally
 * means the chosen seed can be reported back to the user, so an interesting
 * run is always reproducible after the fact.
 */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
