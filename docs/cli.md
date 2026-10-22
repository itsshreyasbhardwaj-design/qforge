# CLI reference

```bash
qforge <command> [options] <file.qf>
```

QForge works entirely without the browser studio. The CLI, the studio and the
test suite all use the same compiler and simulator packages.

## Exit codes

| Code | Meaning                                                        |
| ---: | -------------------------------------------------------------- |
|    0 | Success                                                        |
|    1 | The program was read and processed, but had compilation errors |
|    2 | The command line was invalid                                   |
|    3 | An I/O or runtime failure                                      |

The 1 vs 2 distinction is deliberate: a program that fails to compile is a
_result_, while a bad command line means nothing was attempted. Conflating them
would make `qforge check` useless in a pre-commit hook.

## `qforge check`

Compile and report diagnostics.

```bash
qforge check examples/bell.qf
# examples/bell.qf: ok - 2 qubit(s), 2 classical bit(s), 4 operation(s)
```

| Option             | Effect                                          |
| ------------------ | ----------------------------------------------- |
| `--json`           | Emit diagnostics as JSON for editor integration |
| `--max-qubits <n>` | Override the qubit limit (default 20)           |

Diagnostics go to stderr with a caret excerpt; `--json` emits a structured
array with codes, positions and hints.

## `qforge run`

Compile and simulate.

```bash
qforge run examples/bell.qf --shots 1024 --seed 42
```

| Option             | Effect                                                 |
| ------------------ | ------------------------------------------------------ |
| `--shots <n>`      | Repetitions, 1 to 1,000,000 (default 1)                |
| `--seed <n>`       | PRNG seed; omit for a random one, which is reported    |
| `--optimize`       | Run the optimisation passes first and print the report |
| `--state`          | Also print the final statevector                       |
| `--probabilities`  | Also print a basis-state probability chart             |
| `--exact`          | Print exact measurement probabilities with no sampling |
| `--json`           | Emit results as JSON                                   |
| `--max-qubits <n>` | Override the qubit limit                               |

With a fixed `--seed`, output is byte-for-byte reproducible. The run reports
which sampling strategy was used and why.

## `qforge compile`

Generate code for a backend.

```bash
qforge compile examples/bell.qf
qforge compile examples/bell.qf --optimize -o bell.qasm
```

| Option                | Effect                                            |
| --------------------- | ------------------------------------------------- |
| `--target <name>`     | Backend; currently only `openqasm3` (the default) |
| `--optimize`          | Run the optimisation passes first                 |
| `-o, --output <file>` | Write to a file instead of stdout                 |
| `--no-header`         | Omit the generated-by comment block               |
| `--no-pretty-angles`  | Emit exact decimals rather than `pi/2` forms      |
| `--source-comments`   | Annotate each line with its QForge source line    |

Output is deterministic. See [limitations.md](limitations.md) for the supported
OpenQASM subset.

## `qforge inspect`

Dump compiler internals. At least one stage must be selected.

```bash
qforge inspect examples/bell.qf --ir
qforge inspect examples/optimisable.qf --optimized
qforge inspect examples/bell.qf --all --json
```

| Option        | Stage                                     |
| ------------- | ----------------------------------------- |
| `--tokens`    | Token stream                              |
| `--ast`       | Abstract syntax tree                      |
| `--ir`        | Quantum IR as lowered                     |
| `--optimized` | IR after the passes, plus the pass report |
| `--qasm`      | Generated OpenQASM 3                      |
| `--all`       | Every stage                               |
| `--json`      | Emit as JSON                              |

## `qforge format`

Reformat to the canonical style. Comments are preserved.

```bash
qforge format messy.qf              # print to stdout
qforge format messy.qf --write      # rewrite in place
qforge format examples/*.qf --check # exit 1 if not formatted
```

`--check` exits 1 when the file is not formatted, which makes it usable in CI.
The formatter refuses to touch source with lexical errors.

## Scripting

```bash
# Fail a build on any uncompilable program.
for f in src/*.qf; do qforge check "$f" || exit 1; done

# Extract counts as JSON.
qforge run circuit.qf --shots 10000 --seed 1 --json | jq '.counts'

# Exact probabilities, no sampling noise.
qforge run circuit.qf --exact --json | jq '.probabilities'

# Check formatting in CI.
qforge format circuit.qf --check
```
