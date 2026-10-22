# Development journal

Engineering decisions and problems as they actually came up, in order. Only
things that really happened are recorded here.

---

## Phase 1 — Environment and architecture

Checked what was available before committing to a stack: Node 24, pnpm 11,
npm registry reachable, NumPy 2.0.2 installed, **no Qiskit, no `openqasm3`
Python package**.

That last point shaped the verification plan. The brief asks for validation
against an independent reference, and the obvious ones were not available
offline. Rather than add a paid or networked dependency, the plan became three
independent checks: an in-repo dense-matrix oracle, an in-repo OpenQASM reader
written in a deliberately different style, and NumPy as an out-of-language
cross-check.

Pinned exact versions after checking what actually publishes: `@eslint/js` and
`typescript-eslint` were first pinned to versions that do not exist (guessed
from the major), and install failed twice before being corrected to 10.0.1 and
8.72.0. TypeScript was pinned to 5.9.3 rather than the current `latest` of 7.0.2,
because 7.x is the new native port and the risk of toolchain friction with
Next 16 and Vitest 5 was not worth taking for this project.

Fixed the conventions before writing any code, because they are the things that
are expensive to change later: qubit 0 is the least significant bit, ket labels
print most significant first, rotations use the half-angle definition, passes
preserve the operator including global phase.

---

## Phase 2 — Language frontend

**Lexer.** Straightforward. The decision worth recording is that it is _total_:
every character ends up in exactly one token, invalid ones included. The test
that concatenating all tokens reproduces the source caught two off-by-ones
early and later turned out to be what makes the comment-preserving formatter
possible.

**Parser recovery — first real bug.** A test asserting that

```
h q
x r
y s
```

reports three missing semicolons reported only one. The recovery rule was "skip
to the next `;` or statement keyword", and with no semicolons anywhere it
consumed the entire file. Added a line-boundary rule: a statement is abandoned
at the first token on a line after the one it started on. Because that can only
fire on a token strictly after the statement's first, progress is guaranteed;
an unconditional progress guard went into the parse loop anyway.

**A test expectation that was wrong, not the code.** `rx() q;` was expected to
be a syntax error. It is not: an empty parameter list is grammatically fine, and
arity is a static-semantics rule. The parser was right and the test was changed
to assert the real contract — the parser stays silent and the analyser reports
`QF205`. The distinction is worth keeping: it is exactly the parser/analyser
boundary.

**Hoisting — second real bug.** The analyser ran declarations in one pass and
statements in another, so

```
qubit q;
rx(theta) q;
const theta = 1;
```

compiled. A test written to pin down declare-before-use caught it. Merged the
two passes into one ordered walk, which is both simpler and gives the better
language rule. 96 frontend tests green after the change.

---

## Phase 3 — Compiler and interoperability

**IR.** Kept deliberately unlike the AST: integers for qubits, flat list,
angles already folded. Added `qubitRegisters`/`clbitRegisters` partway through,
when writing the OpenQASM backend made it clear that reconstructing register
names by string-parsing the display labels would be fragile.

**Pass adjacency.** The `lastOn[q]` scan was the key simplification: one
left-to-right pass answers "are these two instructions adjacent on their shared
qubit set", and barriers, measurements and resets block for free because their
opcodes never match a gate's.

**Rotation merging — third real bug.** `rx(1) rx(2) rx(3)` produced `rx(3)`
instead of `rx(6)`. The callback returned a boolean, so after merging the second
into the first the scan advanced `lastOn` to the second instruction — which was
about to be deleted — and the third merged against its stale, unmerged value.
Replaced the boolean with a three-way verdict (`none`, `both-gone`,
`kept-first`). `both-gone` also made `h h h h` collapse in a single scan instead
of needing one round per pair.

**Verifying the passes.** Inspection is not evidence. The property test
generates random circuits and compares _full statevectors_ before and after, so
a pass that dropped a `-I` would fail even though every probability matched. It
also asserts the passes actually removed something, since a test over circuits
with no cancellable structure would pass vacuously.

**OpenQASM validation.** Golden files were considered and rejected: they would
enshrine a wrong operand order as happily as a right one. Wrote a second
OpenQASM reader using regular expressions and shunting-yard — nothing shared
with the frontend's hand-written lexer and Pratt parser — and made the test
emit, re-read, simulate both and compare. 140 circuits, including asymmetric
`cx` and `ccx` cases that a symmetric test would pass regardless.

**Angle formatting.** Wanted `pi/2` rather than `1.5707963267948966`, without
changing the circuit. Settled on: try a small set of `k*pi/d` forms, accept one
only if re-evaluating reproduces the identical double, else fall back to
`String(x)`. Both requirements met with no tolerance anywhere.

---

## Phase 4 — Simulator

**Conventions first, code second.** Wrote the indexing rule into a comment at
the top of `Statevector` before writing a kernel, because every later bug in a
statevector simulator traces back to that paragraph.

**Bit-order tests must be asymmetric.** A Bell state passes under either
endianness. The tests use `x` on qubit 0 of 3, `x` on qubit 2 of 3, and `cx` in
both directions.

