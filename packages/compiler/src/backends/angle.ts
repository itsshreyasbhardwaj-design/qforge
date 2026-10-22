/**
 * Deterministic, loss-free angle formatting.
 *
 * Two requirements pull in opposite directions: generated code should be
 * readable (`pi/2`, not `1.5707963267948966`) and it must not change the
 * circuit (a rewritten angle has to parse back to the *same double*).
 *
 * The strategy is to try a small set of pretty forms and accept one only when
 * re-evaluating it reproduces the original bit pattern exactly. Otherwise fall
 * back to `String(x)`, which in JavaScript is the shortest decimal that
 * round-trips through IEEE-754 double. So the output is always exact, and
 * pretty whenever pretty happens to be exact.
 */

const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 32, 64] as const;
const MAX_NUMERATOR = 64;

/** True when `a` and `b` are the same double, treating -0 and 0 as distinct. */
function sameDouble(a: number, b: number): boolean {
  return Object.is(a, b);
}

function tryPiForm(value: number): string | undefined {
  if (value === 0) return undefined;
  for (const d of DENOMINATORS) {
    for (let n = 1; n <= MAX_NUMERATOR; n++) {
      for (const sign of [1, -1]) {
        // Reconstruct with the same operation order the expression would use,
        // so floating-point rounding matches what a parser would compute.
        const candidate = d === 1 ? sign * n * Math.PI : (sign * n * Math.PI) / d;
        if (!sameDouble(candidate, value)) continue;
        const magnitude =
          n === 1 ? (d === 1 ? 'pi' : `pi/${d}`) : d === 1 ? `${n}*pi` : `${n}*pi/${d}`;
        return sign < 0 ? `-${magnitude}` : magnitude;
      }
    }
  }
  return undefined;
}

/**
 * Format an angle for emitted source.
 *
 * @param value radians
 * @param pretty when false, always emit the exact decimal form
 */
export function formatAngle(value: number, pretty = true): string {
  if (!Number.isFinite(value)) {
    // Unreachable for validated programs: the analyser rejects non-finite
    // angles. Kept so a malformed module produces visibly wrong output rather
    // than silently emitting `NaN` as if it were a number.
    throw new RangeError(`Cannot format non-finite angle: ${value}`);
  }
  if (value === 0) return '0';
  if (pretty) {
    const piForm = tryPiForm(value);
    if (piForm) return piForm;
  }
  return String(value);
}

/**
 * Reduce an angle to `[-2*pi, 2*pi]`-ish display range without changing
 * semantics. Used only for display; never applied to a circuit, because
 * reducing an `rz` angle modulo 2*pi changes the state by a global phase.
 */
export function displayAngle(value: number, digits = 6): string {
  const pretty = tryPiForm(value);
  if (pretty) return pretty;
  return value.toFixed(digits).replace(/\.?0+$/, '');
}
