# Design decisions

Each entry records a decision, the alternatives considered, and why they were
rejected. Decisions that turned out to be wrong are recorded as such rather than
quietly rewritten.

---

## 1. A small language, not a general one

**Decision.** Straight-line circuits only: no loops, no conditionals, no
functions, no dynamic circuit construction.

**Alternatives.** A fuller language with classical control flow; a Python
embedded DSL.

**Why.** The audience is people learning how compilers and quantum circuits
work. A grammar that fits on one page can be read in full, and every feature
left out is one whose semantics could have been implemented badly. Classical
feed-forward in particular changes what the simulator must do per shot and what
the optimiser may reorder — implementing it half-way would be worse than saying
plainly that it is absent.

**Cost.** Quantum teleportation cannot be expressed. Rather than ship a
misleading approximation, it is absent from the examples and the reason is
documented.

---

## 2. Hand-written lexer and parser

**Decision.** Recursive descent with a Pratt expression parser, no generator.

**Alternatives.** PEG.js, Chevrotain, ANTLR, tree-sitter.

**Why.** The grammar is small, so a generator saves little. It costs control
over precise spans and multi-error recovery, both of which the editor needs.
And for a project whose point is to show how a compiler works, the most
interesting stage should not be a grammar file and a build step.

**Cost.** Precedence and associativity are maintained by hand. Mitigated by
tests that pin the cases people get wrong (`-2 ^ 2`, `2 ^ 3 ^ 2`).

---

## 3. Qubit 0 is the least significant bit

**Decision.** Amplitude index `k` has qubit `j` equal to `(k >> j) & 1`; ket
labels print most significant first, so qubit 0 is rightmost.

**Alternatives.** Big-endian, with qubit 0 leftmost.

**Why.** It matches Qiskit and OpenQASM. A user comparing QForge's output
against another tool should not have to mentally reverse bitstrings.

**How it is protected.** A Bell state is symmetric under reversing the qubits
and cannot detect a bit-order bug, so the tests use asymmetric circuits, and
NumPy cross-checks the same cases with its own Kronecker products.

---

## 4. Declare-before-use, in one pass

**Decision.** A name is visible only to statements after its declaration.

**Originally.** Two passes: all declarations, then all statements. A `const` at
the bottom of the file was visible at the top.

**Why it changed.** A test written to pin down declare-before-use caught the
hoisting. Merging into a single ordered pass is simpler _and_ gives the better
rule: the reading order of a circuit is its execution order.

---

## 5. Passes preserve the operator, not just the statistics

**Decision.** A pass must preserve the circuit's operator including global
phase. So `rx(2*pi)`, which equals `-I`, is **not** removed; only multiples of
`4*pi` are.

**Alternative.** Treat global phase as free, which every probability-based test
would accept.

**Why.** The debugger displays raw amplitudes. If optimisation flipped their
sign, "the same program, optimised" would show different numbers and the tool
would be teaching that amplitudes are arbitrary. They are not — relative phase
is the whole mechanism of interference, and a rule that says "global phase is
free" is one step from a bug that drops a relative one.

**Cost.** A missed optimisation. `examples/optimisable.qf` shows the kept
`rz(2*pi)` next to the dropped `rz(4*pi)`.

---

## 6. Two sampling strategies, chosen automatically

**Decision.** Terminal measurements are sampled from one final statevector;
circuits with a reset or a gate after a measurement are replayed per shot. The
choice is automatic and reported.

**Alternatives.** Always replay (correct, up to a thousand times slower); always
sample (fast, silently wrong for mid-circuit measurement).

**Why.** Terminal sampling is exact, not an approximation, and it is what makes
a million shots cost 0.3 s instead of minutes. Reporting the choice means a
user whose circuit got slow learns why.

**How it is protected.** The predicate is conservative — any `reset` forces
replay, even one that would be deterministic — and a test compares a
mid-circuit circuit against brute-force replay.

---

## 7. Record the whole trace, do not re-run prefixes

**Decision.** `traceCircuit` executes once and stores the state after every
instruction, within a memory budget.

**Alternative.** Re-run the first `k` instructions when the user steps to `k`.

**Why.** Cheaper in memory and _wrong_. A circuit with a measurement has a
random branch; re-running could land on a different branch and show a state that
never occurred in the run the user is looking at. Recording makes backward
stepping free and exact.

**Cost.** `2^n * 16` bytes per step. Past the budget, amplitudes stop being
retained, probabilities continue, and the UI is told.

---

## 8. Two independent reference implementations in the test suite

**Decision.** A dense-matrix oracle and a minimal OpenQASM reader, written in
deliberately different styles from the code they check.

