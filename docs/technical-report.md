# QForge: a compiler and simulator for a small quantum programming language

A technical report on the design, implementation and validation of QForge.

> **Status.** This is a technical report, written in a research style because
> that style suits the material. It has not been peer reviewed, submitted
> anywhere, or evaluated by anyone outside this project. The implementation was
> written with AI assistance; see
> [technical-mastery.md](technical-mastery.md) for the full contribution
> disclosure.

---

## Abstract

QForge is a statically analysed programming language for quantum circuits, with
a hand-written compiler, an independently implemented statevector simulator, a
command-line tool and a browser development environment with a step debugger.
It wraps no existing quantum SDK: the lexer, parser, semantic analyser,
intermediate representation, optimiser, OpenQASM 3 backend and simulation
kernels are all original, and the four core packages have no runtime
dependencies.

The system's correctness is established against four references that were
chosen to fail independently, the most important being Qiskit 2.2.3, which is
developed with no connection to this project. Across 33 unitary circuits the
worst statevector amplitude disagreement with Qiskit is 1.241e-16 — single-ulp
floating-point noise — with no failures at a tolerance of 1e-10. Optimised
circuits agree to 1.732e-16 against Qiskit's result for the _unoptimised_
input, which validates the optimiser rather than merely the simulator. Four
circuits whose evolution depends on measurement, including quantum
teleportation, agree in total variation distance to within Monte Carlo error at
200,000 shots.

Two findings are reported that an evaluation designed only to confirm success
would have suppressed: Qiskit rejected QForge's OpenQASM output for predicates
on single classical bits, which was a real conformance bug in QForge; and the
NumPy oracle disagreed with QForge on an entangled mid-circuit `reset`, which
turned out to be a bug in the oracle.

---

## 1. Introduction

Quantum programming is usually taught and practised through circuit-construction
libraries embedded in Python. These are effective for building circuits, but
they put a layer of host-language machinery between the programmer and the
program: a circuit is a data structure assembled at runtime rather than a text
with a grammar, so there is nothing to typecheck, nothing to report a
diagnostic against, and no obvious place for a compiler pass to live.

QForge takes the other route. A QForge program is source text with a grammar, a
type discipline and compile-time diagnostics, which is compiled to a flat
intermediate representation, optimised, and then either emitted as OpenQASM 3
or executed by a simulator. This makes the usual compiler-engineering questions
— what is the IR, what are the passes, what does a pass have to preserve —
first-class, and it makes the usual programming-language affordances available:
a span-accurate error with a hint, a step debugger, an editor that reports a
problem as you type.

The contribution of this project is not a new result in quantum computing. It
is an end-to-end system, built without wrapping existing tools, whose
correctness is established against independent references and whose limitations
are documented rather than elided.

### 1.1 Design goals

1. **Original implementation.** No quantum SDK is wrapped. The point of the
   exercise is the compiler and the simulator, which a wrapper would not
   contain.
2. **No fabricated evidence.** Every benchmark number is produced by a
   reproducible command. Every claim about a feature is backed by a test that
   runs in CI.
3. **Independence of oracles.** A simulator checked only against itself proves
   nothing. References were chosen to share as little as possible with the code
   they check.
4. **Honest limits.** What the system cannot do is documented in a file of its
   own and linked from the top of the README.
5. **Zero-friction operation.** No cloud service, no account, no API key, no
   paid dependency. `pnpm install && pnpm test` is the whole setup.

---

## 2. Background

A quantum state over `n` qubits is a unit vector in a complex space of
dimension `2^n`. A gate is a unitary matrix acting on that vector; a circuit is
a sequence of gates. Measurement in the computational basis yields outcome `k`
with probability `|a_k|^2` and leaves the state collapsed onto the measured
subspace, renormalised.

Statevector simulation represents the state explicitly and applies each gate in
turn. The cost is therefore exponential in the qubit count in memory —
`2^n * 16` bytes for double-precision real and imaginary parts — and linear in
the number of amplitudes per single-qubit gate. This bounds what any
statevector simulator can do, and QForge states its bound rather than implying
it can be exceeded: 14 qubits in the browser, 20 in the CLI, 26 as a hard
ceiling.

