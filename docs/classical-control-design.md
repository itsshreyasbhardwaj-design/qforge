# Classical control flow: design and semantics

QForge 0.2 adds a single, carefully scoped form of classical control: a quantum
operation can be guarded by the value of a classical bit written earlier in the
same run.

```qforge
measure alice -> m1;
if (m1 == 1) x bob;
```

This is the construct quantum teleportation needs, and it was the one
limitation of 0.1 that made a textbook protocol inexpressible.

---

## 1. What was added, and what was deliberately not

| Added                                            | Not added                                      |
| ------------------------------------------------ | ---------------------------------------------- |
| `if (condition) statement;`                      | `else`                                         |
| `if (condition) { statements }`                  | loops of any kind                              |
| `==` and `!=` against a constant                 | general boolean expressions, `&&`, `\|\|`, `!` |
| Scalar bit, indexed bit, whole-register targets  | classical arithmetic on measured values        |
| Conditional gates, `measure`, `reset`, `barrier` | nested conditionals                            |
|                                                  | declarations inside a conditional body         |

The principle: **every construct admitted has to have defined semantics in four
places at once** — the simulator, the optimiser's safety analysis, the OpenQASM
backend, and the step debugger. A feature that is easy to parse but ambiguous in
any of those is worse than its absence.

`else` was left out because it buys nothing a second `if` does not, and its
absence removes the dangling-else ambiguity from the grammar entirely. Nested
conditionals were left out because their natural meaning is a conjunction, and a
conjunction is better written by measuring into a wider register and comparing
that.

---

## 2. Grammar

```ebnf
if-stmt   ::= 'if' '(' condition ')' ( statement | block )
block     ::= '{' statement* '}'
condition ::= operand ( '==' | '!=' ) expression
```

New tokens: `if`, `{`, `}`, `==`, `!=`. The two-character operators are matched
before their one-character prefixes, so `c == 1` is one comparison.

Both body forms exist for a reason. The single-statement form is what a
correction actually looks like in a protocol (`if (m == 1) x bob;`); the block
form matches OpenQASM 3 and is what anyone wants for more than one operation.

---

## 3. Static semantics

A condition's target must be a **classical bit** — a scalar, a register
element, or a whole register (`QF218` otherwise).

Unlike a gate operand, a bare register name _is_ legal as a condition target.
That asymmetry is deliberate: `h q;` on a register is ambiguous about which
qubit it means, whereas `if (c == 3)` on a register has exactly one reading, and
it is the reading OpenQASM uses.

A whole-register comparison reads the register as an integer with **bit 0 as
the least significant**, matching the convention used everywhere else in QForge.
For `bit[2] c`, `c == 2` means `c[1] == 1` and `c[0] == 0`.

| Rule                                     | Diagnostic |
| ---------------------------------------- | ---------- |
| Target must be a classical bit           | `QF218`    |
| Value must fit in the target's bit width | `QF219`    |
| Conditionals may not nest                | `QF220`    |
| Body may not be empty                    | `QF221`    |
| Body may not contain declarations        | `QF216`    |
| Index must be in range                   | `QF211`    |
| Value must be a non-negative integer     | `QF215`    |

---

## 4. IR representation: predication, not nesting

This was the central design decision.

The obvious representation is a structured one — an `IfInstruction` holding a
condition and a nested list of instructions. It was rejected. QForge's IR is a
**flat list**, and that flatness is what the optimisation passes, the step
debugger and the circuit renderer are all built on. Introducing nesting would
have meant rewriting all three.

Instead, each instruction carries an optional predicate:

```ts
interface IrCondition {
  readonly clbits: readonly number[]; // least significant first
  readonly value: number;
  readonly negate: boolean; // true for !=
  readonly text: string; // display form, e.g. "c == 1"
}

interface IrInstruction {
  readonly opcode: Opcode;
  readonly qubits: readonly number[];
  readonly params: readonly number[];
  readonly clbit?: number;
  readonly loc: SourceSpan;
  readonly condition?: IrCondition; // <- the only addition
}
```

