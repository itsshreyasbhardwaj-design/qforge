# Claim verification sheet

Every substantive claim QForge makes, and how to check it yourself.

The point of this sheet is that no claim in this repository should require
trusting the author. If a row's check disagrees with its claim, the claim is
wrong and should be fixed — not explained.

All commands run from the repository root after `pnpm install && pnpm build`.

---

## 1. What the project is

| Claim                                                           | How to check                                             | Expected                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| No quantum SDK is wrapped                                       | `cat packages/*/package.json` and look at `dependencies` | Only `@qforge/*` workspace packages. No qiskit, cirq, quantum-circuit, or similar       |
| The four core packages have no third-party runtime dependencies | same                                                     | `language` has none at all; `compiler`, `simulator` and `cli` depend only on each other |
| The compiler is hand-written                                    | `packages/language/src/lexer/`, `parser/`                | No parser generator, no grammar file, no `nearley`/`peggy`/`antlr` anywhere             |
| Qiskit is a development oracle, not a dependency                | `pnpm test` with no Python environment present           | All 700 tests pass                                                                      |
| Package dependency graph is acyclic                             | `packages/*/package.json`                                | `language` ← `compiler` ← `simulator` ← `cli`                                           |

## 2. Correctness

| Claim                                                  | How to check                                                                                                           | Expected                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 700 unit tests pass                                    | `pnpm test`                                                                                                            | `Test Files 22 passed (22)`, `Tests 700 passed (700)`             |
| 68 browser tests pass                                  | `pnpm test:e2e`                                                                                                        | `68 passed`, across a desktop viewport and a Pixel 7              |
| Coverage                                               | `pnpm coverage`                                                                                                        | 92.8% statements, 85.27% branches, 96.29% functions, 94.29% lines |
| The same suite passes on Firefox and WebKit            | `npx playwright install firefox webkit`, then `CROSS_BROWSER=1 npx playwright test --project=firefox --project=webkit` | `68 passed` on each                                               |
| Every example runs and matches its stated expectations | `pnpm examples`                                                                                                        | `All 13 examples compile, run and are canonically formatted.`     |
| Agreement with Qiskit on statevectors                  | `pnpm --filter @qforge/validation validate`                                                                            | 33 circuits, worst amplitude difference 1.241e-16, 0 failures     |
| Optimisation preserves the operator                    | same run, §4.2 of the report                                                                                           | 33 circuits, worst 1.732e-16, 0 failures                          |
| Teleportation agrees with Qiskit                       | same run, §4.4                                                                                                         | TVD 0.00203 at 200,000 shots                                      |
| Generated OpenQASM 3 loads into Qiskit                 | same run, §4.5                                                                                                         | 42 of 42 files load and reconstruct                               |
| Agreement with an out-of-language NumPy reference      | `pnpm verify:numpy`                                                                                                    | No disagreements                                                  |

The Qiskit rows need the validation environment once:
`pnpm --filter @qforge/validation setup`. It creates an isolated `.venv` with
`uv` and installs pinned versions; nothing is sent anywhere and nothing is
paid for.

## 3. Specific technical claims

| Claim                                                                   | How to check                                                                     | Expected                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Qubit 0 is the least significant bit, kets print most significant first | `qforge run examples/bell.qf` and the bit-order cases in the validation corpus   | `x` on qubit 0 of 3 gives `001`                                                                                                            |
| Optimisation preserves global phase, so `rx(2*pi)` is kept              | `packages/compiler/src/passes/passes.test.ts`, and §4.2 of the validation report | `rx(4*pi)` removed, `rx(2*pi)` kept, Qiskit agrees with both                                                                               |
| `reset` is measure-and-conditional-flip, not projection                 | validation §4.4, "Entangled `reset`"                                             | TVD 0.00096 against an exact enumerated reference                                                                                          |
| Teleportation is verified on Bob's state, not on counts                 | `tests/integration/teleportation.test.ts`                                        | The test traces out two qubits and compares a density matrix. Delete the two `if` statements from the example and the counts do not change |
| Classical control is safe under optimisation                            | `tests/property/conditional-safety.test.ts`                                      | Generated circuits mixing measurement, predication and cancellable pairs agree before and after optimisation                               |
| A deeply nested expression fails cleanly rather than crashing           | `packages/language/src/parser/depth.test.ts`                                     | A diagnostic at depth 256, no stack overflow                                                                                               |
| The parser always makes progress on malformed input                     | the recovery tests in `packages/language/src/parser/`                            | A file with no semicolons produces multiple diagnostics, not one                                                                           |

