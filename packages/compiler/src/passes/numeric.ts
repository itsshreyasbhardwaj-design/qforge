/** Relative tolerance for deciding that an angle is an exact multiple. */
export const ANGLE_EPSILON = 1e-12;

const TWO_PI = 2 * Math.PI;
const FOUR_PI = 4 * Math.PI;

/** Distance from `value` to the nearest integer multiple of `period`. */
export function distanceToMultiple(value: number, period: number): number {
  const k = Math.round(value / period);
  return Math.abs(value - k * period);
}

/** True when `value` is an integer multiple of `period` to within tolerance. */
export function isMultipleOf(value: number, period: number, epsilon = ANGLE_EPSILON): boolean {
  const scale = Math.max(1, Math.abs(value));
  return distanceToMultiple(value, period) <= epsilon * scale;
}

/**
 * True when a rotation by `theta` about any Pauli axis is exactly the identity.
 *
 * `R(theta) = cos(theta/2) I - i sin(theta/2) sigma`, so `R(theta) = I`
 * requires `cos(theta/2) = 1`, i.e. `theta` a multiple of `4*pi` — not `2*pi`.
 * At `theta = 2*pi` the rotation equals `-I`, which differs from the identity
 * by a global phase. Global phase is unobservable, so dropping such a gate
 * would preserve all measurement statistics; QForge still refuses to, because
 * its passes promise to preserve the operator exactly and the step debugger
 * displays raw amplitudes that would otherwise flip sign.
 */
export function isIdentityRotation(theta: number): boolean {
  return isMultipleOf(theta, FOUR_PI);
}

/**
 * True when `p(theta) = diag(1, exp(i*theta))` is exactly the identity, which
 * needs only a multiple of `2*pi` because `p` has no global-phase ambiguity.
 */
export function isIdentityPhase(theta: number): boolean {
  return isMultipleOf(theta, TWO_PI);
}
