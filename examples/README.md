# QForge examples

Every program here is executed by the test suite
(`tests/integration/examples.test.ts`), and the expectations written in each
file's `@expect` comments are checked against the actual compiler and simulator.
If an example's documented behaviour were wrong, CI would fail.

The expectation vocabulary:

| Directive | Meaning |
|---|---|
| `@expect qubits=N clbits=M gates=K` | Shape of the compiled circuit |
| `@expect-state \|00>=0.5` | Born-rule probability of a basis state, to 1e-9 |
| `@expect-outcome 11` | The classical register is this value in *every* shot |
| `@expect-support 00,11` | The set of classical register values that can occur |
| `@expect-frequency 00=0.5` | Long-run frequency of a register value, within 5 sigma |

Run one yourself:

```bash
qforge run examples/bell.qf --shots 1024 --seed 42 --state
```

| File | Concept |
|---|---|
| `declare.qf` | Qubit and bit declarations; the empty circuit |
| `pauli-x.qf` | A deterministic bit flip |
| `superposition.qf` | Hadamard, and the difference between amplitude and probability |
| `interference.qf` | H–Z–H: why amplitudes, not probabilities, are fundamental |
| `bell.qf` | Entanglement and correlated measurement |
| `ghz.qf` | Three-qubit entanglement |
| `rotations.qf` | Continuous rotations and angle expressions |
| `phase-kickback.qf` | Phase estimation's core trick |
| `deutsch-jozsa.qf` | A real algorithm with a provable one-query advantage |
| `deutsch-jozsa-constant.qf` | The same circuit with a constant oracle |
| `mid-circuit-measure.qf` | Measurement collapse and `reset` |
| `teleportation.qf` | Classical feed-forward; the circuit that needs `if` |
| `optimisable.qf` | A circuit the optimiser can shrink to nothing |