`if (c == 1) { x q; z q; }` lowers to two instructions, each carrying the same
predicate. This is exactly how predication works in real compilers for short
conditional regions, and here it meant classical control cost **no structural
change downstream at all**: the debugger, the renderer and the pass manager
needed no reworking, only predicate-awareness in the places where it matters.

---

## 5. Execution semantics

A predicate is evaluated against the classical register **at the moment the
instruction is reached**, using values written by measurements executed so far
in that shot.

- If it holds, the instruction executes exactly as it would unconditionally.
- If it does not, the instruction is skipped entirely: no state change, and for
  a conditional `measure`, no classical write either.

Because the predicate depends on sampled outcomes, **any circuit containing one
requires per-shot replay**. `requiresPerShotReplay` returns true as soon as it
sees a predicate, before examining anything else. Terminal sampling draws every
shot from one final statevector, which only works when the circuit's evolution
is the same in every shot — and the entire point of classical control is that it
is not.

The step debugger records `conditionHeld` on every predicated step, because
"nothing happened" and "the condition was false" look identical in the state,
and the difference is what a reader of a feed-forward circuit needs to see.

---

## 6. Optimiser safety

This is the sharpest edge in the whole compiler, and it is worth setting out in
full.

### 6.1 Rule one: predicates must match

Two instructions are only combined if they carry the _same_ predicate.
`h q` and `if (c == 1) h q` are different operators — at runtime one may fire
and the other not — so they never cancel. `sameCondition` compares the bit list,
the value and the negation flag.

### 6.2 Rule two: adjacency must track classical bits

Before predication, the adjacency scan tracked **qubits only**. Two instructions
were neighbours if nothing between them touched any of their qubits. That is
exactly wrong once behaviour depends on a classical bit.

The counterexample:

```qforge
if (c == 1) h q[1];
measure q[0] -> c;
if (c == 1) h q[1];
```

The measurement touches `q[0]`, not `q[1]`. A qubit-only scan therefore sees two
adjacent, identically predicated, self-inverse gates on `q[1]` and cancels them.
**That is unsound**: the measurement in between can change `c`, so at runtime
one gate may fire and the other not, and the pair is not the identity.

Measured against the pre-fix code, the optimiser silently reduced this circuit
from three gates to one:

```
  gates 3 -> 1
  result: h  measure
  UNSOUND: the two conditional gates were wrongly cancelled
```

The fix generalises the scan from qubits to **resources**, in one combined index
space: qubit `q` stays `q`, and classical bit `c` becomes `qubitCount + c`. An
instruction's resource set now includes

- the qubits it acts on,
- the classical bit a `measure` writes, and
- the classical bits its predicate reads.

With that, the measurement and the two conditional gates share resource
`qubitCount + c`, the sets no longer match, and the rewrite is correctly
refused. The existing adjacency algorithm needed no other change.

### 6.3 What is still optimised

Predication does not switch the optimiser off:

| Rewrite                                                           | Allowed?                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `if (c==1) h q; if (c==1) h q;` with nothing touching `c` between | yes — both fire or neither does                      |
| `if (c==1) rz(a) q; if (c==1) rz(b) q;`                           | yes — fused, predicate preserved                     |
| `if (c==1) rx(4*pi) q;`                                           | yes — an identity is an identity under any predicate |
| the unconditional part of a mixed circuit                         | yes, unchanged                                       |
| anything across a write to a predicate's bit                      | **no**                                               |
| anything between differently predicated instructions              | **no**                                               |

### 6.4 How this is verified

`tests/property/conditional-safety.test.ts` compares a circuit against its
optimised form **shot by shot with the same seed**. Because both consume
randomness in the same order for the instructions they share, identical seeds
must give identical states and identical classical registers — a much stronger
check than comparing aggregate distributions, which would hide a rewrite that
merely preserved the statistics.

