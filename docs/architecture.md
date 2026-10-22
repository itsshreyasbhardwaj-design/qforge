# Architecture

## The pipeline

```
  source text (.qf)
        |
        |  tokenize()                     packages/language/src/lexer
        v
  Token[]  ──────────────────────────────────────────┐
        |                                            │
        |  parse()                        packages/language/src/parser
        v                                            │
  Program (typed AST, every node has a span)         │  studio
        |                                            │  compiler
        |  analyze()                      packages/language/src/semantic
        v                                            │  inspector
  SemanticModel                                      │  shows each
    symbol table, resolved global indices,           │  of these
    folded angles, diagnostics                       │
        |                                            │
        |  lower()                        packages/compiler/src/ir
        v                                            │
  IrModule (flat, syntax-free, source-mapped)  ──────┤
        |                                            │
        |  optimize()                     packages/compiler/src/passes
        v                                            │
  IrModule (optimised)  ─────────────────────────────┘
        |
        ├── emitOpenQasm3()               packages/compiler/src/backends
        |        -> OpenQASM 3 source
        |
        ├── executeCircuit()              packages/simulator
        |        -> counts, statevector, probabilities
        |
        └── traceCircuit()                packages/simulator
                 -> per-instruction states for the debugger
```

Every arrow is a function with no hidden state. Every stage can be tested on its
own, and the studio's compiler inspector renders each intermediate form, which
is how the project makes the compiler the subject rather than an implementation
detail.

## Packages

| Package             | Depends on | Responsibility                                                          |
| ------------------- | ---------- | ----------------------------------------------------------------------- |
| `@qforge/language`  | nothing    | Is this a well-formed QForge program, and what does each name refer to? |
| `@qforge/compiler`  | `language` | IR, verified optimisation passes, OpenQASM 3 generation                 |
| `@qforge/simulator` | `compiler` | Execute IR: complex arithmetic, gate kernels, measurement, traces       |
| `qforge` (CLI)      | all three  | `check`, `run`, `compile`, `inspect`, `format`                          |
| `@qforge/studio`    | all three  | Browser development environment                                         |

The dependency graph is a chain with no cycles. `language` contains no
numerical code; `simulator` contains no parsing. That separation is why the
compiler can be tested without a simulator and the simulator without a parser.

### Why the gate table lives in `language`

Arity and parameter count are _static_ properties the analyser checks, so the
gate table belongs in the frontend. The matrices live in `simulator`, where the
numerics are. The two are tied together by the mnemonic strings, which are also
the IR opcodes — one set of names, no translation table to drift out of sync.

### Why `simulator` depends on `compiler`

Only for the IR types. An alternative was a separate `@qforge/ir` package, which
would have let the simulator be used with no compiler at all. That felt like a
package per interface rather than per responsibility, so the IR stays with the
code that produces it. The decision is recorded in
[design-decisions.md](design-decisions.md).

## Data structures

### Token

```ts
{ kind, text, span: { start, end, line, column, endLine, endColumn }, value? }
```

Spans are half-open UTF-16 offsets plus 1-based line/column. The lexer is total:
concatenating every token's text reproduces the source exactly, which is both a
test and the reason the formatter can preserve comments.

### AST

A discriminated union over `kind`, every node carrying a `span`. Nodes are
`Program`, three declaration kinds, `GateApplication`, `MeasureStatement`,
`ResetStatement`, `BarrierStatement`, `OperandRef`, and five expression kinds.

### SemanticModel

```ts
{
  (symbols, operations, qubitCount, clbitCount, qubitLabels, clbitLabels, diagnostics, ok);
}
```

`operations` is the validated, name-resolved sequence: declarations have been
folded into the symbol table and the index space, angles are numbers, and every
operand is a global index. This is exactly what lowering consumes.

### IrModule