## 4. Performance

| Claim                                     | How to check | Expected                                                             |
| ----------------------------------------- | ------------ | -------------------------------------------------------------------- |
| All benchmark figures                     | `pnpm bench` | The tables in [benchmarks.md](benchmarks.md), on comparable hardware |
| Compile 10,000 gates end to end           | same         | ~27.5 ms on an Apple M2                                              |
| 1,000,000 shots at 12 qubits              | same         | ~313 ms, terminal sampling                                           |
| Permutation kernels beat the general path | same         | `cx` faster than `h` at equal width                                  |

Benchmarks are machine-dependent. The numbers in `benchmarks.md` are from one
Apple M2; yours will differ, and the claim being checked is the _shape_ — that
the figures are real and reproducible — not that you will see the same
milliseconds.

## 5. The studio

| Claim                                        | How to check                                               | Expected                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Everything runs locally; nothing is uploaded | Open the studio with the browser's network panel recording | Every request is to the page's own origin. No CDN, no analytics, no telemetry                                                           |
| Monaco is bundled, not loaded from a CDN     | `apps/studio/components/Editor.tsx`, and the network panel | `loader.config({ monaco })`; no `cdn.jsdelivr.net` request                                                                              |
| The UI stays responsive during a long run    | `tests/e2e/studio.spec.ts`, the worker tests               | A 1,000,000-shot run can be cancelled, and a superseded run does not overwrite a newer one                                              |
| Walkthroughs drive the real tool             | `tests/e2e/studio.spec.ts`, the walkthrough tests          | Starting the Entanglement walkthrough loads the program, and the panel it points at shows `maximally mixed (entangled)` for both qubits |
| Browser limits are enforced                  | `packages/language/src/semantic/limits.ts`                 | 14 qubits in the browser, 20 in the CLI, 26 hard ceiling                                                                                |

## 6. Claims this project does _not_ make

Listed because their absence is deliberate, and because a reader scanning for
them should find this section rather than assume an omission.

- **No users, adoption, downloads or stars.** None are claimed anywhere.
- **No performance comparison against other simulators.** No such comparison
  has been run under controlled conditions, so none is stated.
- **No correctness guarantee above 5 qubits.** That is where the Qiskit corpus
  stops.
- **No OpenQASM 3 conformance claim.** Only that 42 of 42 generated files load
  into Qiskit's importer and reconstruct to the same circuit.
- **No claim of unassisted authorship.** See
  [technical-mastery.md](technical-mastery.md).
- **No user-testing results.** The protocol exists in
  [user-testing-protocol.md](user-testing-protocol.md) and has not been run.
- **No peer review.** [technical-report.md](technical-report.md) is written in
  a research style; it has not been reviewed by anyone.

## 7. Known bugs found during validation, and by what

Reported because a project that found no bugs during validation did not
validate anything.

| Bug                                                            | Found by                             | Where it was                 | Fixed                            |
| -------------------------------------------------------------- | ------------------------------------ | ---------------------------- | -------------------------------- |
| `if (c == 1)` emitted for a single `bit` is invalid OpenQASM 3 | Qiskit's importer                    | QForge's backend             | yes — emits `c == true`          |
| `cx(0,1)` executed as `cx(1,0)`                                | disagreement with QForge (TVD 0.499) | the NumPy oracle, not QForge | yes                              |
| `rx(1) rx(2) rx(3)` folded to `rx(3)`                          | unit test                            | QForge's `merge-rotations`   | yes                              |
| Parser consumed a whole file on malformed input                | manual testing                       | QForge's recovery            | yes                              |
| Stack overflow on deeply nested expressions                    | hostile-input test                   | QForge's parser              | yes                              |
| `                                                              | ->` described as a Z eigenstate      | the `@expect` suite          | this project's own example prose | yes |