Nine tests cover rewrites that must be refused, four cover rewrites that must
still happen, and one generative test runs 60 random predicated circuits built
from an alphabet that deliberately includes measurements writing bits that later
predicates read.

---

## 7. OpenQASM 3 export

A predicated instruction emits a single-statement `if` block:

```qasm
if (m1 == 1) { x bob; }
if (m0 == 1) { z bob; }
```

A predicate over a register's full width prints as the register name; a
predicate over one element prints as the indexed bit. Those are the only two
shapes the frontend can produce.

Round trips are validated through the independent OpenQASM reader in
`tests/conformance/qasm-parser.ts`, which was extended to split statements at
brace depth zero and to recurse into conditional bodies. The teleportation
circuit round-trips with its predicates intact.

**Not supported in export**: `else`, multi-statement bodies as a single `if`
(QForge predicates individual instructions, so each gets its own), and any
OpenQASM condition form other than equality against an integer literal.

---

## 8. Teleportation, and why it is the right test

```qforge
qubit msg; qubit alice; qubit bob;
bit m0; bit m1;

ry(2 * pi / 5) msg;      // the state to be teleported

h alice;                 // Alice and Bob share a Bell pair
cx alice, bob;

cx msg, alice;           // Alice's Bell measurement
h msg;
measure msg -> m0;
measure alice -> m1;

if (m1 == 1) x bob;      // the classical channel
if (m0 == 1) z bob;
```

Counting measurement outcomes proves nothing here: Alice's Bell measurement is
unbiased, so all four outcomes appear a quarter of the time **whether or not the
corrections are correct**. Deleting both `if` statements produces an identical
counts table.

So validation works on Bob's _state_. `tests/integration/teleportation.test.ts`
reconstructs Bob's reduced density matrix from the post-run statevector and
computes its fidelity with the intended pure state:

```
F = <psi| rho_bob |psi>
```

which is 1 exactly when `rho_bob` is `|psi><psi|`. Across nine input states
(including complex superpositions and states near the poles), 40 seeds each, and
with every one of the four Bell branches exercised, the worst fidelity observed
was within 1e-12 of 1.

Three controls make the test meaningful rather than self-confirming:

1. **Remove both corrections** → fidelity drops below 0.95.
2. **Remove either one** → fidelity drops below 0.95.
3. **Swap the correction order** → still 1, because X and Z here act under
   different bits and commute up to a global phase. Pinned down so a future
   edit does not "fix" a non-problem.

### Why this does not clone the state

The Bell measurement collapses `msg`. The test checks this directly: after the
protocol, `msg`'s Bloch vector lies exactly on the z axis (`|z| = 1` to 1e-12,
`x = y = 0`), and the sign agrees with the bit Alice recorded. Its fidelity with
the original state is `|alpha|^2` or `|beta|^2`, never 1 for a genuine
superposition. The state exists in one place before the protocol and one place
after.

### Why it is not faster-than-light signalling

Averaged over Alice's outcomes with no correction applied, Bob's Bloch vector is
the zero vector — his qubit is maximally mixed and carries no information. The
test measures this over 400 runs and requires the mean vector length below 0.12.
The two classical bits are what make the correction possible, and they travel no
faster than light.

---

## 9. Known limitations

- No `else`, no loops, no nested conditionals.
- Conditions compare against a compile-time constant only; there is no classical
  arithmetic and no comparison between two registers.
- A conditional body may not declare anything.
- Predication is per instruction, so a conditional block of _n_ operations
  becomes _n_ predicated instructions rather than one guarded region. This is
  invisible in behaviour but visible in the IR dump and in generated OpenQASM.
- The optimiser makes no attempt to reason _across_ predicates — it will not, for
  example, notice that `if (c == 1) x q;` followed by `if (c != 1) x q;` is an
  unconditional `x q`. Refusing a valid rewrite is safe; the reverse is not.
