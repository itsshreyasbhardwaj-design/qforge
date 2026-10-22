# Demonstration script

A reproducible 90-120 second walkthrough. Every command is real; nothing is
staged. Run `pnpm build` first.

---

## Setup

```bash
git clone https://github.com/itsshreyasbhardwaj-design/qforge.git qforge && cd qforge
pnpm install
pnpm build
```

---

## 0:00-0:12 — The language

> "This is QForge. It's a small language for quantum circuits, with its own
> compiler and simulator — no quantum SDK underneath."

```bash
cat examples/bell.qf
```

Point at the eleven lines of actual code: two qubit declarations, two bit
declarations, a Hadamard, a controlled-NOT, two measurements.

---

## 0:12-0:25 — Compiling it

```bash
qforge check examples/bell.qf
```

> "It compiles. And when it doesn't —"

```bash
printf 'qubit control;\nbit c;\n\ncx control, target;\n' > /tmp/broken.qf
qforge check /tmp/broken.qf; echo "exit $?"
```

> "— you get a code, a caret under the exact token, and a suggested fix. Exit
> code 1, so this works in a pre-commit hook."

---

## 0:25-0:45 — Inside the compiler

```bash
qforge inspect examples/bell.qf --tokens | head -8
qforge inspect examples/bell.qf --ir
```

> "Tokens, then — skipping the AST for time — the intermediate representation.
> Notice the names are gone. `alice` is qubit `%0`. Registers, indexing and
> scoping have all been resolved away, and the angles are numbers. That's what
> makes the simulator and the code generator independent of the syntax."

---

## 0:45-1:00 — Optimisation that is provably safe

```bash
qforge inspect examples/optimisable.qf --optimized | tail -20
```

> "Fourteen instructions down to six, with a report naming every removal.
> The interesting one: `rz(4*pi)` is removed, `rz(2*pi)` is kept. A rotation by
> `2*pi` is minus the identity — same probabilities, different statevector.
> QForge's passes preserve the operator, not just the statistics, so the
> debugger shows identical amplitudes with optimisation on or off."

---

## 1:00-1:15 — Running it

```bash
qforge run examples/bell.qf --shots 1024 --seed 42
```

> "A thousand shots. Only `00` and `11` — never `01`, never `10`. That's
> entanglement. Fixed seed, so this is byte-for-byte reproducible."

```bash
qforge compile examples/bell.qf
```

> "And it exports valid OpenQASM 3, validated by round-tripping through an
> independently written parser."

---

## 1:15-1:50 — The debugger

```bash
pnpm dev     # then open http://localhost:3147/studio
```

In the studio, with `bell.qf` loaded:

1. **Press Step once.** > "After the Hadamard: `|00>` and `|01>`, amplitude
   0.7071 each. Not 0.5 — amplitude is the square root of probability."

2. **Press Step again.** > "After the CNOT: `|00>` and `|11>`. `|01>` is gone.
   The highlighted rows are exactly the amplitudes this gate changed."

3. **Press Step a third time.** > "The measurement. Three separate things: the
   exact probabilities before it, 50/50; the outcome that was actually sampled;
   and the collapsed state. Most tools blur those together."

4. **Press Step once more.** > "The second qubit now reads 100%. Measuring one
   half of a Bell pair determines the other."

5. **Press Step back twice.** > "Backwards works because the whole trace was
   recorded, not re-run — so the random branch you're looking at stays the one
   that happened."

6. **Click the Bloch tab.** > "And both qubits report Bloch length zero:
   maximally mixed. An entangled qubit has no state of its own, so the tool says
   so instead of drawing an arrow that would imply otherwise."

---

## 1:50-2:00 — Close

> "Everything you've seen runs locally — the studio is a static page with no
> backend, so a program you type never leaves your machine. The simulator is
> cross-checked three ways: an independent dense-matrix oracle, an independent
> OpenQASM parser, and NumPy."

```bash
pnpm verify:numpy | tail -3
```

---

## Notes for recording

- Use a dark terminal at 16pt or larger; the diagnostic caret output must be
  legible.
- Run every command once beforehand so nothing is cold.
- Do not speed up the debugger section — the amplitudes changing is the point.
- Do not fabricate anything: no invented benchmarks, users, or endorsements.
