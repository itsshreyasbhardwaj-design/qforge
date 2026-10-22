# Release audit — 0.2.0

An audit of QForge at the 0.2.0 release point: what was checked, what the
checks printed, what was **not** checked, and what should be done next.

Dated 2026-10-22. Every result below was observed in this session on the
commit being audited. Where a figure is quoted it is the figure the command
printed, not a figure copied from an earlier document.

Machine: Apple M2, 8 GiB, macOS 15 (darwin 25.6.0 arm64), Node 24.16.0,
pnpm 11.

---

## 1. Verification procedure, and what it printed

Reproduce in this order from a clean checkout.

|   # | Command                                                                  | Observed                                                                                       |
| --: | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
|   1 | `pnpm install --frozen-lockfile`                                         | clean                                                                                          |
|   2 | `pnpm build`                                                             | all four packages built                                                                        |
|   3 | `pnpm typecheck`                                                         | no errors                                                                                      |
|   4 | `pnpm lint`                                                              | no errors, no warnings                                                                         |
|   5 | `pnpm format:check`                                                      | "All matched files use Prettier code style!"                                                   |
|   6 | `pnpm test`                                                              | **700 passed**, 22 files                                                                       |
|   7 | `pnpm coverage`                                                          | **92.8%** statements, 85.27% branches, 96.29% functions, 94.29% lines                          |
|   8 | `pnpm examples`                                                          | "All 13 examples compile, run and are canonically formatted."                                  |
|   9 | `pnpm test:e2e`                                                          | **68 passed** (desktop Chrome 1680x1000, and Pixel 7)                                          |
|  10 | `pnpm verify:numpy`                                                      | all circuits agree; worst disagreement **5.551e-17**, tolerance 1e-12                          |
|  11 | `pnpm --filter @qforge/validation validate`                              | "All mathematical comparisons agree with Qiskit"; **42 of 42** generated OpenQASM 3 files load |
|  12 | `CROSS_BROWSER=1 npx playwright test --project=firefox --project=webkit` | **68 passed** on each; the same suite, unmodified                                              |

Step 12 needs `npx playwright install firefox webkit` once. Step 11 needs its
environment once:
`pnpm --filter @qforge/validation setup`.

### 1.1 Qiskit figures, as printed

| Check                                            | Observed                             |
| ------------------------------------------------ | ------------------------------------ |
| Worst statevector amplitude disagreement         | 1.24e-16 (`mixed/deep-single-qubit`) |
| Exact measurement distributions, max \|dP\|      | 0 on all five cases                  |
| `stochastic/reset-after-h`, TVD at 200,000 shots | 0.00246                              |
| `stochastic/entangled-reset`                     | 0.00096                              |
| `stochastic/teleportation`                       | 0.00203                              |
| `stochastic/conditional-x`                       | 0.00035                              |

All four stochastic cases are within 0.01, which is the band five standard
deviations at 200,000 shots puts them in.

### 1.2 Two claims checked by inspection rather than by a script

**No third-party runtime dependencies.** `packages/*/package.json`
`dependencies` contain only `@qforge/*` workspace entries; `language` has none
at all.

**Nothing is uploaded.** The studio was loaded repeatedly in a browser with the
network panel recording, including full walkthrough runs: every request went to
the page's own origin. No CDN, no analytics, no telemetry.

---

## 2. Defects found and fixed during this phase

Listed because a phase that found nothing did not look.

| Defect                                                                                                                                                                                                             | How it surfaced                                  | Severity                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Selecting an example and acting immediately drove the outgoing module; the debounced recompile then reset execution, so an existing teleportation assertion was silently reading the **initial state** and passing | a new test perturbed the timing and made it fail | real, and it had been masking a test                                     |
| The walkthrough panel vanished on a narrow layout the moment a step opened the panel it was describing                                                                                                             | mobile Playwright project                        | real, mobile only                                                        |
| With the walkthrough pinned, the narrow Results panel was squeezed to 87px and its container did not scroll, so the Bloch table the lesson pointed at was unreachable                                              | browser inspection at 412x915                    | real, mobile only                                                        |
| A preformatted block widened the landing page by 29px at 390px wide                                                                                                                                                | measured `scrollWidth - clientWidth`             | cosmetic                                                                 |
| The gate set was documented as 16 gates; it is 17 (`id` was omitted)                                                                                                                                               | counting the table in `gates.ts`                 | documentation                                                            |
| A test read `window.monaco` without waiting for the loader to publish it                                                                                                                                           | mobile flake                                     | test-only                                                                |
| The console-error test navigated a second time on top of the suite's own navigation, aborting in-flight chunk requests; Firefox logs that as `NS_BINDING_ABORTED` and WebKit as `Load failed`                      | the first Firefox and WebKit run                 | test-only — a single clean load logs nothing on any of the four browsers |