Two conventions have to be fixed before anything else, because changing them
later invalidates every test:

- **Bit order.** QForge places qubit 0 at the least significant bit of the
  amplitude index, and prints kets most significant bit first. Qubit 0 is
  therefore the rightmost character of `|01>`. This matches Qiskit and
  OpenQASM, which is why the cross-validation in §8 is meaningful rather than a
  permutation exercise.
- **Rotation convention.** Rotations use the half-angle definition
  `RX(t) = exp(-i t X / 2)`, so `rx(pi)` is `-iX` rather than `X`. The
  consequences are visible in the optimiser (§7) and are a frequent source of
  confusion when comparing two tools.

---

## 3. The language

QForge is deliberately small. The full grammar is in
[language-spec.md](language-spec.md); what matters here are the decisions.

```qforge
qubit alice;
qubit bob;
bit m0;
bit m1;

h alice;
cx alice, bob;

measure alice -> m0;
if (m0 == 1) { z bob; }
```

**Declare before use, in one pass.** An early implementation hoisted
declarations in a first pass. That was removed: the analyser now makes a single
ordered pass, so a name must be declared textually before it is used. The
language is smaller for it, the analyser is simpler, and the error messages
improve — `unknown qubit 'bob'` is more useful than a forward reference that
silently resolves.

**Registers and bits are distinct.** `qubit q[3]` declares a register;
`qubit q` declares a single qubit. A predicate may compare a whole register to
an integer or a single bit to 0 or 1, and the two lower to different OpenQASM 3
forms (§5.3).

**Constant folding, no evaluation.** Expressions over literals, `pi` and `e`
are folded at compile time by a Pratt expression parser and a small evaluator
over a closed set of operations. There is no `eval` anywhere in the codebase,
and no runtime arithmetic: a gate parameter is a number by the time it reaches
the IR.

**No general classical computation.** There are no variables, no loops, no
functions, no arithmetic on measured bits. This is a real limitation, and it is
documented as one. The cost of adding it is not the syntax; it is that the flat
IR and the optimiser's correctness argument (§7) both depend on the instruction
list being statically known.

---

## 4. Compiler architecture

```
source ──▶ lexer ──▶ parser ──▶ AST ──▶ analyser ──▶ IR ──▶ passes ──▶ ┬▶ OpenQASM 3
                                                                       └▶ simulator
```

The four core packages form an acyclic chain: `language` ← `compiler` ←
`simulator` ← `cli`. None of them has a runtime dependency.

| Package     | Source lines | Test lines |
| ----------- | -----------: | ---------: |
| `language`  |        3,756 |      1,069 |
| `compiler`  |        1,925 |        502 |
| `simulator` |        2,223 |      1,259 |
| `cli`       |        1,100 |          — |
| `studio`    |        6,648 |          — |

(Counted with `wc -l` over `.ts`/`.tsx`, excluding `node_modules` and
`*.test.ts`; integration, property and conformance suites live in `tests/`.)

### 4.1 Lexer

Hand-written and total: every byte of input produces a token, including an
explicit `Invalid` token for characters that belong to no other class. A lexer
that can fail is a lexer that can lose the rest of the file, and recovery (§4.2)
depends on always having a token stream to resynchronise against.

### 4.2 Parser and error recovery

Recursive descent for statements, with a Pratt sub-parser for expressions.

Recovery is where the interesting bug was. The first implementation
resynchronised on semicolons. Given a file with no semicolons at all — which is
exactly what a beginner's first broken program looks like — it consumed the
entire file in a single recovery step and reported one error. The fix was to
add a line boundary as a synchronisation point and, separately, a guard that
guarantees forward progress on every recovery step. Both are necessary: the
first makes the diagnostics useful, the second makes termination unconditional.

