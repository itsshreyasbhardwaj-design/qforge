# Independent engineering audit

Audit of QForge at commit `85311bc`, conducted before any QForge 2.0 work began.

The method was deliberately adversarial: every reported metric was reproduced
from a **fresh clone of the public remote** rather than the local working copy,
and the codebase was then probed for defects rather than re-run for green ticks.
A test suite passing tells you what its author thought to check; it tells you
nothing about what they did not.

---

## 0. Corrections to the stated baseline

Two facts in the brief that commissioned this audit were already stale:

| Brief says                                | Actually                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `HEAD` is `f67ba67`                       | `f67ba67` is three commits back; `HEAD` is `85311bc`                                         |
| "No public deployment or GitHub push yet" | Pushed, public, and tagged `v0.1.0` at <https://github.com/itsshreyasbhardwaj-design/qforge> |

No deployment of the studio exists, which part of that claim got right.

---

## 1. Reproduced baseline

Procedure, from an empty directory:

```bash
git clone https://github.com/itsshreyasbhardwaj-design/qforge.git baseline
cd baseline
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check
pnpm coverage && pnpm examples && pnpm verify:numpy && pnpm test:e2e
```

| Claim                              | Reproduced | Observed                                                          |
| ---------------------------------- | ---------- | ----------------------------------------------------------------- |
| 606 Vitest tests pass              | yes        | 606 passed, 18 files, 1.05 s                                      |
| 94.8% statement coverage           | yes        | 94.8% statements, 86.71% branches, 97.46% functions, 96.38% lines |
| 34 Playwright tests pass           | yes        | 34 passed (desktop + Pixel 7), 49.6 s                             |
| NumPy cross-check agrees           | yes        | worst disagreement 5.551e-17, tolerance 1e-12                     |
| 12 examples compile and run        | yes        | all 12, all canonically formatted                                 |
| Clean install, build, lint, format | yes        | all pass from a frozen lockfile                                   |
| Reproducible CLI output            | yes        | `--seed 42` gives `{"11":519,"00":505}` on every run              |

**Every reported metric reproduced exactly.** The install took 3.9 s and the
whole verification under four minutes.

---

## 2. Probes that found no defect

These were attempts to break the system that failed, which is the useful kind of
negative result.

| Area                     | Probe                                                                                                                 | Result                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Numerical stability      | norm drift over 1k / 10k / 20k gate circuits                                                                          | 4.5e-14, 4.4e-13, 8.8e-13 — consistent with the documented sqrt(n) growth            |
| Optimiser termination    | 4 adversarial circuits designed to oscillate between passes                                                           | all terminate in ≤2 rounds, none hits the round cap, amplitudes preserved to 7.9e-14 |
| Source-location accuracy | every IR instruction's span sliced back out of the source                                                             | all map to their originating statement                                               |
| IR invariants            | arity, parameter count, operand distinctness, index range, finite params, across every example                        | no violations                                                                        |
| Semantic edge cases      | 20 hand-built cases (const scoping, shadowing, overflow, case sensitivity, keyword misuse, gate names as identifiers) | 19 of 20 as specified; the exception is finding A-3                                  |
| Resource limits          | 633 KB generated source                                                                                               | correctly rejected with `QF302`                                                      |
| Lexer totality           | NUL, control characters, lone surrogates, CRLF, 100 KB identifiers                                                    | all handled, no crash                                                                |
| Parser progress          | `,,,,`, `;;;;`, `->->->`, `[[[[`, `measure measure …` at 20k repetitions                                              | all terminate, diagnostics produced                                                  |

---

## 3. Findings

### A-1 — HIGH — Stack overflow on deeply nested expressions

**Observed.** A 10,000-level nested expression crashed the compiler with an
uncaught `RangeError: Maximum call stack size exceeded`.

```
deep parens 10k      20017B    16ms  THREW RangeError
deep unary 10k       10017B     6ms  THREW RangeError
long add chain 50k  100017B    43ms  THREW RangeError
unclosed parens 50k  50012B    10ms  THREW RangeError
nested brackets      40011B    11ms  THREW RangeError
```

The CLI exited 3 printing the bare line `Maximum call stack size exceeded`, with
no error code, no source location and no hint. The studio caught it but
displayed "The compiler threw an exception, which is a bug in QForge rather
than in your program" — which was wrong: it is ordinary malformed input.

**Why it mattered.** It directly contradicted two documented promises:
`docs/architecture.md`'s "diagnostics are data, never exceptions" and
`SECURITY.md`'s "malformed input is handled, not trusted".

**Root cause — two distinct sites, which is why a single guard would not have
been enough.**

1. _Parser recursion._ Nested parentheses and unary operators recurse through
   `parseExpression` → `parsePrefix`. Measured crash point: between 1,600 and
   10,000 levels at Node 24's default stack.
2. _Tree depth with shallow recursion._ A left-associative chain `1+1+1+...`
   parses with **constant** recursion but builds an arbitrarily deep left
   spine, which then overflowed `evaluateConstExpression`. Measured crash point:
   between 5,000 and 20,000. A parser-recursion guard alone would have missed
   this entirely.

**Fixed.** `MAX_EXPRESSION_DEPTH = 256`, new diagnostic `QF111`, enforced by two
guards: a recursion counter checked on the way _down_ (bounding stack usage) and
a tree-depth check as each node is built (bounding the left spine). The
constant evaluator carries a depth guard of its own, because the package is a
public API that can be handed a programmatically built tree, and `walk` was made
iterative since the studio calls it on every caret movement.

The limit is ~85x the deepest expression in the example library, which is 3.

