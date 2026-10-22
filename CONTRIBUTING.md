# Contributing

## Setup

```bash
pnpm install
pnpm build          # the studio imports the packages' dist output
pnpm test
```

Node >= 20.9 and pnpm. Everything else is in `pnpm-lock.yaml`.

## The one rule that matters

**A change to the simulator or the optimiser needs a test that would fail
without it.** "The existing tests still pass" is not evidence when the existing
tests share code with the change.

This is why the repository contains two deliberately independent
reimplementations — a dense-matrix oracle in
`packages/simulator/src/reference` and a minimal OpenQASM reader in
`tests/conformance/qasm-parser.ts` — plus a NumPy cross-check. If you change a
gate kernel, the dense oracle is what will catch an indexing mistake. If you
change code generation, the OpenQASM reader is what will catch a swapped
operand. Please do not "fix" a failing cross-check by changing the reference.

## Checks before opening a pull request

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build && pnpm test:e2e
```

CI runs all of these plus the examples and the benchmark smoke test.

## Where things live

| Change                             | Package              |
| ---------------------------------- | -------------------- |
| Grammar, diagnostics, formatter    | `packages/language`  |
| IR, optimisation passes, OpenQASM  | `packages/compiler`  |
| Gate kernels, measurement, tracing | `packages/simulator` |
| Commands and exit codes            | `packages/cli`       |
| Browser UI                         | `apps/studio`        |

The dependency chain is `language <- compiler <- simulator <- cli`, with the
studio on top. Please keep it acyclic: the frontend contains no numerical code
and the simulator contains no parsing.

## Adding a gate

A worked example of a change that touches everything:

1. `packages/language/src/semantic/gates.ts` — add the signature, including
   whether it is self-inverse and what its OpenQASM name is.
2. `packages/compiler/src/ir/ir.ts` — add the opcode. If operand order does not
   matter, add it to `FULLY_SYMMETRIC_OPCODES` so cancellation is correct.
3. `packages/simulator/src/gates/matrices.ts` — add the matrix, or a kernel in
   `statevector.ts` if it is a permutation.
4. `packages/simulator/src/reference/dense.ts` — add it to the oracle **from
   the definition**, not by copying the kernel. The point is that they are
   written separately.
5. `scripts/numpy-reference.mjs` — add it there too, and a circuit exercising it.
6. Tests: unitarity, a known state, and a case where operand order matters.
7. `docs/language-spec.md` and `docs/quantum-math.md`.

The spec-integrity test will fail if you add a diagnostic code without
documenting it.

## Adding an optimisation pass

1. Implement `Pass` in `packages/compiler/src/passes`. The `justification`
   field is not decorative — it is shown in the studio, so write the actual
   mathematical reason.
2. Use `scanAdjacentPairs` for legality rather than inventing a new check.
3. Add it to `DEFAULT_PASSES`.
4. Add unit tests for what it does _and_ what it refuses to do, including
   across a barrier, a measurement and a reset.
5. The property test in `tests/property/pass-equivalence.test.ts` will run it
   against random circuits automatically. **Passes must preserve the operator
   including global phase**, not just the measurement statistics — see
   `docs/design-decisions.md` entry 5 for why.

## Adding an example

Examples are executed by CI and checked against their own documentation.

1. Write `examples/your-example.qf` with a comment header covering the concept,
   expected behaviour, expected measurement results and the mathematics.
2. Add `@expect` directives (the vocabulary is in `examples/README.md`). They
   are verified against the real compiler and simulator.
3. Add a row to `examples/README.md` — the test checks every file is listed.
4. Run `qforge format examples/your-example.qf --write`; CI checks formatting.
5. Run `node scripts/generate-studio-examples.mjs` so the studio picks it up.
   CI fails if the generated file is stale.

## Style

- TypeScript strict mode, including `noUncheckedIndexedAccess`.
- Prettier and ESLint are configured; run `pnpm format` before committing.
- Comments explain _why_, not _what_. Several existing comments record a bug
  that was found and the rule that prevents it — those are the valuable ones.
- Diagnostics are data, never exceptions. Exceptions are for genuine internal
  errors, such as an unknown opcode reaching a backend.

## Reporting a bug

Please include the `.qf` source, the command, the output, and what you expected.
For a suspected simulator bug, `qforge run yours.qf --exact --json` gives the
exact distribution with no sampling noise, which is usually the fastest way to
tell a real bug from sampling variance.