A second bug of the same family: a deeply nested expression could overflow the
JavaScript stack before the depth check ran, because the check examined the
tree on the way _up_. The fix was a descent-side counter incremented before
recursing and decremented in a `finally`, which fails at a bounded depth
(`MAX_EXPRESSION_DEPTH = 256`) rather than crashing the process. A
hostile-input test covers it.

### 4.3 Semantic analysis

A single ordered pass over the AST with a symbol table, producing diagnostics
with source spans and, where useful, a hint. The analyser is also where a
predicate is resolved: a bare register name is accepted only in a condition
position, and nowhere else.

### 4.4 Intermediate representation

The IR is a **flat list of instructions**, each carrying its opcode, qubit
operands, optional parameter, optional classical bit and optional predicate,
plus a source span. It is deliberately syntax-independent: nothing downstream
can see whether a `z` came from a bare statement or from inside an `if`.

The source span is what makes the step debugger possible — stepping the
simulator highlights the statement that produced the instruction — and it is
why diagnostics can be reported against the original text after three
transformations.

---

## 5. Classical control

### 5.1 Predication rather than nesting

The obvious representation of `if (m0 == 1) { z bob; x bob; }` is a block
instruction containing a nested list. QForge instead **predicates** each
instruction: the block disappears, and each instruction inside it carries the
condition `m0 == 1`.

This is the single most consequential design decision in the compiler. The
IR stays flat, so every pass written for straight-line code continues to work
unchanged; there is no "enter block, recurse, exit block" case in the optimiser,
the OpenQASM emitter, the circuit renderer or the debugger. The cost is that a
condition is repeated on each instruction, which is paid once in memory and
recovered immediately in the simplicity of everything downstream.

The full argument, including the alternatives rejected, is in
[classical-control-design.md](classical-control-design.md).

### 5.2 Why predication makes optimisation harder, and how that is handled

Flattening does not make the optimiser's job free. Two instructions that look
adjacent in the list may be separated by a measurement that writes the very bit
one of them is predicated on. Cancelling them would be wrong.

The fix is to treat qubits and classical bits as a single **resource** index
space — classical bit `c` becomes resource `qubitCount + c` — so that
adjacency analysis automatically accounts for a measurement that writes a bit
read by a predicate:

```ts
export function touchedResources(instruction: IrInstruction, qubitCount: number): number[] {
  const resources = touchedQubits(instruction, qubitCount);
  if (instruction.clbit !== undefined) resources.push(qubitCount + instruction.clbit);
  for (const clbit of instruction.condition?.clbits ?? []) resources.push(qubitCount + clbit);
  return [...new Set(resources)];
}
```

A property test generates circuits mixing measurement, predication and
cancellable pairs, and asserts that the optimised circuit's distribution
matches the unoptimised one.

### 5.3 Teleportation as the acceptance test

Quantum teleportation is the smallest protocol that genuinely requires
feed-forward, so it is the test that classical control actually works.

The subtlety is that **measurement counts cannot detect whether it works**.
Alice's Bell measurement is unbiased, so all four outcomes occur at about 25%
whether or not Bob applies his corrections. A test that compared histograms
would pass on a completely broken implementation.

The test therefore computes **Bob's reduced density matrix** by tracing out the
other two qubits, and asserts that it is the pure state Alice started with. For
the example in the repository, `ry(2*pi/5)` prepares a state with
`<Z> = cos(2*pi/5) = 0.3090`, an asymmetric value chosen so that a wrong or
skipped correction is unmistakable. The studio's Bloch panel displays the same
quantity, so the claim is checkable by hand as well as in CI.

---

## 6. Simulator

### 6.1 Representation and kernels

The state is two `Float64Array`s, real and imaginary. A single-qubit gate on
qubit `q` is applied by **pair-stepping**: iterating over the amplitude indices
with bit `q` clear and combining each with its partner at `index | (1 << q)`.
This touches every amplitude exactly once with no allocation and no index
arithmetic beyond masking.

Specialised kernels exist where the general path would waste work:

- `cx`, `ccx` and `swap` are **permutations** — they move amplitudes without
  arithmetic.
- `cz` is **diagonal** — it only negates a subset of amplitudes.

