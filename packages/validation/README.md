# @qforge/validation

Cross-validation of QForge against [Qiskit](https://www.ibm.com/quantum/qiskit).

```bash
pnpm build                                   # the package imports dist output
pnpm --filter @qforge/validation setup       # once: isolated .venv with Qiskit
pnpm --filter @qforge/validation validate
```

The run prints a Markdown report and writes `report.json`. It exits non-zero on
any **mathematical** disagreement; interoperability results are a compatibility
matrix, because an OpenQASM construct Qiskit's importer does not support says
nothing about whether QForge's physics is right.

The current results are in [docs/validation-report.md](../../docs/validation-report.md).

## Why this is a separate package

Qiskit is a development-time **oracle**, not a dependency. Nothing in the
compiler, simulator, CLI or studio imports it, `pnpm test` passes without it,
and `pnpm install` does not fetch it. Keeping it out of the workspace's runtime
dependencies is what lets QForge claim zero runtime dependencies honestly.

## What each check establishes

| Check                          | Method                                                                            | Tests                                   |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------- |
| Unitary evolution              | Rebuild via Qiskit's API, compare statevectors including global phase             | gate matrices, bit order, composition   |
| Optimisation                   | Compare the _optimised_ circuit against Qiskit's result for the _unoptimised_ one | that the passes preserve the operator   |
| Distributions                  | Exact probabilities on both sides, no sampling                                    | measurement semantics                   |
| Measurement-dependent circuits | QForge sampled at 200k shots against an exact branch enumeration                  | collapse, reset, classical feed-forward |
| Interoperability               | `qiskit.qasm3.loads` on QForge's generated text                                   | the interchange format                  |

## Adding a case

Add it to the right list in `src/cases.mjs`. Unitary cases need no measurement;
distribution cases need terminal measurement; stochastic cases are for anything
whose evolution depends on a sampled outcome.

If a new case fails, the first question is which side is wrong. Section 5.2 of
the validation report is an instance where the answer was "the reference".
