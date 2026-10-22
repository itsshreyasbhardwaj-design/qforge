# Simulator design

The simulator is an independent statevector implementation: complex arithmetic,
gate kernels, measurement, collapse and sampling are all written in
`packages/simulator`. Nothing here wraps an existing quantum SDK.

For the mathematics and conventions, see [quantum-math.md](quantum-math.md).
This document covers the engineering.

## Storage

```ts
class Statevector {
  readonly qubitCount: number;
  readonly size: number; // 2^qubitCount
  readonly re: Float64Array;
  readonly im: Float64Array;
}
```

Two parallel `Float64Array`s rather than an array of `{re, im}` objects. A gate
kernel then reads and writes contiguous doubles with no allocation and no
pointer chasing. The `Complex` type exists for gate matrices, density-matrix
entries and display — places with a handful of values where clarity beats
throughput.

Memory is `2^n * 16` bytes, which is the whole reason for the qubit limits.

## Kernels

### Single-qubit

The pair-stepping loop in section 4.1 of [quantum-math.md](quantum-math.md).
Blocks of `2 * 2^t` so the inner loop does no index arithmetic. The 2x2 matrix
is destructured once outside both loops.

### Permutations

`cx`, `ccx` and `swap` are permutations of basis states, so they are amplitude
swaps with no arithmetic. `cz` is diagonal, so it is a sign flip. Each visits
every pair exactly once by acting only from the side where the target bit is
clear.

These dedicated kernels are why `cx` is measurably faster than `h` at the same
qubit count ([benchmarks.md](benchmarks.md)): a swap moves two doubles, a
Hadamard does four multiplies and four adds.

A general `applyControlledMatrix` also exists, and a test asserts it agrees with
the dedicated `cx` kernel — the slow general path keeps the fast special path
honest.

## Execution strategies

`executeCircuit` picks between terminal sampling and per-shot replay, and the
result reports which it used. The rule, the justification and the test that
guards it are in section 6 of [quantum-math.md](quantum-math.md).

The CLI prints the chosen strategy, because a user whose circuit suddenly got a
thousand times slower deserves to be told it was the mid-circuit measurement
rather than left guessing.

## Tracing

`traceCircuit` executes once and records, per instruction:

- the state after it (subject to a memory budget),
- the probability distribution after it (always),
- for `measure` and `reset`, the exact `p0`/`p1` and the sampled outcome,
- the classical register contents,
- which amplitude indices changed materially.

### Why record everything up front

The alternative — re-running the prefix on each step — is cheaper in memory and
wrong. A circuit containing a measurement has a random branch, so re-running
could land on a different branch and show the user a state that never occurred
in the run they are looking at. Recording makes backward stepping both free and
_exact_.

### The memory budget

A snapshot costs `2^n * 16` bytes, so a 12-qubit circuit with 200 instructions
wants about 13 MB. The budget defaults to 64 MB (48 MB in the browser). Past it,
amplitudes stop being retained but probabilities continue, and the trace reports
`amplitudesTruncatedFrom` so the UI can say so rather than silently showing a
different step.

### Changed amplitudes

Comparing each step's state with the previous one gives the set of basis states
an operation actually altered. The studio highlights them, which is what turns
"here are two tables of numbers" into "here is what this gate did".

## Randomness

xoshiro128\*\*, seeded through splitmix32, in `rng/prng.ts`.

`Math.random()` was never an option: measurement sampling has to be
reproducible, or a measurement bug is undebuggable and a documented example
cannot be checked in CI. splitmix32 expands a single 32-bit seed into four
well-mixed words, so seeds 0, 1 and 2 give unrelated streams — asserted by a
test. xoshiro128\*\* was chosen over a simpler LCG for the quality of its low
bits, which is exactly where a weak generator would bias per-shot outcomes.

`nextFloat()` uses 53 bits so the double is uniform over the full mantissa.

Batch sampling builds the cumulative distribution once and binary-searches it
per shot, so a million shots from a 14-qubit state costs `O(2^n + shots * n)`
rather than `O(shots * 2^n)`.

## The reference oracle

`packages/simulator/src/reference/dense.ts` is an intentionally slow, separately
written simulator used only by tests.

The production kernels are in-place, allocation-free and index-clever, and that
cleverness is exactly where indexing bugs live. A bug there would be invisible
to any test that used the same kernels to compute the expected answer.

So the oracle computes the same thing a completely different way: it builds the
full `2^n x 2^n` matrix for each instruction directly from `<j| Op |i>` and does
a dense matrix-vector product. It enumerates basis states where the fast path
manipulates bit masks — no shared index arithmetic — so agreement between them
is real evidence.

It is `O(4^n)` in time and memory, fine up to about 7 qubits, and never on the
execution path. It refuses non-unitary instructions rather than guessing at
measurement.

`scripts/numpy-reference.mjs` adds a third check outside the language entirely,
because both of the above were written by the same author and could share a
misunderstanding.

## Resource guards

Enforced in the simulator as well as the frontend, because the simulator is a
public API that can be called without going through the compiler:

- `Statevector.zeroState` rejects more than 26 qubits with the byte count in the
  message.
- `executeCircuit` rejects a shot count outside `1 .. 1,000,000`.
- Every kernel validates its qubit indices and rejects a gate whose control
  equals its target.
- `collapse` refuses a zero-probability outcome rather than producing a zero
  vector.

## What is not implemented

- No density-matrix or noise simulation: states are pure, gates are ideal.
- No tensor-network or stabiliser backend, so cost is exponential in qubits
  with no special-casing of Clifford circuits.
- No GPU or SIMD, and no Web Worker: the kernels are plain scalar JavaScript.
- No classical control flow, so no feed-forward on a measured bit.

Each is a real limitation, not an oversight; [limitations.md](limitations.md)
says what it would take to lift them.