The measured effect is in §8.2.

### 6.2 Measurement

Three distinct things are kept distinct, because conflating them is a common
source of wrong answers:

1. the **exact probability** of each outcome, computed from the state;
2. the **sampled outcome** for this shot, drawn from those probabilities;
3. the **collapsed state** after that outcome.

`reset` is implemented as measure-and-conditional-flip, not as a projection
onto `|0>`. For a qubit entangled with others this matters: projecting would
produce a pure state that the physics does not produce, while
measure-and-flip correctly yields an ensemble. The Qiskit comparison in §8.1
includes an entangled `reset` precisely because this is easy to get wrong.

### 6.3 Shot strategy

Two strategies, selected automatically and **reported** in the output:

- **Terminal sampling** for circuits whose evolution does not depend on a
  measurement outcome: evolve once, then draw all shots from the final
  distribution. Cost is one evolution plus `O(shots)`.
- **Per-shot replay** for circuits with predicated instructions: the branch
  taken differs per shot, so each shot is replayed.

The CLI and the studio both print which strategy ran, because a user comparing
timings between two circuits deserves to know that the strategies differ.

### 6.4 Randomness

`xoshiro128**`, seeded through `splitmix32`. A fixed seed reproduces a run
exactly, including the per-shot branch decisions, which is what makes the step
debugger's measurement trace meaningful rather than decorative.

---

## 7. Optimisation and its correctness contract

Three passes — `remove-identity`, `cancel-inverses`, `merge-rotations` — run to
a fixpoint under a pass manager.

The contract is stated explicitly and is stricter than the obvious one:

> A pass must preserve the circuit's **operator, including global phase** — not
> merely its measurement statistics.

This has a consequence that reviewers tend to probe, and it is the right
answer: under the half-angle convention, `rx(2*pi) = -I`. It is unobservable in
isolation, but it is _not_ unobservable when the qubit is entangled or the
rotation is controlled, so removing it would be wrong in general. QForge
therefore removes `rx(4*pi)` and keeps `rx(2*pi)`. Qiskit agrees with both
decisions (§8.1).

`merge-rotations` had a genuine bug worth recording. Folding `rx(1) rx(2)
rx(3)` pairwise, a naive implementation compared each instruction against the
_original_ neighbour rather than the merged result, producing `rx(3)` instead
of `rx(6)`. The fix was to make the adjacency check return a three-way verdict
— `none`, `both-gone`, `kept-first` — so that the pass knows whether the
instruction it is holding is still the one in the list.

---

## 8. Evaluation

### 8.1 Correctness against independent references

Four references, chosen to fail independently:

| Reference               | Independent of                                                  | Shares                     |
| ----------------------- | --------------------------------------------------------------- | -------------------------- |
| Dense-matrix oracle     | the bit-masked kernels; defines its own gate matrices           | the repository, the author |
| In-repo OpenQASM reader | the hand-written lexer and Pratt parser (regex + shunting-yard) | the repository, the author |
| NumPy script            | the language and the runtime entirely                           | the author                 |
| **Qiskit 2.2.3**        | everything                                                      | nothing                    |

Only the last is independent of the author's assumptions, which is why it was
added in the second phase of the project and why it is the headline result.
Full method and per-case tables are in
[validation-report.md](validation-report.md).

| Check                                            | Cases | Worst disagreement | Failures |
| ------------------------------------------------ | ----: | -----------------: | -------: |
| Statevector, including global phase              |    33 |          1.241e-16 |        0 |
| Optimised circuit vs Qiskit's unoptimised result |    33 |          1.732e-16 |        0 |
| Exact measurement distributions                  |     5 |                  0 |        0 |
| Measurement-dependent circuits, 200k shots (TVD) |     4 |            0.00246 |        0 |
| Generated OpenQASM 3 loaded by Qiskit            |    42 |                  — |        0 |

The tolerance for the statevector comparisons is 1e-10; the observed worst case
is four orders of magnitude tighter and is consistent with the two
implementations ordering their floating-point operations differently. The
measurement-dependent cases include quantum teleportation; at 200,000 shots,
five standard deviations near p = 0.5 is about 0.006, so a TVD of 0.00246 is
within sampling error.