**Alternative.** Golden files.

**Why.** Testing a simulator against itself proves nothing. A golden file
records whatever the generator produced, including a wrong operand order. The
dense oracle enumerates basis states where the production kernels manipulate bit
masks; the QASM reader uses regular expressions and shunting-yard where the
frontend uses a hand-written lexer and Pratt parser. Agreement is evidence
because the implementations share nothing.

**Cost.** Two extra implementations to maintain. Worth it: they are the only
tests that could catch a systematic indexing error.

---

## 9. NumPy as a third, external check

**Decision.** `scripts/numpy-reference.mjs` validates gate matrices and bit
order against NumPy, as a development script rather than part of `pnpm test`.

**Why.** Both in-repo references were written by the same author and could share
a misunderstanding — a sign error in `Y`, say. NumPy is outside the project
entirely and costs nothing: it is already installed, and no paid service or
network call is involved.

**Why not in CI.** It would make the suite depend on a Python toolchain. The
script exits 0 with a clear notice when NumPy is unavailable.

---

## 10. The studio is a static export with no backend

**Decision.** `output: 'export'`. No server component does work, no API route,
no telemetry. The compiler and simulator run in the browser.

**Alternatives.** A server-side `/api/run`.

**Why.** A user's quantum program never leaves their machine, the site can be
hosted anywhere static, and there is no server to secure or pay for. It also
forces the packages to stay genuinely portable.

**Cost.** Everything competes with the UI for one process. Simulation and the
step trace were moved into a Web Worker in 0.2, which removed the freezing;
compilation still runs on the main thread, debounced by 160 ms. The 14-qubit
browser limit survives for a different reason — the debugger stores a
statevector per instruction — which [limitations.md](limitations.md) sets out.

---

## 11. Monaco bundled, not loaded from a CDN

**Decision.** Import `monaco-editor/editor/editor.api` and point
`@monaco-editor/react`'s loader at it.

**Originally.** The library's default, which fetches Monaco from jsDelivr.

**Why it changed.** It was observed hanging on "loading editor..." with no error
to diagnose. More fundamentally, it contradicted the claim that the studio runs
entirely locally: the default behaviour was a silent runtime dependency on a
third party.

**Cost.** A larger bundle. Importing `editor.api` rather than the whole package
keeps the language services out, since QForge registers its own grammar.

---

## 12. The formatter works on tokens, not the AST

**Decision.** Rewrite whitespace between tokens.

**Alternative.** Pretty-print from the AST, which is the usual approach.

**Why.** The AST deliberately does not retain comments — nothing in the compiler
needs them — and a formatter that silently deleted every comment would be worse
than none. The token stream has comments and their positions.

**Cost.** The formatter cannot restructure code, only re-space it. That is the
right scope for a language with no nesting.

---

## 13. Per-symbol registers in generated OpenQASM

**Decision.** Emit `qubit[3] q;` per QForge declaration, keeping the
programmer's names, with `_` prefixing on keyword collisions.

**Alternative.** One flat `qubit[n] q;` with a comment mapping names to indices.

**Why.** Generated code that keeps your names is readable and round-trips
meaningfully. Flattening is simpler but produces output nobody wants to read.

**Cost.** A reserved-word list to maintain, including `stdgates.inc` gate names
— a qubit named `h` would otherwise shadow the Hadamard gate.

---

## 14. Angles emitted exactly, prettily where possible

**Decision.** Try `k*pi/d` forms, accept only if re-evaluating reproduces the
same double; otherwise emit `String(x)`, JavaScript's shortest round-tripping
decimal.

**Alternatives.** Always decimal (exact, unreadable); always pretty with a
tolerance (readable, silently changes the circuit).

**Why.** Both requirements can be met at once. Output is always exact and pretty
whenever pretty is exact.

---

## 15. Diagnostics are data, never exceptions

**Decision.** Every stage collects diagnostics and returns them. Nothing throws
on bad user input.

**Why.** The editor needs every error at once. A stage that threw would report
one and hide the rest. Exceptions are reserved for genuine internal errors — an
unknown opcode reaching a backend — where failing loudly is right.

---

## 16. `@qforge/simulator` depends on `@qforge/compiler`

**Decision.** The simulator imports IR types from the compiler.

**Alternative.** A separate `@qforge/ir` package, letting the simulator be used
with no compiler present.

**Why.** It would be a package per interface rather than per responsibility, for
one small type module. The dependency chain stays acyclic either way.

**Reconsider if.** Someone wants to drive the simulator from a different
frontend — then `@qforge/ir` is the right move.
