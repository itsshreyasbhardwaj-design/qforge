# Portfolio index

What to show, in what order, to whom — and where every claim is backed.

This file is an index and a case study. It makes no claims of its own that are
not checkable in [claim-verification.md](claim-verification.md), and it does
not describe anyone's personal contribution beyond what
[technical-mastery.md](technical-mastery.md) states.

---

## 1. The five-minute version

If someone has five minutes, show this and nothing else:

1. **Open the studio**, load the Bell example, press **Step** four times. Watch
   the amplitudes change and the second measurement become certain.
2. **Open the Entanglement walkthrough** and go to step 3. Both Bloch vectors
   read `|r| = 0.0000`. Say why that is the definition of entanglement rather
   than a rounding artefact.
3. **Switch to the teleportation example**, press **To end**, open the Bloch
   panel: `bob` is pure with `z = 0.3090`. Then say the thing that makes it
   interesting — the measurement counts are _identical_ whether or not Bob
   applies his corrections, so counts cannot test this and the repository's
   test uses Bob's reduced density matrix instead.

That sequence shows a working language, a working simulator, a working
debugger, and one piece of genuine scientific care, in order.

[demo-script.md](demo-script.md) has the longer version with exact timings.

## 2. Reading order by audience

| Audience                             | Order                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler engineer                    | [architecture.md](architecture.md) → [compiler-design.md](compiler-design.md) → [classical-control-design.md](classical-control-design.md) → `packages/compiler/src/passes/` |
| Physicist                            | [quantum-math.md](quantum-math.md) → [simulator-design.md](simulator-design.md) → [validation-report.md](validation-report.md)                                               |
| Someone deciding whether to trust it | [limitations.md](limitations.md) → [claim-verification.md](claim-verification.md) → [independent-audit.md](independent-audit.md)                                             |
| Admissions or hiring reviewer        | [technical-report.md](technical-report.md) → [technical-mastery.md](technical-mastery.md) → this file's §3                                                                   |
| Someone learning quantum computing   | [learning-guide.md](learning-guide.md) → the studio's four walkthroughs                                                                                                      |

## 3. Engineering case study: the test that could not have failed

The best thing to talk about in this project is not a feature. It is a test
that was nearly written wrong.

### The task

Quantum teleportation moves an unknown qubit state from Alice to Bob using a
shared entangled pair and two classical bits. It is the smallest protocol that
genuinely needs classical feed-forward — the gates Bob applies depend on what
Alice measured — so it was chosen as the acceptance test for QForge's classical
control.

### The obvious test, and why it is worthless

The obvious thing to assert is the measurement distribution: run the circuit a
few thousand times and check the histogram.

That test passes on a completely broken implementation.

Alice's Bell measurement is unbiased: all four of her outcomes occur at about
25% regardless of what Bob does afterwards. Bob's corrections are applied
_after_ her measurement and do not change her statistics. Delete both `if`
statements from the teleportation example and the counts table is unchanged —
which can be checked by hand in the studio in about fifteen seconds.

So a histogram test would have been green, in CI, on a feature that did not
work. The failure mode is not a flaky test; it is a test that **cannot
distinguish the two cases it exists to distinguish**.

### The test that does work

What teleportation claims is about Bob's qubit, so that is what has to be
measured. The test traces out the other two qubits to obtain Bob's reduced
density matrix and asserts that it is the pure state Alice began with.

The example prepares the message qubit with `ry(2*pi/5)`, which gives
`<Z> = cos(2*pi/5) = 0.3090` — deliberately asymmetric. A missing correction
would leave Bob somewhere obviously different; a value like `|0>` or `|+>`
could be reached by accident, and `0.3090` cannot.

`tests/integration/teleportation.test.ts` asserts this for every branch, so
all four of Alice's outcomes are exercised rather than whichever one the seed
happened to produce.

### What this generalises to

The question "what would make this test fail?" is more useful than "does this
test pass?". A test whose answer to the first question is "nothing I care
about" is decoration.