### 8.2 Performance

Measured by `pnpm bench` on an Apple M2 (8 cores, 8 GiB, Node 24.16.0), median
of timed repetitions after a warm-up. Full tables in
[benchmarks.md](benchmarks.md).

| Measurement                             |         Result |
| --------------------------------------- | -------------: |
| Compile 10,000 gates, end to end        |        27.5 ms |
| Frontend throughput                     | ~330,000 ops/s |
| `h` at 20 qubits (1,048,576 amplitudes) |       2.638 ms |
| Amplitude throughput, `h`               |       ~397 M/s |
| 1,000,000 shots at 12 qubits            |       313.3 ms |
| PRNG                                    |       18.3 M/s |

The permutation kernels pay off as expected: `cx` is consistently faster than
`h` at the same width (1.922 ms vs 2.638 ms at 20 qubits), because it moves
amplitudes rather than combining them.

### 8.3 Test suite

700 unit tests across 22 files, plus 68 browser tests run against both a
desktop viewport and a Pixel 7. Coverage is 92.8% of statements, 85.27% of
branches, 96.29% of functions and 94.29% of lines.

These numbers are reported for completeness and should not be mistaken for the
correctness argument. Coverage says lines executed, not that the right
assertion was made about them; the evidence that carries weight is §8.1. The
suites that actually constrain behaviour are the differential ones: every
`examples/*.qf` file carries machine-checked `@expect` directives, and that
suite caught two real physics errors in this project's own example prose — a
claim that `|->` is a Z eigenstate (it is an X eigenstate) and a gate count
that did not match the circuit.

### 8.4 Studio responsiveness

Simulation runs in a Web Worker with run IDs, staleness rejection, chunked
yielding and a timeout with recovery. The claim that the UI stays responsive
during a long run was measured rather than asserted: with the main thread
deliberately blocked for 120 ms, the worker advanced to 14,000 shots.

A note on method, because the first attempt was wrong. The initial measurement
used the Long Tasks API, which never fires in headless Chromium — it would have
reported "0 long tasks" for a page that was completely frozen. The control case
added to detect exactly this caught it, and the measurement was redone with
timer-gap sampling, whose control (a deliberate 400 ms block) correctly
produced a 402 ms gap.

---

## 9. Threats to validity

**Shared-author oracles.** Three of the four references in §8.1 were written by
the same author as the code they check. A consistent misunderstanding of a
convention — rather than a mistake in a line — could pass all three. This is
the specific reason Qiskit was added, and it is why the Qiskit result is
reported separately rather than aggregated with the others.

**Oracle correctness.** An oracle can be wrong. The NumPy reference disagreed
with QForge on an entangled mid-circuit `reset`, with a total variation
distance of 0.499 — close to maximal. The bug was in the NumPy script: its
`_apply` moved multi-qubit axes to the front, so `cx(0,1)` was executed as
`cx(1,0)`. QForge's answer was the physically correct one. The episode is
reported because an oracle that has never been wrong is an oracle nobody has
checked hard enough.

**Scale.** The Qiskit comparison covers circuits of at most 5 qubits. Nothing
here establishes correctness at 20 qubits, where a kernel indexing bug that
only manifests above a certain width would not be caught.

**Adversarial numerics.** No evaluation of near-degenerate amplitudes,
accumulated error over very long circuits, or denormal behaviour.

**Conformance scope.** 42 of 42 generated OpenQASM 3 files load into Qiskit and
reconstruct to the same circuit. That establishes interoperability with
Qiskit's importer, not conformance to the OpenQASM 3 specification in general.

**Benchmark scope.** All performance figures are from a single machine, single
run of `pnpm bench`, median of repetitions. No cross-platform comparison, no
comparison against other simulators — a comparison that would require running
them under identical conditions, which has not been done, so no such claim is
made.

---

## 10. Limitations

Stated here in summary; the full list is in
[limitations.md](limitations.md).