The first is the one worth remembering: **a test that passes can still be
broken**. It asserted a property of the final state while reading the initial
state, and only a timing change exposed it.

---

## 3. What is not verified

Stated so that nobody has to infer it from silence.

- **No deployment.** Nothing is hosted; no hosting account is connected. The
  settings that would be used are recorded in [release.md](release.md) and have
  not been applied.
- **No user testing.** [user-testing-protocol.md](user-testing-protocol.md) is
  a protocol with empty result tables. No sessions have been run, so no claim
  about learning outcomes, usability or adoption is made anywhere.
- **Scale.** The Qiskit corpus stops at 5 qubits. A kernel bug that appears
  only above a word boundary would not be caught by it. The dense-matrix oracle
  covers more width but shares a repository and an author with the code.
- **Browsers in CI.** The suite passes on Chromium (desktop and Pixel 7),
  Firefox and WebKit, but only the two Chromium projects run in CI. A
  regression appearing on Firefox alone would not be caught automatically;
  it has to be checked with step 12 before a release.
- **Adversarial numerics.** No evaluation of near-degenerate amplitudes,
  accumulated error over very long circuits, or denormals.
- **OpenQASM 3 conformance in general.** Only that 42 of 42 generated files
  load into Qiskit's importer and reconstruct to the same circuit.
- **Performance comparisons.** No other simulator has been run under
  controlled conditions, so no comparative claim is made.
- **npm.** Nothing is published; package names are unverified.

---

## 4. Release readiness

**Ready to tag.** All eleven verification steps pass on the audited commit, the
documented figures match what the commands print, and every claim in the README
and on the landing page appears in
[claim-verification.md](claim-verification.md) with a command that checks it.

**Not ready to call "validated with users"**, because it has not been.

---

## 5. Top three next tasks

In the order they would matter, with the reason rather than the aspiration.

### 1. Widen the validated range above 5 qubits

The single largest gap between what is tested and what is claimed. The kernels
are indexed with bit masks over a `Float64Array`; the failure mode that
survives a 5-qubit corpus is one that only appears at larger widths. Extend
`packages/validation/src/cases.mjs` with 8-, 10- and 12-qubit circuits
(GHZ ladders, a random-but-seeded gate sequence, a `ccx` chain) and compare
statevectors against Qiskit at each width. The comparison is already written;
this is corpus work, and it either confirms the kernels or finds something
important.

### 2. Add `cy` and the controlled rotations, each validated the same way

The gate set is the most visible limitation, and `cy` in particular is a good
first extension because it is a permutation _with phases_ — neither the `cx`
permutation kernel nor the `cz` diagonal kernel applies, so it cannot be added
by copying. There is an independent oracle available without writing new
machinery: `CY = S_t · CX · S_t†`, so the new gate can be checked against a
decomposition built from gates that are already validated. The full task
breakdown, including the traps, is in
[technical-mastery.md](technical-mastery.md) §3.

### 3. Run the user-testing protocol with five people

Everything in this repository is verified against machines. Nothing is verified
against a person. [user-testing-protocol.md](user-testing-protocol.md) §5's
question — "what did you try that did not exist?" — is a direct measurement of
the gap between the language in a newcomer's head and the language that exists,
and it is the only item on this list that cannot be answered by writing more
code. Five sessions is enough to find the top three blockers.

### Deliberately not on this list

- **A language server.** It would be satisfying and it would change nothing
  about whether the system is correct or useful. The studio already reports
  diagnostics as you type.
- **More tests for their own sake.** Coverage is 92.8% and the marginal line is
  not where the risk is. Item 1 above adds more value than another hundred unit
  tests of covered code.