### A-2 — MEDIUM — The dense oracle shared gate matrices with the code it checks

**Observed.** `packages/simulator/src/reference/dense.ts` imported
`singleQubitMatrix` from the production gate table.

**Why it mattered.** The oracle was genuinely independent in _indexing and gate
application_ — the part most likely to harbour a bug, and the part it was built
for. But it was **not** independent in the matrices themselves. A sign error in
Y would have been invisible to all 150 oracle comparisons, because both sides
would have read it from the same constant.

The README and `docs/quantum-math.md` described the oracle as sharing "no index
arithmetic", which was true, but the summary table's framing implied more
independence than existed. The NumPy script does define its matrices
independently, so the matrices were covered — by one reference, not two, and by
one that is not part of `pnpm test`.

**Fixed.** The oracle now writes out its own copy of all 13 single-qubit
matrices from their textbook definitions, and `reference.test.ts` compares the
two copies at every gate and every test angle to 1e-15. The duplication is now
checked rather than assumed. Documentation corrected to describe exactly what
each reference does and does not establish.

### A-3 — MEDIUM — Specification and implementation disagreed on size-1 registers

**Observed.** `qubit[1] q; h q;` was accepted. The specification says every
register must be indexed (`QF213`).

**Root cause.** The check keyed on the register's _size_ (`size > 1`) rather
than on how the name was _declared_.

**Why it mattered.** It made `qubit[1] q;` and `qubit[2] q;` behave differently
for no principled reason, and meant that whether `h q;` compiled depended on a
number the programmer might change. Both `q` and `q[0]` worked for size 1, which
is the kind of quiet inconsistency that becomes a compatibility problem later.

**Fixed.** The check now keys on `isRegister`. The message reports the size with
correct pluralisation.

### A-4 — LOW — One problem reported as two diagnostics

**Observed.** `rx(1e400) q;` produced both `QF004` (lexical: literal is not
finite) and `QF106` (syntax: expected an expression). `rx(1 $ 2) q;` produced
`QF001` and `QF104`.

**Root cause.** The lexer emits an `Invalid` token _and_ a diagnostic. The
parser then hit that token and reported its own error at the same position.

**Fixed.** `Parser.fail()` suppresses a syntax diagnostic when the token it
would point at is already lexically invalid. The statement is still abandoned,
so recovery is unchanged.

### A-5 — LOW — Vulnerable transitive dependency reaching the shipped bundle

**Observed.** `pnpm audit` reported two low-severity advisories in
`dompurify@3.4.15`, pulled in by `monaco-editor@0.57.0` (the current release).
dompurify was confirmed present in the studio's built chunks, so this was not a
dev-only dependency.

**Fixed.** An override to `dompurify >= 3.4.16` (3.4.17 resolved). `pnpm audit`
now reports no known vulnerabilities.

Worth recording: the override was first written as `pnpm.overrides` in
`package.json`, which **pnpm 11 no longer reads**. It printed a warning and
installed anyway, so the fix silently did nothing — `ls node_modules/.pnpm`
still showed only 3.4.15. Overrides now live in `pnpm-workspace.yaml`. Verifying
the resolved version rather than trusting the config is the lesson.

---

## 4. Severity summary

| ID  | Severity | Area                          | Status |
| --- | -------- | ----------------------------- | ------ |
| A-1 | High     | Parser / evaluator robustness | Fixed  |
| A-2 | Medium   | Verification independence     | Fixed  |
| A-3 | Medium   | Spec conformance              | Fixed  |
| A-4 | Low      | Diagnostic quality            | Fixed  |
| A-5 | Low      | Dependency security           | Fixed  |

No critical findings. All five are fixed, each with a regression test that fails
against the pre-audit code.

---

## 5. Weaknesses that remain (not defects)

Honest limits of what this audit establishes:

- **Coverage is not correctness.** 94.8% statements means most lines execute
  during testing. It says nothing about whether the assertions are meaningful.
  The cross-checks against independent references are the load-bearing evidence;
  the percentage is not.
- **Cross-validation is bounded.** 150 random circuits up to 6 qubits, 140
  OpenQASM round trips, 22 NumPy circuits. Nothing here establishes correctness
  for all circuits, for larger qubit counts, or for adversarial numerics.
- **No external SDK comparison existed at audit time.** Qiskit was not
  installed, so every reference was either in-repo or NumPy. Addressed in
  Phase G.
- **Browser coverage is Chromium only.** Firefox and WebKit are not in CI.
- **No accessibility audit.** Keyboard navigation, ARIA semantics and text
  alternatives are implemented and partly tested, but no screen-reader testing
  has been done and no WCAG level is claimed.
- **Numerical error has no proof, only measurements.** Drift was 8.8e-13 over a
  20,000-gate circuit. No bound is offered for adversarial circuits.
- **The studio runs the engine on the main thread.** This is why the browser
  limit is 14 qubits. Addressed in Phase E.

---

## 6. Reproducing this audit

```bash
git clone https://github.com/itsshreyasbhardwaj-design/qforge.git
cd qforge && pnpm install --frozen-lockfile && pnpm build

# Baseline
pnpm typecheck && pnpm lint && pnpm format:check
pnpm coverage && pnpm examples && pnpm verify:numpy
pnpm test:e2e

# The regression tests for each finding
pnpm vitest run packages/language/src/parser/depth.test.ts      # A-1, A-4
pnpm vitest run packages/simulator/src/reference                # A-2
pnpm vitest run packages/language/src/semantic                  # A-3
pnpm audit --audit-level=low                                    # A-5
```

To confirm a finding was real rather than theoretical, check out `85311bc` and
run the same regression test: each one fails there.
