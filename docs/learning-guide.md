# Learning guide

A path through QForge for someone who wants to understand quantum circuits, or
compilers, or both. Every step is something you can run.

---

## Part 1 — Quantum computing from scratch

### 1. A qubit is not a random bit

```bash
qforge run examples/pauli-x.qf --shots 100 --seed 1
```

`x` flips `|0>` to `|1>`. The outcome is 1 in all 100 shots. Nothing
probabilistic has happened: a quantum gate on a basis state can be completely
deterministic.

### 2. Superposition, and the difference between amplitude and probability

```bash
qforge run examples/superposition.qf --shots 1000 --seed 1 --state
```

`h` produces amplitudes of `0.7071`, not `0.5`. Probability is the _square_ of
the amplitude's modulus, so `0.7071^2 = 0.5`. Amplitudes can be negative or
complex; probabilities cannot. That is not a technicality — it is the whole
difference between a qubit and a coin, as the next example shows.

### 3. Interference: why amplitudes are the real object

```bash
qforge run examples/interference.qf --shots 1000 --seed 1
```

H, then Z, then H. After the first H the qubit is 50/50. If it were "secretly
0 or 1, we just don't know which", the second H would leave it 50/50. Instead
the result is **deterministically 1**.

Z flips the sign of the `|1>` amplitude. The second H then has the two paths
cancel on `|0>` and reinforce on `|1>`. A classical coin cannot do this, because
probabilities cannot be negative.

Step it in the studio and watch the amplitude of `|1>` go from `+0.7071` to
`-0.7071` to `0`.

### 4. Entanglement

```bash
qforge run examples/bell.qf --shots 1000 --seed 42
```

Only `00` and `11` appear. Never `01`, never `10`. The two qubits do not have
individual states — open the Bloch tab in the studio and both show length 0,
maximally mixed. All the information is in the correlation.

Then `examples/ghz.qf` extends it to three.

### 5. Measurement and collapse

Open `examples/bell.qf` in the studio and step through it. At the first
`measure`, the debugger shows three different things:

- `P(0) = 50.00%, P(1) = 50.00%` — properties of the state
- `sampled: 1` — what happened this shot
- the state afterwards, collapsed to a single basis state

Then step to the second `measure`: `P(1) = 100%`. Measuring one qubit of a Bell
pair determines the other. Change the seed and run again — the pair of outcomes
changes, but they always agree.

### 6. Rotations, and the factor of two

```bash
qforge run examples/rotations.qf --shots 2000 --seed 1 --exact
```

`ry(pi/3)` gives exactly 25% probability of outcome 1, because the amplitude is
`sin(theta/2) = sin(pi/6) = 1/2`. The half-angle is why a qubit needs a full
`4*pi` to return to itself: a `2*pi` rotation gives `-I`, not `I`.

### 7. Phase kickback

```bash
qforge run examples/phase-kickback.qf --shots 100 --seed 1
```

A controlled gate whose target is an eigenstate leaves the target alone and
writes the eigenvalue onto the _control_ as a phase. This is the trick behind
most quantum algorithms.

### 8. A real algorithm

```bash
qforge run examples/deutsch-jozsa.qf --shots 100 --seed 1
qforge run examples/deutsch-jozsa-constant.qf --shots 100 --seed 1
```

One query decides whether a function is constant or balanced, where classically
you might need three. The first reads `11` every time, the second `00`. Every
branch is computed, and interference cancels the wrong answers.

---

## Part 2 — How a compiler works

Use one program throughout:

```bash
cat examples/bell.qf
```

### 1. Lexing

```bash
qforge inspect examples/bell.qf --tokens
```

Text becomes a flat list of tokens, each with a kind, the exact source text and
a position. `qubit` is a keyword, `alice` an identifier, `;` punctuation. No
structure yet.

### 2. Parsing

```bash
qforge inspect examples/bell.qf --ast
```

Tokens become a tree. `h alice;` is a `GateApplication` with a gate name and one
operand. The nesting encodes precedence — look at the `AST` tab in the studio
with `examples/rotations.qf` loaded to see `pi / 3` as a `BinaryExpr`.

Every node carries a span. That is what lets the studio jump from a gate in the
diagram to the line that produced it.

### 3. Semantic analysis

```bash
qforge check examples/bell.qf
```

Parsing says the program is _shaped_ right. Analysis asks whether it _means_
anything: is `alice` declared, is `cx` given two qubits, are they distinct?

Try breaking it and watch the error quality:

```bash
printf 'qubit control;\nbit c;\n\ncx control, target;\n' > /tmp/broken.qf
qforge check /tmp/broken.qf
```

### 4. Intermediate representation

```bash
qforge inspect examples/bell.qf --ir
```

```
h %0
cx %0, %1
measure %0 -> $0
```

Names are gone. `alice` is qubit `%0`. Registers, indexing and scoping have been
resolved away, and angles are plain numbers. This is the form the simulator and
the code generator both consume — neither needs to know anything about QForge
syntax.

### 5. Optimisation

```bash
qforge inspect examples/optimisable.qf --ir
qforge inspect examples/optimisable.qf --optimized
```

14 instructions become 6, and the report names every removal. Notice two things:

- `rz(4*pi)` is removed but `rz(2*pi)` is kept, because a rotation by `2*pi` is
  `-I`, not `I`;
- the two `x` gates around the `barrier` are kept, because a barrier is a fence.

### 6. Code generation

```bash
qforge compile examples/bell.qf
```

The IR becomes OpenQASM 3 — a different language, same circuit. A second backend
would start from the same IR.

---

## Part 3 — Things to try

1. **Break the Bell state.** Remove the `cx`. The counts go from `{00, 11}` to
   all four outcomes. Entanglement was doing that.

2. **Find the other Bell states.** Add `x alice;` before the `h`, or `z alice;`
   after the `cx`. Which change the counts and which only change the
   statevector? (`--state` shows both.)

3. **Build a biased coin.** Replace `h q;` with `ry(theta) q;` and solve for the
   `theta` that gives a 30% chance of 1. Check with `--exact`.

4. **Watch a phase do nothing, then something.** `x q; p(1.0) q; measure q -> c;`
   — the phase changes the amplitude and no probability. Now put an `h` on each
   side of the `p`. Why does it matter now?

5. **Make the optimiser work for its living.** Write a circuit you believe is
   the identity and see whether `--optimize` agrees. If it does not, the
   justification in the Passes tab explains the rule it is applying.

6. **Confirm measurement is repeatable.** Measure the same qubit into two bits.
   Why are `01` and `10` never produced?

7. **Watch reset erase a correlation.** `examples/mid-circuit-measure.qf`
   produces all four outcomes. Delete the `reset` and the two bits always agree.

---

## Where to read next

| Document                                   | Covers                                       |
| ------------------------------------------ | -------------------------------------------- |
| [language-spec.md](language-spec.md)       | Full grammar, types, every diagnostic code   |
| [quantum-math.md](quantum-math.md)         | Conventions, matrices, measurement, accuracy |
| [compiler-design.md](compiler-design.md)   | Parsing strategy, IR, passes, backend        |
| [simulator-design.md](simulator-design.md) | Kernels, sampling, tracing, RNG              |
| [design-decisions.md](design-decisions.md) | Why each choice was made                     |
| [limitations.md](limitations.md)           | What QForge does not do                      |