```ts
{
  qubitCount, clbitCount,
  qubitLabels, clbitLabels,       // for display only
  qubitRegisters, clbitRegisters, // so backends can keep the user's names
  instructions: [{ opcode, qubits, params, clbit?, loc }],
  metadata: { passes, notes }
}
```

Three properties matter:

1. **Syntax independence.** Qubits are integers. A backend never parses QForge.
2. **Flatness.** A linear list, which is what makes the passes and the step
   debugger simple enough to audit.
3. **Source mapping.** Every instruction keeps the span of the statement it came
   from, so a gate maps back to a line and a line maps forward to gates. That
   one field is what the studio's click-to-step and click-to-reveal are built
   on.

## Execution

```
IrModule
   |
   ├── requiresPerShotReplay() ?
   |        no  -> run once, sample `shots` basis states from |a_k|^2
   |        yes -> re-execute the circuit `shots` times with collapse
   |
   └── traceCircuit() -> record the state after every instruction
```

Tracing up front rather than re-running a prefix per step is what makes
backward stepping exact: a circuit with a measurement has a random branch, and
re-running could show a state that never occurred in the run the user is
looking at.

## The studio

A static Next.js export. There is no server component doing work, no API route
and no telemetry: the compiler and simulator are the same packages the CLI uses,
running in the browser. A program typed into the editor never leaves the machine.

```
Studio                     state: source, optimise, shots, seed, step index
  ├── Editor               Monaco, bundled locally, QForge Monarch grammar
  ├── DiagnosticsList      caret excerpts, click to reveal
  ├── CircuitDiagram       SVG from the IR, click a gate to step to it
  ├── ExecutionPanel       run / step / back / reset, shots, seed
  ├── DebuggerPanel        one row per instruction, measurement detail inline
  ├── Results              state, probabilities, counts, Bloch, stats
  └── CompilerInspector    tokens, AST, IR, pass report, OpenQASM
```

Compilation is debounced by 160 ms and runs on the main thread, where it costs
under 30 ms even for a 10,000-gate program. **Simulation runs in a Web Worker**,
because it does not: a million-shot replay is seconds of work, and on the main
thread it froze the editor for all of it.

```
Studio (main thread)                  simulation.worker.ts
  compile on keystroke  ----------->  run    { runId, module, shots, seed }
  render                <-----------  progress { runId, completed, total }
  drop stale responses  <-----------  run-result / trace-result / error
  cancel / timeout      ----------->  cancel { runId }
```

Three properties the worker had to provide beyond "run it elsewhere":

- **Staleness.** Every message carries a run id and the hook keeps one current.
  Edit a circuit mid-run and the older result is discarded rather than
  overwriting the newer one.
- **Cancellation.** A worker inside a synchronous loop cannot receive messages,
  so the shot loop yields every 2,000 shots. That is also what makes progress
  reporting possible at all.
- **Recovery.** A run past 30 s is asked to stop; if it does not, the worker is
  terminated and the next request builds a fresh one.

The qubit limit did **not** move because of the worker. It is set by memory and
by how long a user should wait, neither of which a worker changes. See
[benchmarks.md](benchmarks.md).

## Testing

| Layer       | Location                      | What it establishes                                                                        |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Unit        | `packages/*/src/**/*.test.ts` | Each stage in isolation                                                                    |
| Property    | `tests/property`              | Passes preserve the operator on random circuits                                            |
| Conformance | `tests/conformance`           | Kernels vs an independent dense oracle; OpenQASM round trips through an independent parser |
| Integration | `tests/integration`           | CLI behaviour and exit codes; every example's documented claims                            |
| Browser     | `tests/e2e`                   | The studio drives the real engine, on desktop and mobile                                   |
| External    | `scripts/numpy-reference.mjs` | Gate matrices and bit order vs NumPy                                                       |

The conformance layer is the load-bearing one. Testing a simulator against
itself proves nothing, so the suite contains two deliberately independent
reimplementations — a dense-matrix oracle and a minimal OpenQASM reader — plus
a third check outside the language entirely.