- No general classical computation: no variables, loops, functions, or
  arithmetic on measured bits. Predicates compare a bit or a register against a
  constant.
- No noise model, no density-matrix simulation, no error correction.
- No gate synthesis, routing, or hardware-aware transpilation. QForge emits the
  gates you wrote.
- Statevector only, so the qubit ceiling is hard: 14 in the browser, 20 in the
  CLI, 26 absolute.
- No user-defined gates and no subroutines.
- The gate set is 17 gates. `cy`, `ch`, controlled rotations and `u` are absent.

---

## 11. Related work

**Circuit libraries.** Qiskit, Cirq and ProjectQ construct circuits as host
data structures in Python. They are vastly more capable than QForge and are the
right tool for real work; the difference in kind is that a circuit built by
calling methods has no grammar, no diagnostics with spans and no compiler
passes operating on a program text.

**Quantum assembly.** OpenQASM 3 [1] is a textual quantum language with real
classical control. QForge targets a subset of it as an output format and
borrows its bit-order convention. QForge's source language is smaller and more
restrictive by design.

**High-level quantum languages.** Q#, Quipper, Scaffold and Silq [2] all
explore richer type systems and abstraction. Silq's automatic uncomputation is
the kind of result QForge makes no attempt at. These define the direction a
project like this one would have to grow in to be research rather than
engineering.

**Simulators.** QuEST and the simulators inside the libraries above are
distributed, multi-threaded and GPU-capable. QForge's simulator is
single-threaded JavaScript and makes no competitive performance claim; its
figures (§8.2) are reported so the limits are visible, not to compare.

---

## 12. Conclusion

QForge is a complete, original implementation of a small quantum programming
language: lexer through to optimiser, a simulator, a CLI and a browser
environment with a step debugger. Its behaviour agrees with Qiskit to within
floating-point noise on every case tested, including the optimised forms and
the circuits that depend on measurement outcomes. The work that remains is
stated as limitations rather than implied as future work that is nearly done.

The project's own evaluation found two bugs that make the evaluation
credible: one in QForge's OpenQASM conformance, found by Qiskit, and one in an
oracle, found by its disagreement with QForge. Both are reported in full.

Immediate directions, in the order they would matter:

1. **Widen the validated range.** The Qiskit corpus stops at 5 qubits; a kernel
   bug that appears only above a word boundary would not be caught.
2. **A larger gate set**, starting with `cy` and controlled rotations, each
   added through every layer and validated the same way.
3. **Classical computation on measured bits**, which is the limitation that
   most restricts what can be expressed, and which would require revisiting the
   optimiser's correctness argument in §7.

---

## References

1. A. W. Cross et al. "OpenQASM 3: A Broader and Deeper Quantum Assembly
   Language." _ACM Transactions on Quantum Computing_, 2022.
2. B. Bichsel, M. Baader, T. Gehr, M. Vechev. "Silq: A High-Level Quantum
   Language with Safe Uncomputation and Intuitive Semantics." _PLDI_, 2020.
3. M. A. Nielsen and I. L. Chuang. _Quantum Computation and Quantum
   Information._ Cambridge University Press, 2010.
4. V. R. Pratt. "Top Down Operator Precedence." _POPL_, 1973.
5. D. Blackman and S. Vigna. "Scrambled Linear Pseudorandom Number Generators."
   _ACM Transactions on Mathematical Software_, 2021.

---

## Appendix: reproducing every number in this report

```bash
pnpm install
pnpm build

pnpm test                                   # §8.3 unit tests
pnpm coverage                               # §8.3 coverage
pnpm test:e2e                               # §8.3 browser tests
pnpm bench                                  # §8.2 performance
pnpm examples                               # §8.3 @expect directives
pnpm verify:numpy                           # §9 NumPy cross-check

pnpm --filter @qforge/validation setup      # once: isolated venv via uv
pnpm --filter @qforge/validation validate   # §8.1 Qiskit cross-validation
```

If any of these disagree with the figures above, this report is out of date and
should be corrected rather than explained.
