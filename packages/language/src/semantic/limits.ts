/**
 * Compile-time resource limits.
 *
 * A statevector needs 2^n complex amplitudes, stored here as two Float64Arrays,
 * so memory is `2^n * 16` bytes: 16 MB at 20 qubits, 256 MB at 24. The browser
 * default is deliberately conservative; `docs/benchmarks.md` records the
 * measurements these numbers come from.
 */
export interface ResourceLimits {
  readonly maxQubits: number;
  readonly maxClassicalBits: number;
  readonly maxInstructions: number;
}

/** Default for the browser studio. */
export const BROWSER_LIMITS: ResourceLimits = {
  maxQubits: 14,
  maxClassicalBits: 64,
  maxInstructions: 20_000,
};

/** Default for the CLI, which has a full Node heap available. */
export const CLI_LIMITS: ResourceLimits = {
  maxQubits: 20,
  maxClassicalBits: 256,
  maxInstructions: 200_000,
};

export const DEFAULT_LIMITS = BROWSER_LIMITS;

/** Absolute ceiling, independent of configuration: 2^26 amplitudes is 1 GiB. */
export const HARD_MAX_QUBITS = 26;

export const MAX_SHOTS = 1_000_000;

/** Bytes of amplitude storage for an n-qubit statevector (re + im, f64 each). */
export function statevectorBytes(qubits: number): number {
  return 2 ** qubits * 16;
}
