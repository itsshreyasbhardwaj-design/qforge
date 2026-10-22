import { describe, expect, it } from 'vitest';
import {
  abs,
  absSquared,
  add,
  arg,
  conj,
  complex,
  dagger2,
  equalsApprox,
  expI,
  formatComplex,
  I,
  isUnitary2,
  mul,
  multiply2,
  ONE,
  scale,
  sub,
  ZERO,
  type Matrix2,
} from './complex.js';
import { FIXED_MATRICES, phase, rx, ry, rz } from '../gates/matrices.js';

describe('complex arithmetic', () => {
  it('adds, subtracts and scales componentwise', () => {
    expect(add(complex(1, 2), complex(3, -1))).toEqual(complex(4, 1));
    expect(sub(complex(1, 2), complex(3, -1))).toEqual(complex(-2, 3));
    expect(scale(complex(1, -2), 3)).toEqual(complex(3, -6));
  });

  it('multiplies with the right cross terms', () => {
    // (1+2i)(3+4i) = 3 + 4i + 6i + 8i^2 = -5 + 10i
    expect(mul(complex(1, 2), complex(3, 4))).toEqual(complex(-5, 10));
    expect(mul(I, I)).toEqual(complex(-1, 0));
  });

  it('computes modulus and argument', () => {
    expect(absSquared(complex(3, 4))).toBe(25);
    expect(abs(complex(3, 4))).toBe(5);
    expect(arg(complex(0, 1))).toBeCloseTo(Math.PI / 2, 15);
    expect(arg(complex(-1, 0))).toBeCloseTo(Math.PI, 15);
  });

  it('conjugates and satisfies z * conj(z) = |z|^2', () => {
    const z = complex(0.6, -0.8);
    expect(conj(z)).toEqual(complex(0.6, 0.8));
    expect(mul(z, conj(z)).re).toBeCloseTo(absSquared(z), 15);
    expect(mul(z, conj(z)).im).toBeCloseTo(0, 15);
  });

  it('expI lands on the unit circle', () => {
    for (const theta of [0, 0.3, Math.PI / 4, Math.PI, -2.1, 7]) {
      expect(abs(expI(theta))).toBeCloseTo(1, 15);
    }
    expect(equalsApprox(expI(0), ONE)).toBe(true);
    expect(equalsApprox(expI(Math.PI / 2), I, 1e-15)).toBe(true);
  });

  it('formats for display', () => {
    expect(formatComplex(ZERO)).toBe('0');
    expect(formatComplex(complex(0.7071067, 0))).toBe('0.7071 + 0.0000i');
    expect(formatComplex(complex(0, -0.5))).toBe('0.0000 - 0.5000i');
  });
});

describe('2x2 matrix algebra', () => {
  it('multiplies in the correct order', () => {
    const x: Matrix2 = [ZERO, ONE, ONE, ZERO];
    const z: Matrix2 = [ONE, ZERO, ZERO, complex(-1)];
    // XZ = [[0,-1],[1,0]], ZX = [[0,1],[-1,0]]: they anticommute, so order matters.
    expect(multiply2(x, z)[1]).toEqual(complex(-1));
    expect(multiply2(z, x)[1]).toEqual(complex(1));
  });

  it('dagger conjugate-transposes', () => {
    const m: Matrix2 = [complex(1, 1), complex(2, 2), complex(3, 3), complex(4, 4)];
    const d = dagger2(m);
    expect(d[0]).toEqual(complex(1, -1));
    expect(d[1]).toEqual(complex(3, -3));
    expect(d[2]).toEqual(complex(2, -2));
  });
});

describe('gate matrices are unitary', () => {
  it.each(Object.entries(FIXED_MATRICES))('%s is unitary', (_name, m) => {
    expect(isUnitary2(m)).toBe(true);
  });

  const angles = [0, 0.1, Math.PI / 4, Math.PI / 2, Math.PI, 2.5, -1.3, 4 * Math.PI];

  it.each(angles)('rx(%f) is unitary', (theta) => {
    expect(isUnitary2(rx(theta))).toBe(true);
  });
  it.each(angles)('ry(%f) is unitary', (theta) => {
    expect(isUnitary2(ry(theta))).toBe(true);
  });
  it.each(angles)('rz(%f) is unitary', (theta) => {
    expect(isUnitary2(rz(theta))).toBe(true);
  });
  it.each(angles)('p(%f) is unitary', (theta) => {
    expect(isUnitary2(phase(theta))).toBe(true);
  });

  it('detects a non-unitary matrix', () => {
    expect(isUnitary2([complex(2), ZERO, ZERO, ONE])).toBe(false);
  });
});

describe('gate matrix identities', () => {
  it('H is its own inverse', () => {
    const product = multiply2(FIXED_MATRICES.h!, FIXED_MATRICES.h!);
    expect(equalsApprox(product[0], ONE, 1e-15)).toBe(true);
    expect(equalsApprox(product[1], ZERO, 1e-15)).toBe(true);
  });

  it('S squared is Z, and T squared is S', () => {
    const sSquared = multiply2(FIXED_MATRICES.s!, FIXED_MATRICES.s!);
    expect(equalsApprox(sSquared[3], complex(-1), 1e-15)).toBe(true);
    const tSquared = multiply2(FIXED_MATRICES.t!, FIXED_MATRICES.t!);
    expect(equalsApprox(tSquared[3], I, 1e-15)).toBe(true);
  });

  it('s and sdg, t and tdg are exact inverses', () => {
    for (const [a, b] of [
      [FIXED_MATRICES.s!, FIXED_MATRICES.sdg!],
      [FIXED_MATRICES.t!, FIXED_MATRICES.tdg!],
    ]) {
      const product = multiply2(a, b);
      expect(equalsApprox(product[0], ONE, 1e-15)).toBe(true);
      expect(equalsApprox(product[3], ONE, 1e-15)).toBe(true);
    }
  });

  it('rx(pi) equals -i X, not X: the global phase is kept', () => {
    const m = rx(Math.PI);
    expect(equalsApprox(m[0], ZERO, 1e-15)).toBe(true);
    expect(equalsApprox(m[1], complex(0, -1), 1e-15)).toBe(true);
  });

  it('rotations compose additively: R(a) R(b) = R(a + b)', () => {
    for (const build of [rx, ry, rz, phase]) {
      const composed = multiply2(build(0.7), build(1.1));
      const direct = build(1.8);
      for (let i = 0; i < 4; i++) {
        expect(equalsApprox(composed[i]!, direct[i]!, 1e-14)).toBe(true);
      }
    }
  });

  it('a rotation is the identity at 4*pi but minus the identity at 2*pi', () => {
    const atFourPi = rx(4 * Math.PI);
    expect(equalsApprox(atFourPi[0], ONE, 1e-14)).toBe(true);
    const atTwoPi = rx(2 * Math.PI);
    expect(equalsApprox(atTwoPi[0], complex(-1), 1e-14)).toBe(true);
  });

  it('rz is p up to a global phase', () => {
    // rz(t) = exp(-i t / 2) * p(t)
    const theta = 0.9;
    const a = rz(theta);
    const b = phase(theta);
    const factor = expI(-theta / 2);
    expect(equalsApprox(a[0]!, mul(factor, b[0]!), 1e-15)).toBe(true);
    expect(equalsApprox(a[3]!, mul(factor, b[3]!), 1e-15)).toBe(true);
  });
});
