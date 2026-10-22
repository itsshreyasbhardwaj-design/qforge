# Limitations

An honest list of what QForge does not do. Everything here is a deliberate
boundary or a known gap, not a bug — bugs go in the issue tracker.

## Language

| Not supported                                  | Why, and what it would take                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `else`, loops, nested conditionals             | Single-branch `if` is implemented (see [classical-control-design.md](classical-control-design.md)). `else` buys nothing a second `if` does not and its absence removes the dangling-else ambiguity; nesting's natural meaning is a conjunction, better written by comparing a wider register. |
| General boolean conditions (`&&`, `\|\|`, `!`) | A condition compares a bit or register against a compile-time constant. Anything richer needs a classical value model QForge does not have.                                                                                                                                                   |
| Loops                                          | Static unrolling would be easy; it was left out because without classical control flow it buys little, and with it the two interact.                                                                                                                                                          |
| User-defined gates and subroutines             | Needs nested scopes, a call-graph check for recursion, and inlining at lowering. The symbol table is a single flat map today.                                                                                                                                                                 |
| Arbitrary unitaries (`u`, `u3`, a general 2x2) | Easy to add; omitted to keep the gate table small enough to memorise.                                                                                                                                                                                                                         |
| Classical arithmetic on measured bits          | Requires a classical value model, which QForge does not have.                                                                                                                                                                                                                                 |
| Qubit aliasing, slicing, iteration             | `q[0:2]` and `for q in reg` are ergonomics, not semantics.                                                                                                                                                                                                                                    |
| `float`/`int`/`bool` classical types           | Only `const` doubles exist, and only at compile time.                                                                                                                                                                                                                                         |
| Modules, imports, multiple files               | One file is one program.                                                                                                                                                                                                                                                                      |

### Consequences

**Quantum teleportation is now expressible**, and `examples/teleportation.qf`
implements it with real classical feed-forward. It is validated on Bob's
_state_ rather than on measurement counts — Alice's Bell measurement is
unbiased, so the counts look identical whether or not the corrections are
correct. See [classical-control-design.md](classical-control-design.md) section 8.

**Deutsch-Jozsa, Bernstein-Vazirani and phase estimation's circuit core** are
all expressible, because they need only unitaries and terminal measurement. Two
Deutsch-Jozsa variants ship as examples.

## Simulator

| Limitation                        | Detail                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pure states only                  | No density matrices, no noise, no decoherence, no error channels.                                                       |
| Statevector only                  | No stabiliser or tensor-network backend, so a 30-qubit Clifford circuit that other tools handle easily is out of reach. |
| Exponential cost                  | `O(g * 2^n)` time, `O(2^n)` memory, with no special cases.                                                              |
| Single-threaded scalar JS         | No SIMD, no GPU, no Web Worker.                                                                                         |
| No mid-circuit classical feedback | Follows from the language.                                                                                              |
| No drift correction               | The norm is not renormalised between gates; drift is displayed instead of hidden.                                       |

### Qubit ceilings

| Context        | Limit | Statevector |
| -------------- | ----: | ----------: |
| Browser studio |    14 |     256 KiB |
| CLI            |    20 |      16 MiB |
| Hard ceiling   |    26 |       1 GiB |

The browser limit is conservative on purpose, but the reason changed in 0.2.
Simulation and the step trace now both run in a Web Worker, so a long run no
longer freezes the editor. What still binds is the debugger: it keeps one
statevector **per instruction**, so that stepping backwards reads the recorded
state rather than re-running and landing on a different sampled branch. At 14
qubits that is 256 KiB a step; at 20 it would be 16 MiB a step, which the
390-gate circuit in [benchmarks.md](benchmarks.md) turns into gigabytes.

Compilation still runs on the main thread. It is fast — about 27 ms for 10,000
gates — which is why the instruction cap (20,000) does the work there rather
than the qubit cap.

## OpenQASM 3 backend

QForge emits a **subset** of OpenQASM 3 and does not claim more.

Supported: `OPENQASM 3.0;`, `include "stdgates.inc";`, `qubit`/`bit`
declarations scalar and sized, the seventeen gates QForge exposes, `measure`
into a bit, `reset`, `barrier`.

Not supported: `gate` and `def` definitions, classical control flow, the
classical type system, `input`/`output`, timing and `delay`, `box`, pulse-level
`defcal`, `ctrl`/`inv`/`pow` modifiers, aliasing with `let`, arrays, `for` and
`while`, and OpenQASM 2 output.

There is also **no OpenQASM importer**. QForge compiles its own language only.
The reader in `tests/conformance/qasm-parser.ts` exists to validate the
generator and is not a supported entry point.

## Tooling

- No language server, so editor support outside the studio is syntax
  highlighting only.
- No debugger protocol (DAP); stepping is the studio's own UI.
- The CLI has no watch mode and no project files.
- No npm publication yet: package names are unverified and nothing is released.

## Verification

What the test suite establishes is listed in section 9 of
[quantum-math.md](quantum-math.md). What it does **not** establish:

- Correctness for all circuits. The cross-checks cover a few hundred random
  circuits up to 6 qubits plus the standard analytic cases.
- Numerical accuracy bounds for adversarial circuits. Measured drift is under
  1e-12 for 200-gate circuits; no proof is offered.
- Conformance to the OpenQASM 3 specification. Round trips are validated against
  an in-repo reader, not against a reference implementation — none is available
  offline, and the project will not add a paid or network dependency for it.
- Performance on anything but the machine in [benchmarks.md](benchmarks.md).

## Accessibility and browser support

- Tested on current Chromium via Playwright, desktop and a Pixel 7 profile.
  Firefox and Safari are not in CI.
- Keyboard navigation, focus-visible styling, ARIA tab semantics, text
  alternatives for the circuit SVG and non-colour-only status indicators are
  implemented and partly covered by tests.
- No full screen-reader audit has been performed, and no WCAG conformance level
  is claimed.