The same question, asked of the project's benchmarks, caught a second instance:
the first measurement of studio responsiveness used the Long Tasks API, which
never fires in headless Chromium. It would have reported "0 long tasks" for a
page that was completely frozen. A deliberate control — block the main thread
for 400 ms and check that the measurement notices — caught it, and the
measurement was redone with timer-gap sampling.

Both episodes are in [development-journal.md](development-journal.md) with the
commits.

## 4. The other three things worth discussing

Shorter, but each has a real argument behind it.

**Optimisation preserves global phase.** Under the half-angle convention
`rx(2*pi) = -I`, which is invisible in isolation but _not_ invisible when the
qubit is entangled or the rotation is controlled. So QForge removes
`rx(4*pi)` and keeps `rx(2*pi)`. Qiskit independently agrees with both
decisions. See §4.2 of [validation-report.md](validation-report.md).

**Predication instead of nesting.** `if` blocks disappear in the IR; each
instruction carries its condition. Every pass written for straight-line code
keeps working, at the cost of repeating a condition. The subtlety is that
adjacency analysis then has to treat classical bits as resources too, or the
optimiser would cancel a pair across the measurement that writes the bit one of
them is predicated on. See [classical-control-design.md](classical-control-design.md).

**Validation found bugs in both directions.** Qiskit rejected QForge's
OpenQASM for single-bit predicates — a real conformance bug in QForge. The
NumPy oracle disagreed with QForge on an entangled `reset` — a real bug in the
oracle. Reporting the second one is the part that makes the first one
credible.

## 5. Questions a reviewer will ask

These are the questions, not the answers. Answers you can recite are not
answers you can defend, and
[author-learning-guide.md](author-learning-guide.md) exists for exactly this
reason: it lists where each answer is implemented so you can read the code and
form your own.

**On the project**

- How much of this did you write, and how much did the AI write?
- What would you have done differently if you started again?
- What is the weakest part of this codebase?
- Why build a language instead of using Qiskit?

**On the compiler**

- Walk me through what happens to `h q;` from text to amplitudes.
- Why a Pratt parser rather than precedence climbing or a generator?
- Your parser recovers from errors. What guarantees it terminates?
- What is in your IR, and what is deliberately not in it?

**On the simulator**

- Why is qubit 0 the least significant bit? What breaks if you flip it?
- Why is `cx` faster than `h` in your benchmarks?
- Why is `reset` not a projection?
- You sample 1,000,000 shots in 313 ms. What are you _not_ doing in that time?

**On correctness**

- Three of your four references were written by the same author as the code.
  Why should I believe any of them?
- Your test suite is 92.8% covered. What does that not tell me?
- What is the largest circuit you have actually validated, and what happens
  above it?
- Show me a bug this project's own tests found.

The last one has four answers in [claim-verification.md](claim-verification.md)
§7, which is the point of keeping that table.

## 6. Materials checklist

| Material                    | Where                                                               | State                       |
| --------------------------- | ------------------------------------------------------------------- | --------------------------- |
| One-page technical overview | [technical-brief.md](technical-brief.md)                            | done                        |
| Full technical report       | [technical-report.md](technical-report.md)                          | done                        |
| Architecture overview       | [architecture.md](architecture.md)                                  | done                        |
| Demonstration plan          | [demo-script.md](demo-script.md)                                    | done                        |
| Build-process evidence      | [development-journal.md](development-journal.md)                    | done, contemporaneous       |
| Engineering case study      | §3 above                                                            | done                        |
| Interview preparation       | §5 above, with [author-learning-guide.md](author-learning-guide.md) | done                        |
| Claim-verification sheet    | [claim-verification.md](claim-verification.md)                      | done                        |
| Contribution disclosure     | [technical-mastery.md](technical-mastery.md)                        | done                        |
| Screenshots                 | [screenshots/](screenshots)                                         | done                        |
| User-testing results        | [user-testing-protocol.md](user-testing-protocol.md)                | **protocol only — not run** |
| Public deployment           | —                                                                   | **not deployed**            |