**Reset.** The first instinct is "zero the |1> amplitudes and renormalise". That
is wrong for an entangled qubit: reset is a measurement whose result is
discarded followed by a conditional flip, and the partner must stay correlated
with the outcome that occurred. Implemented it that way and added a test that
resets one half of a Bell pair 200 times and checks the partner matches the
discarded outcome every time.

**Sampling strategies.** Terminal sampling is exact, not an approximation, which
is worth stating because it looks like a shortcut. The predicate for when it is
legal went through two versions: the first used the compiler's
`hasMidCircuitMeasurement`, which was too crude — it flagged a second
measurement of the same qubit, which terminal sampling handles correctly. The
second is in the simulator and keys on resets and on gates acting on
already-measured qubits.

**A test expectation that was wrong again.** The trace test expected `h` on
`|00>` to change one amplitude. It changes two: index 0 goes from 1 to 0.7071
and index 1 from 0 to 0.7071. The implementation was right.

**Cross-validation.** 150 random circuits up to 6 qubits, production kernels
versus the dense oracle, worst disagreement below 1e-12. This is the test that
would have caught an indexing bug, and writing the oracle in a different style —
enumerating basis states rather than manipulating bit masks — is what gives it
teeth.

---

## Phase 5 — CLI

**Exit codes.** Separated "the program has errors" (1) from "the command line
was wrong" (2). Conflating them makes `qforge check` useless in a pre-commit
hook.

**Negative numbers as flag values — small real bug.** `--shots -1` reported
"Unknown option '-1'" because the parser treated any `-`-prefixed token as a
flag. A token matching `-\d` is now accepted as a value, so the error is the
useful "must be an integer in 1..1000000".

**Formatter.** Two bugs found by its own tests: a leading space on every line
after the first (a space was inserted between tokens even when starting a fresh
line), and trailing comments being pushed onto their own line (the statement's
`;` had already flushed the line, so the comment had nothing to append to).

---

## Phase 6-7 — Studio and debugger

**Monaco would not load.** The editor sat on "loading editor..." indefinitely.
`@monaco-editor/react` fetches Monaco from jsDelivr by default — a silent
runtime dependency on a third party, which contradicts the claim that the studio
runs locally. Switched to the bundled `monaco-editor` package.

That took two corrections. The import specifier `monaco-editor/esm/vs/editor/editor.api`
fails because the package's `exports` map rewrites `monaco-editor/x` to
`./esm/vs/x.js`, so the correct specifier is `monaco-editor/editor/editor.api`.
The worker URL had the same problem and failed the production build with a clear
"module not found", which is how it was caught.

**`next/dynamic` without a `loading` fallback suspends the whole tree.** Known
footgun, avoided from the start: the editor's dynamic import has an explicit
fallback so the rest of the studio stays interactive while the chunk loads.

**Debugger design.** Recording every intermediate state up front, rather than
re-running a prefix per step, is what makes backward stepping exact for circuits
with measurement. Added a memory budget with explicit truncation reporting
rather than silently degrading.

**Responsive overflow.** The mobile layout had horizontal scroll: the example
`<select>`'s intrinsic width set a floor the page could not shrink below. Fixed
with `flex-basis` plus `min-width: 0` on the select's row, and `min-width: 0`
on the flex columns. A Playwright test now asserts `scrollWidth === clientWidth`
on both viewports.

---

## Phase 8-9 — Examples and quality

**Two genuine physics errors in my own example comments**, caught by the test
that executes every example and checks its documented claims:

1. `phase-kickback.qf` prepared `|->` and called it "an eigenstate of Z". It is
   an eigenstate of **X**; the Z eigenstates are `|0>` and `|1>`. The circuit
   used `cz`, which left the two qubits entangled rather than kicking a phase
   back, so the measurement was 50/50 instead of deterministic. Rewrote it with
   `cx`, which is the Deutsch-Jozsa mechanism and makes the `|->` preparation
   purposeful.
2. `deutsch-jozsa-constant.qf` declared 6 gates and has 7.

Both were caught because the examples' prose is machine-checked. That was the
single highest-value test in the project: documentation that cannot drift from
the code it describes.

**Playwright selector lessons.** Three failures were test bugs, not app bugs:
`getByText('compiles')` also matched "The program compiles"; `|01>` appears in
the Bell example's _comments_, so state assertions had to be scoped to the
results panel; and the narrow-layout "Code" tab becomes "Code 1" once the error
badge appears, so `{ exact: true }` stopped matching. The last one was found by
reading the Playwright call log rather than guessing.

**Playwright reused the dev server.** The first full run failed 16 of 17 tests
with Monaco timeouts, because `reuseExistingServer` connected to the running dev
server and two parallel workers were enough to make its chunk serving too slow.
Stopping the dev server let Playwright use its own static server, and 17 of 17
passed in 27 s.

---

## Phase 10 — Documentation

Wrote `docs/benchmarks.md` from the actual output of `scripts/benchmark.mjs`,
not from memory. The interesting finding is that Hadamard throughput flattens
near 400 million amplitudes per second from about 12 qubits up, which identifies
the kernels as memory bound rather than arithmetic bound — and explains why `cx`,
a pure permutation, is consistently faster.

Added `tests/integration/spec-integrity.test.ts` so the specification cannot
drift: every diagnostic code the compiler can emit must appear in the spec's
table, and every example must be listed in the examples README.
