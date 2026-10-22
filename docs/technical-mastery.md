# Technical mastery and contribution record

This document exists so that nobody — a reviewer, an admissions officer, a
future collaborator, or the author six months from now — has to guess who did
what, or how much of this repository its owner actually understands.

It is deliberately unflattering where the truth is unflattering. A portfolio
that overstates authorship is worth less than one that states it plainly,
because the overstatement is discoverable in a ten-minute conversation and the
plain statement is not.

---

## 1. Contribution disclosure

**The implementation in this repository was written by an AI coding assistant
(Claude) working from written specifications by the project owner, Shreyas
Bhardwaj.** That covers essentially all of the TypeScript, the tests, the
Python validation scripts and the prose in `docs/`.

This is stated once here, plainly, and repeated in [README.md](../README.md) so
that no reader can reach the code without encountering it.

What that leaves is a real but different set of contributions, and they are
worth being precise about:

### Owner-led — decisions that shaped the system

These are choices made in the specifications, not after the fact. They are
recoverable from the briefs, and each one is visible in the code as a
consequence.

| Decision                                                                       | Where it shows up                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Build an original language and simulator rather than wrap Qiskit or Cirq       | No quantum SDK appears in any `package.json` in `packages/`; the four core packages have **zero** runtime dependencies     |
| Never fabricate a benchmark, a test result, a user or a compatibility claim    | Every number in `docs/benchmarks.md` has a command that reproduces it; `docs/limitations.md` exists and is long            |
| Validate against something that does not share this code's assumptions         | Four independent references, described in [validation-report.md](validation-report.md)                                     |
| Add real classical control, and treat teleportation as the test of it          | [classical-control-design.md](classical-control-design.md); predication rather than nesting in the IR                      |
| Prove teleportation on Bob's reduced density matrix, not on measurement counts | `tests/integration/teleportation.test.ts` — counts are identical with and without the corrections, so counts prove nothing |
| Optimisation must preserve the operator **including global phase**             | `rx(2*pi)` is not removed; only multiples of `4*pi` are. This is the single detail a reviewer is most likely to probe      |
| Ship it publicly, with its limitations in the README rather than in a footnote | The repository is public; `docs/limitations.md` is linked from the top of the README                                       |

### Independently validated — results that do not rest on anyone's word

These are the claims that survive if you distrust both the author and the
assistant, because an outside system checked them. See
[validation-report.md](validation-report.md) for how to re-run each one.

- Agreement with **Qiskit 2.2.3** on statevectors and measurement
  distributions across the validation corpus.
- Agreement with an independent **NumPy** implementation written outside the
  language entirely (`scripts/numpy-reference.mjs`).
- Agreement with an in-repo **dense-matrix oracle** that defines its own gate
  matrices and enumerates basis states, where the production kernels use bit
  masks.
- Agreement with an in-repo **OpenQASM 3 reader** written in a deliberately
  different style (regex plus shunting-yard) from the hand-written lexer and
  Pratt parser it is checking.

Two of those found real bugs, and the direction matters in both cases:

- Qiskit rejected QForge's `if (c == 1)` on a single `bit`. QForge was wrong
  about the OpenQASM 3 spec; the backend now emits `c == true`. **A conformance
  bug in this project, found by an outside tool.**
- The NumPy reference disagreed with QForge on an entangled circuit with a
  mid-circuit reset. The bug was in the NumPy script's axis handling, not in
  QForge. **A bug in the oracle, found by the disagreement.** It is recorded
  because an oracle that is only ever right is an oracle nobody checked.

### Not claimed

To be explicit about the things this document does **not** assert, because
portfolios routinely assert them without evidence:

- No claim that the owner personally wrote, line by line, the compiler, the
  simulator kernels, the studio, or the test suite.
- No claim of external users, adoption, downloads, stars, citations or
  institutional recognition.
- No claim of a retrospective development narrative beyond what is recorded in
  [development-journal.md](development-journal.md), which contains only events
  that actually occurred during the build.
- No claim of peer review. [technical-report.md](technical-report.md) is
  written in a research style because that style is clearer for this material,
  not because it has been reviewed by anyone.

### Owner's own record

This section is intentionally empty of claims made on the owner's behalf. It is
where work the owner does personally should be recorded, with the commit or
file that demonstrates it:

<!-- Add entries here as you complete them. Each entry: what you did, the
     commit hash, and what you had to understand to do it. -->

| Date                  | What was done personally | Evidence |
| --------------------- | ------------------------ | -------- |
| _(none recorded yet)_ |                          |          |

Section 3 below is a task designed to produce the first entry.

---

## 2. What owning this code means

Authorship and ownership are different things. Owning this repository means
being able to do the following without assistance, which is a testable
property:

1. **Explain any layer on a whiteboard.** Lexer, parser, analyser, IR, passes,
   backends, simulator kernels, the studio's worker protocol.
