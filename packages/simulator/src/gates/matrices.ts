import { Opcode } from '@qforge/compiler';
import { complex, expI, matrix2, ONE, ZERO, type Matrix2 } from '../complex/complex.js';

/**
 * Gate matrices in the computational basis `{|0>, |1>}`.
 *
 * Conventions, fixed here and documented in docs/quantum-math.md:
 *
 *   X  = [[0, 1], [1, 0]]
 *   Y  = [[0, -i], [i, 0]]
 *   Z  = [[1, 0], [0, -1]]
 *   H  = (1/sqrt 2) [[1, 1], [1, -1]]
 *
 * Rotations use the standard `exp(-i * theta * sigma / 2)` definition, so
 * `rx(pi)` equals `-i X` rather than `X`: they differ by a global phase, which
 * is physically unobservable but visible in the statevector the debugger shows.
 * QForge keeps the textbook definition rather than quietly dropping the phase.
 *
 *   rx(t) = [[cos(t/2), -i sin(t/2)], [-i sin(t/2), cos(t/2)]]
 *   ry(t) = [[cos(t/2), -sin(t/2)],  [sin(t/2),     cos(t/2)]]
 *   rz(t) = [[exp(-i t/2), 0],       [0,            exp(i t/2)]]
 *   p(t)  = [[1, 0],                 [0,            exp(i t)]]
 */

const INV_SQRT2 = 1 / Math.SQRT2;

export const HADAMARD: Matrix2 = matrix2(
  complex(INV_SQRT2),
  complex(INV_SQRT2),
  complex(INV_SQRT2),
  complex(-INV_SQRT2),
);

export const PAULI_X: Matrix2 = matrix2(ZERO, ONE, ONE, ZERO);
export const PAULI_Y: Matrix2 = matrix2(ZERO, complex(0, -1), complex(0, 1), ZERO);
export const PAULI_Z: Matrix2 = matrix2(ONE, ZERO, ZERO, complex(-1));
export const IDENTITY: Matrix2 = matrix2(ONE, ZERO, ZERO, ONE);

/** S = p(pi/2). Written as an exact `i` rather than `exp(i*pi/2)` to avoid rounding. */
export const S_GATE: Matrix2 = matrix2(ONE, ZERO, ZERO, complex(0, 1));
export const S_DAGGER: Matrix2 = matrix2(ONE, ZERO, ZERO, complex(0, -1));

/** T = p(pi/4). */
export const T_GATE: Matrix2 = matrix2(ONE, ZERO, ZERO, expI(Math.PI / 4));
export const T_DAGGER: Matrix2 = matrix2(ONE, ZERO, ZERO, expI(-Math.PI / 4));

export function rx(theta: number): Matrix2 {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return matrix2(complex(c), complex(0, -s), complex(0, -s), complex(c));
}

export function ry(theta: number): Matrix2 {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return matrix2(complex(c), complex(-s), complex(s), complex(c));
}

export function rz(theta: number): Matrix2 {
  return matrix2(expI(-theta / 2), ZERO, ZERO, expI(theta / 2));
}

export function phase(theta: number): Matrix2 {
  return matrix2(ONE, ZERO, ZERO, expI(theta));
}

/**
 * The 2x2 matrix for a single-qubit opcode, or undefined if the opcode is not
 * a single-qubit gate (two-qubit gates have dedicated kernels, and
 * measure/reset/barrier are not unitary at all).
 */
export function singleQubitMatrix(
  opcode: Opcode,
  params: readonly number[],
): Matrix2 | undefined {
  switch (opcode) {
    case Opcode.Id:
      return IDENTITY;
    case Opcode.H:
      return HADAMARD;
    case Opcode.X:
      return PAULI_X;
    case Opcode.Y:
      return PAULI_Y;
    case Opcode.Z:
      return PAULI_Z;
    case Opcode.S:
      return S_GATE;
    case Opcode.Sdg:
      return S_DAGGER;
    case Opcode.T:
      return T_GATE;
    case Opcode.Tdg:
      return T_DAGGER;
    case Opcode.Rx:
      return rx(params[0] ?? 0);
    case Opcode.Ry:
      return ry(params[0] ?? 0);
    case Opcode.Rz:
      return rz(params[0] ?? 0);
    case Opcode.P:
      return phase(params[0] ?? 0);
    default:
      return undefined;
  }
}

/** Every fixed (non-parameterised) single-qubit matrix, for unitarity tests. */
export const FIXED_MATRICES: Readonly<Record<string, Matrix2>> = {
  id: IDENTITY,
  h: HADAMARD,
  x: PAULI_X,
  y: PAULI_Y,
  z: PAULI_Z,
  s: S_GATE,
  sdg: S_DAGGER,
  t: T_GATE,
  tdg: T_DAGGER,
};
