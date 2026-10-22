# Changelog

All notable changes to QForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-22

Classical control, independent validation against Qiskit, and a public landing
page. The implementation was written with AI assistance; see
[docs/technical-mastery.md](docs/technical-mastery.md).

### Added

- **Classical control flow.** `if (c == 1) { ... }` and `if (reg == 3) { ... }`,
  lowered by predicating each instruction rather than nesting a block, so every
  existing pass keeps working on a flat instruction list.
- **Quantum teleportation**, expressible for the first time, and verified on
  Bob's reduced density matrix rather than on measurement counts — which are
  identical with or without the corrections and therefore prove nothing.
- **Independent validation against Qiskit 2.2.3** (`packages/validation`):
  42 circuits, statevectors compared including global phase, optimised forms
  checked against Qiskit's unoptimised result, and every generated OpenQASM 3
  file loaded back through `qiskit.qasm3`.
- **Quantum state explorer**: a gate inspector that explains the instruction at
  the cursor from computed facts only, with no stored prose.
- **Optimisation explorer**: what each pass removed, and why.
- **Web Worker execution** with run IDs, staleness rejection, chunked yielding,
  cancellation, and a timeout with recovery.
- **Four guided walkthroughs** — superposition, interference, entanglement and
  teleportation — that drive the editor, the debugger and the panels as you
  read, so every figure quoted is computed live.
- **A landing page** at `/`, with the studio at `/studio`.
- New documents: technical report, claim-verification sheet, contribution
  disclosure, portfolio index, user-testing protocol (not yet run),
  independent audit, classical-control design, validation report.

### Fixed

- `if (c == 1)` on a single classical bit emitted invalid OpenQASM 3. A single
  `bit` is not an integer, so the backend now emits `c == true`. **Found by
  Qiskit's importer rejecting QForge's output.**
- Adjacency analysis ignored classical bits, so the optimiser could cancel a
  pair across the measurement that wrote the bit one of them was predicated on.
  Qubits and classical bits are now a single resource index space.
- A deeply nested expression could overflow the stack before the depth check
  ran. The check now counts on the way down, not on the way up.
- `merge-rotations` folded against stale instructions, turning
  `rx(1) rx(2) rx(3)` into `rx(3)` rather than `rx(6)`.
- The analyser treated a single-element register as a scalar in one branch.
- Selecting an example and acting immediately drove the outgoing module,
  because compilation is debounced and the recompile then reset execution.
- Preformatted blocks could widen the page on a phone instead of scrolling.

### Changed

- The studio moved from `/` to `/studio`; `/` is now the landing page.
- On a narrow layout the walkthrough panel is pinned below the tab strip, so it
  stays on screen when a step opens the panel it is describing.

## [0.1.0] — 2026-10-22

First public release.

### Language

- Qubit and classical-bit declarations, scalar and register (`qubit[3] q;`).
- Compile-time constants (`const theta = pi / 4;`) with `pi`, `tau` and `euler`.
- Seventeen gates: `id h x y z s sdg t tdg p rx ry rz cx cz swap ccx`.
- `measure q -> c;`, `reset q;`, `barrier;` and `barrier a, b;`.
- Angle expressions with documented precedence; `^` is right-associative and
  binds tighter than unary minus.
- Line and block comments.
- Strictly declare-before-use, single flat scope, no shadowing.

### Compiler

- Hand-written total lexer; concatenating its tokens reproduces the source.
- Recursive-descent parser with a Pratt expression sub-parser and
  guaranteed-progress error recovery that reports several errors per pass.
- Single-pass semantic analyser: symbol table, name resolution to global
  indices, constant folding, and 30 documented diagnostic codes with caret
  excerpts, hints and "did you mean" suggestions.
- Flat, syntax-independent, source-mapped IR.
- Four optimisation passes — `remove-identity`, `cancel-self-inverse`,
  `cancel-inverse-pair`, `merge-rotations` — run to a fixpoint, each carrying
  its own mathematical justification, and each preserving the circuit's operator
  including global phase.
- Deterministic OpenQASM 3 generation for the supported subset, with exact
  round-tripping angle serialisation and keyword-collision renaming.
- Comment-preserving canonical formatter.

### Simulator

- Independent statevector implementation: complex arithmetic, gate kernels,
  measurement, collapse and sampling, with no quantum SDK underneath.
- Dedicated permutation kernels for `cx`, `ccx` and `swap`, and a diagonal
  kernel for `cz`.
- Correct measurement semantics with exact probabilities, sampled outcomes and
  post-measurement states kept distinct.
- `reset` implemented as measurement plus conditional flip, so entangled
  partners stay correlated.
- Automatic selection between exact terminal sampling and per-shot replay, with
  the chosen strategy reported.
- Seeded xoshiro128\*\* randomness, reproducible across machines.
- Execution traces recording every intermediate state, enabling exact backward
  stepping.
- Reduced density matrices and Bloch vectors that report mixedness honestly.

### CLI

- `check`, `run`, `compile`, `inspect` and `format`, with JSON output and
  stable exit codes (0 success, 1 compile error, 2 usage error, 3 runtime).

### Studio

- Static browser IDE: Monaco editor with a QForge grammar and inline
  diagnostics, SVG circuit diagram, step debugger, state and probability
  inspectors, Bloch panel, counts table and a compiler inspector showing
  tokens, AST, IR, the pass report and generated OpenQASM.
- Runs entirely client-side: no server component, no API route, no telemetry,
  no runtime CDN dependency.
- Responsive down to phone width, with ARIA tab semantics and keyboard support.

### Examples

- Twelve documented programs, each executed by CI and verified against machine-
  checked `@expect` directives.

### Verification

- Unit tests for every compiler and simulator stage.
- Property tests comparing full statevectors before and after optimisation.
- Conformance tests against an independently written dense-matrix oracle
  (150 random circuits) and an independently written OpenQASM reader
  (140 round trips).
- NumPy cross-check of gate matrices and bit order (22 circuits).
- CLI integration tests including the built binary as a subprocess.
- 34 Playwright browser tests on desktop and mobile.
- Reproducible benchmark harness; every number in the docs is measured.

### Known limitations

No classical control flow, so quantum teleportation cannot be expressed. No
user-defined gates, loops or subroutines. Statevector only — no noise, density
matrices or stabiliser backend. The OpenQASM backend covers only the subset
QForge can express. Limits are 14 qubits in the browser, 20 in the CLI, 26 hard.
Not published to npm.

[0.1.0]: https://github.com/itsshreyasbhardwaj-design/qforge/releases/tag/v0.1.0