2. **Defend the conventions.** Why qubit 0 is the least significant bit. Why
   rotations use the half-angle definition. Why optimisation preserves global
   phase. Why `reset` is measure-and-conditional-flip rather than projection.
3. **Find and fix a bug** in a layer you did not expect to be in.
4. **Extend the system** end to end, through every layer it touches.
5. **Say what it cannot do**, accurately, without reaching for the docs.

[author-learning-guide.md](author-learning-guide.md) is the self-check for
points 1, 2 and 5. It asks the questions a reviewer would ask and deliberately
does **not** supply the answers, because an answer you can recite is not an
answer you can defend. Work through
[learning-guide.md](learning-guide.md) first if the material is unfamiliar.

Point 3 is covered by the exercises in `docs/author-learning-guide.md`.
Point 4 is the task below.

---

## 3. A first engineering task: add the `cy` gate

This is scoped to be genuinely completable in a few focused hours, while
touching every layer of the system. It is not a toy: `cy` is a real gate, it is
currently missing, and adding it exercises the parser, the type rules, the IR,
both backends, a simulator kernel, the optimiser and the test suite.

### What `cy` is

Controlled-Y: apply Pauli-Y to the target when the control qubit is 1.

```
CY = |0><0| ⊗ I + |1><1| ⊗ Y
```

It is **not** diagonal (so the `cz` kernel does not apply) and **not** a pure
permutation (so the `cx` kernel does not apply either) — it is a permutation
with phases, which is exactly why it is a useful exercise rather than a
copy-paste.

### Your oracle, decided before you write the kernel

```
Y = S X S†        (check this by hand: S = diag(1, i))
CY = S_t · CX · S_t†
```

where `S_t` acts on the **target** qubit only. This identity gives you a test
that does not share assumptions with your new kernel: compile `cy a, b` and
`sdg b; cx a, b; s b` separately and require that the two statevectors agree to
1e-12 on random inputs.

Convince yourself of the identity on paper before trusting it. Note the order
carefully — getting it backwards gives you `CY†`, which differs by a sign on
one amplitude and will pass a probabilities-only test.

### The layers you will touch

1. **`packages/language/src/semantic/gates.ts`** — declare the signature: two
   qubit operands, no parameters. Look at how `cz` is declared.
2. **`packages/compiler/src/ir/`** — add the opcode. Check whether
   `touchedQubits` needs anything; it should not, if you follow `cz`.
3. **`packages/simulator/src/kernels/`** — write the kernel. Decide for
   yourself whether it belongs with the permutation kernels or needs its own.
   Read `docs/simulator-design.md` on the pair-stepping scheme first.
4. **`packages/simulator/src/reference/dense.ts`** — add the matrix. **Write
   this one from the mathematical definition, not from your kernel.** If you
   derive it from the kernel you have built an oracle that shares your bugs,
   which the project's own rules forbid.
5. **`packages/compiler/src/backends/openqasm3.ts`** — emit it. `cy` is in the
   OpenQASM 3 standard gate library, so the mapping is direct.
6. **`packages/compiler/src/passes/`** — `cy` is self-inverse, so the
   cancellation pass should remove adjacent pairs. Check that the adjacency
   analysis treats it correctly when a classical condition is in between.
7. **Tests** — unit tests for the kernel, a conformance test against the dense
   oracle, a property test against the `s`/`cx`/`sdg` decomposition above, and
   a case added to `packages/validation/src/cases.mjs` so Qiskit checks it too.
8. **Docs** — the gate table in `docs/language-spec.md`, and
   `docs/quantum-math.md` if you want to record the derivation.

### Done means

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e
```

all pass, the Qiskit validation run includes your new case and agrees, and you
can explain on a whiteboard why your kernel is correct without opening the
file.

### Deliberate traps

These are real, and each one has bitten this codebase already:

- **Global phase.** `cy cy = I` exactly, with no phase. If your cancellation
  pass removes a pair that is not exactly identity, you have broken the
  contract described in `docs/design-decisions.md`.
- **Bit order.** Qubit 0 is the least significant bit of the amplitude index,
  but kets print most significant first. A kernel that is correct under the
  other convention will pass single-qubit tests and fail on `cy 0, 1` vs
  `cy 1, 0`.
- **Probabilities hide phase errors.** `CY` and `CY†` give identical
  measurement statistics in the computational basis. Test the statevector, not
  the counts.

---

## 4. How to verify everything in this document

Nothing here should be taken on trust. The claims above are checkable:

```bash
# No quantum SDK is wrapped: the four core packages have no runtime deps.
cat packages/*/package.json | grep -A3 '"dependencies"'

# Every test claim.
pnpm test && pnpm test:e2e

# Every benchmark number in docs/benchmarks.md.
pnpm bench

# The independent cross-checks.
pnpm verify:numpy
node packages/validation/run.mjs       # requires the local venv; see the report
```

If any of those disagree with what is written here or in the README, the
document is wrong and should be corrected rather than explained away.
