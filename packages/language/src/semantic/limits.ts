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

/**
 * Maximum nesting depth of an expression's abstract syntax tree.
 *
 * This is a safety limit, not a style rule. The parser is recursive descent and
 * several consumers walk the tree recursively, so an arbitrarily deep
 * expression overflows the JavaScript call stack - which surfaces as an
 * uncaught `RangeError` rather than a diagnostic, breaking the promise that
 * malformed input always produces a reportable error.
 *
 * The measured crash point on Node 24 at its default stack size is somewhere
 * between 1,600 and 10,000 levels of parenthesis nesting, and between 5,000 and
 * 20,000 for a left-nested chain such as `1+1+1+...`. 256 leaves well over an
 * order of magnitude of headroom while being far beyond anything a person
 * writes: the deepest expression in the example library is 3.
 *
 * The limit is on *tree depth*, not parser recursion depth, because a
 * left-associative chain builds a deep tree from a shallow parse.
 */
export const MAX_EXPRESSION_DEPTH = 256;

/** Bytes of amplitude storage for an n-qubit statevector (re + im, f64 each). */
export function statevectorBytes(qubits: number): number {
  return 2 ** qubits * 16;
}
