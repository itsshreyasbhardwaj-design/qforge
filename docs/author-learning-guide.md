# Author learning guide

This project was built with AI assistance. That is normal practice and nothing
to hide — but it means owning the code requires deliberately being able to
explain and extend it without help.

This document is a self-check, not a transcript. The questions below are the
ones a reviewer would ask. Each lists where the answer is implemented, so you
can read the code and form your own explanation rather than memorise one.

**None of the answers are written out here on purpose.** An answer you can
recite is not the same as one you can defend, and a guide that supplied them
would quietly make that distinction disappear.

---

## How to use this

For each question: read the file, run the command, then explain it out loud
without looking. If you cannot, that is the part to study. Working through
[learning-guide.md](learning-guide.md) first will help.

---

## Compiler engineering

1. **What is the difference between a lexer and a parser?**
   Compare the output of `qforge inspect examples/bell.qf --tokens` and
   `--ast`. Read `packages/language/src/lexer/lexer.ts` and
   `packages/language/src/parser/parser.ts`.

2. **Why does the compiler need an AST at all?** Why not act directly on tokens?
   Hint: look at how `rx(pi / 3) q;` is represented and ask how you would know
   `/` binds tighter than `+` from a flat list.

3. **What is operator precedence, and how does a Pratt parser encode it?**
   Read `parseExpression` and the `BINARY_PRECEDENCE` table. Explain why
   `-2 ^ 2` is `-4` and `2 ^ 3 ^ 2` is `512`.

4. **What is error recovery, and what rule does QForge use?**
   Read `synchronize()`. Explain why the line-boundary rule exists, and why
   recovery is guaranteed to make progress.

5. **What does semantic analysis check that parsing cannot?**
   `rx() q;` parses cleanly but is rejected. Which stage rejects it, and why is
   that the right stage?

6. **What is a symbol table?** Read `semantic/symbols.ts`. What does QForge's
   scope model allow and forbid, and what would change if user-defined gates
   were added?

7. **What is an intermediate representation, and why not just walk the AST?**
   Compare `--ast` and `--ir` output. Name three things the IR has removed, and
   say what each one buys the simulator and the backend.

8. **What is a source map, and what does QForge use it for?**
   Find `loc` on `IrInstruction`. Trace it from the AST span to the studio's
   click-to-step.

9. **How does the optimiser know a rewrite is legal?**
   Read `passes/adjacency.ts`. State the adjacency argument in your own words.

10. **Why is `rx(2*pi)` not removed when `rx(4*pi)` is?**
    This is the one most likely to be asked. Read `passes/numeric.ts` and
    section 3.1 of [quantum-math.md](quantum-math.md).

11. **How do you _prove_ an optimisation pass is correct?**
    Read `tests/property/pass-equivalence.test.ts`. Why does it compare
    statevectors rather than probabilities, and why does it assert that the
    passes removed something?

12. **Why is the OpenQASM backend tested with a second parser instead of golden
    files?** Read the comment at the top of `tests/conformance/qasm-parser.ts`.

13. **Why does the formatter work on tokens rather than the AST?**

---

## Quantum computing

14. **How is a quantum state represented in memory, and why do `n` qubits need
    `2^n` amplitudes?** Read `Statevector`.

15. **What is the difference between an amplitude and a probability?**
    Why is the amplitude of an equal superposition `0.7071` and not `0.5`?

16. **State QForge's bit-order convention and why a Bell state cannot test it.**
    Which tests do?

17. **How does applying a single-qubit gate to an `n`-qubit state work?**
    Explain the pairing in `applyMatrix` — why do those two amplitudes form the
    qubit's `|0>` and `|1>` components?

18. **Why is `cx` implemented as a swap rather than a matrix multiply?**
    What do the benchmarks show about the two?

19. **What happens during a measurement?** Name the five things
    [quantum-math.md](quantum-math.md) section 5 keeps distinct, and say why
    conflating any two would be misleading.

20. **Why is `reset` not just "zero the |1> amplitudes"?**
    What does the Bell-pair reset test demonstrate?

21. **What is global phase, why is it unobservable, and why does QForge keep
    it anyway?**

22. **When can every shot be sampled from one final statevector, and when must
    the circuit be replayed?** Why is sampling exact rather than approximate?

23. **What is entanglement, operationally?** Why does the studio report both
    Bell qubits as Bloch length 0, and why would drawing a unit arrow be wrong?

24. **Why is `rx(pi)` not equal to `X`?**

25. **Explain Deutsch-Jozsa.** Where does the speed-up come from, and why does
    the balanced oracle give `11` while the constant one gives `00`?

---

## Software engineering

26. **Why is the project split into four packages, and what is the dependency
    direction?** What would break if the simulator imported the parser?

27. **Why are diagnostics returned as data rather than thrown?**

28. **What makes the test suite's evidence meaningful rather than circular?**
    Name the three independent references and what each rules out.

29. **Why does the studio have no backend, and what does that cost?**

30. **How is reproducibility guaranteed?** What is the role of the seed, and
    why is `Math.random()` not used?

---

## Things to be able to do, not just explain

- **Add a gate.** Add `cy` (controlled-Y) end to end: gate table, matrix,
  kernel or controlled path, OpenQASM mapping, tests. About an hour if the
  architecture is understood; impossible if it is not.
- **Add a diagnostic.** Reject a `measure` whose destination bit was already
  written by an earlier measurement, as a warning. New code, spec entry, test.
- **Add a pass.** `h z h -> x` is a valid rewrite. Implement it, justify it, and
  make the property test pass.
- **Find a planted bug.** Swap the operands in `applyCx` and run the suite.
  Which tests fail? Now swap them in the dense oracle _as well_ and see which
  tests still fail. That difference is what independent references buy.
- **Explain any benchmark number.** Why does Hadamard throughput flatten around
  400 million amplitudes per second?

---

## Honest attribution

When presenting this project, the accurate statement is something like:

> I designed and built QForge with AI assistance. I chose the conventions and
> the architecture, and I can explain and extend every part of it. The
> correctness arguments — particularly the bit-order convention, the global
> phase rule in the optimiser, and the three independent cross-checks — are the
> parts I would most want to walk through.

Claiming to have written every line unaided would be false and is also the
easiest thing to catch: a reviewer only has to ask question 10.
