## What this changes

<!-- One or two sentences. -->

## Why

<!-- What problem does it solve? Link an issue if there is one. -->

## Evidence

<!--
For a simulator or optimiser change, a test that would fail without this
change. "The existing tests still pass" is not evidence when the existing
tests share code with the change.

The repository has two independent reimplementations for exactly this reason:
the dense-matrix oracle in packages/simulator/src/reference and the OpenQASM
reader in tests/conformance/qasm-parser.ts. If you changed a kernel or the code
generator, say what those say about it.
-->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` and `pnpm format:check` pass
- [ ] `pnpm test` passes
- [ ] `pnpm build && pnpm test:e2e` passes, if the studio changed
- [ ] New behaviour has a test that fails without the change
- [ ] Docs updated (`language-spec.md` for a grammar or diagnostic change,
      `quantum-math.md` for anything mathematical, `limitations.md` if a
      limitation moved)
- [ ] `examples/README.md` and `scripts/generate-studio-examples.mjs` run, if an
      example was added

## Anything reviewers should look at closely

<!-- Trade-offs, things you were unsure about, alternatives you rejected. -->
