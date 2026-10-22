/**
 * `@qforge/simulator` — an independent statevector simulator for QForge IR.
 *
 * Nothing here wraps an existing quantum SDK: complex arithmetic, gate
 * kernels, measurement, collapse and sampling are all implemented in this
 * package. Correctness is established three ways — analytically known states,
 * an independently written dense-matrix oracle in `reference/`, and a NumPy
 * cross-check in `scripts/numpy-reference.mjs`.
 *
 * Conventions (also in docs/quantum-math.md):
 *   - amplitude index `k` has qubit `j` equal to `(k >> j) & 1`
 *   - qubit 0 is therefore the least significant bit
 *   - ket labels print most significant qubit first, so qubit 0 is rightmost
 */
export * from './complex/index.js';
export * from './rng/index.js';
export * from './gates/index.js';
export * from './statevector/index.js';
export * from './measurement/index.js';
export * from './reference/index.js';
export * from './execute.js';
export * from './trace.js';
