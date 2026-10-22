# QForge — technical brief

## Summary (150 words)

QForge is a programming language, compiler and quantum simulator built to make
the inside of a compiler visible. A user writes a small domain-specific language
for quantum circuits; a hand-written lexer and recursive-descent parser produce
a typed AST, a single-pass semantic analyser resolves names to global qubit
indices and folds angle expressions, and lowering produces a flat,
syntax-independent intermediate representation. Four optimisation passes rewrite
the IR under a strict contract — they must preserve the circuit's operator
including global phase, not merely its measurement statistics — and a backend
emits OpenQASM 3. An independently implemented statevector simulator executes
the IR, with correct measurement collapse, seeded reproducible sampling, and a
recorded execution trace that powers a step debugger. The browser studio shows
tokens, AST, IR, pass report and generated code for the same program, and steps
through its quantum state one gate at a time.

## Problem

Two things are usually hidden from learners. Compilers are presented as
black boxes: source goes in, a binary comes out, and the intermediate forms are
invisible. Quantum computing is presented through either dense linear algebra or
animated marketing, with little in between — and quantum simulators in
particular make it easy to confuse a probability with an outcome.

QForge makes both visible at once, using a language small enough that every
stage can be shown in full.

## Architecture

```
source -> lexer -> parser -> AST -> semantic analysis -> IR -> passes
                                                          |-> OpenQASM 3
                                                          |-> statevector simulator
                                                          |-> execution trace -> debugger
```

Four packages in a dependency chain with no cycles: `@qforge/language` (no
numerical code), `@qforge/compiler` (IR, passes, backends), `@qforge/simulator`
(no parsing), and a CLI. The browser studio is a static export that runs those
same packages client-side: no server component, no API route, no telemetry.

## Original engineering contributions

1. **Operator-equality optimisation contract.** Passes preserve global phase,
   not only measurement statistics. `rx(2*pi) = -I` is therefore _not_ removed
   while `rx(4*pi) = I` is. This is stricter than necessary for correctness of
   results and is what lets the debugger show identical amplitudes with
   optimisation on or off.

2. **A single-scan adjacency test for pass legality.** One left-to-right walk
   maintaining the last instruction per qubit decides whether two instructions
   are adjacent factors on a shared qubit set, with barriers, measurements and
   resets blocking for free. A three-way verdict lets runs of more than two
   gates resolve in one scan.

3. **Automatic sampling-strategy selection.** Terminal measurements are sampled
   exactly from one final statevector; a reset or a gate after a measurement
   forces per-shot replay. The chosen strategy is reported, which turns a
   thousand-fold performance difference from a mystery into an explanation.

4. **Recorded execution traces.** The circuit runs once and every intermediate
   state is stored, so backward stepping is exact for circuits with measurement
   rather than re-rolling a random branch.

5. **Loss-free pretty angle serialisation.** `pi/2` forms are emitted only when
   re-evaluating them reproduces the identical IEEE-754 double; otherwise the
   shortest round-tripping decimal. Readable and exact, with no tolerance.

6. **Comment-preserving token-level formatter.** The AST does not retain
   comments, so the formatter rewrites whitespace between tokens instead.

## Validation

Correctness is established by three deliberately independent references, because
testing a simulator against itself proves nothing.

| Reference               | Independence                                                      | Result                                        |
| ----------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Dense-matrix oracle     | Enumerates basis states; production kernels use bit masks         | 150 random circuits ≤6 qubits agree to <1e-12 |
| Minimal OpenQASM reader | Regex + shunting-yard; frontend is hand-written + Pratt           | 140 round trips preserve the statevector      |
| NumPy                   | Outside the language entirely, matrices from textbook definitions | 22 circuits agree to ≤5.6e-17                 |

Plus analytic checks (X, H, Bell, GHZ, H-Z-H, rotation identities), property
tests comparing full statevectors before and after optimisation on random
circuits, sampled frequencies against exact distributions at 5 sigma, and
machine-checked example documentation — the prose in every `examples/*.qf` is
executed and verified in CI.

## Measured outcomes

On an Apple M2, Node 24 (full tables in [benchmarks.md](benchmarks.md)):

- 10,000-gate program compiles end to end in ~24 ms (~340k operations/second)
- Hadamard throughput flattens near 400 million amplitudes/second from 12 qubits
  up, identifying the kernels as memory bound rather than arithmetic bound
- `cx` is consistently faster than `h`, because a controlled-X is a permutation
- 1,000,000 shots of a 12-qubit circuit in ~0.31 s (~3.2 million shots/second)
- 20 qubits, 390 gates: ~0.9 s, 16 MiB statevector

## Limitations

No classical control flow, so quantum teleportation cannot be expressed and is
deliberately absent rather than approximated. No user-defined gates. Statevector
only — no density matrices, noise, or stabiliser backend. The OpenQASM backend
covers only the subset QForge can express and makes no conformance claim. Limits
are 14 qubits in the browser, 20 in the CLI, 26 hard.

## Next development

1. Move compilation and simulation into a Web Worker, which is the prerequisite
   for raising the browser's 14-qubit limit.
2. Add classical control flow — a conditional IR opcode, a branch-aware
   execution path, and pass changes — which unlocks teleportation.
3. Add a language server so the diagnostics work in any editor, not only the
   studio.
