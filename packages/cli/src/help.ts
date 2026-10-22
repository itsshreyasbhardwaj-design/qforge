export const VERSION = '0.1.0';

export const USAGE = `qforge ${VERSION} - compiler and simulator for the QForge quantum language

USAGE
  qforge <command> [options] <file.qf>

COMMANDS
  check <file>        Compile and report diagnostics. Exits 1 if the program has errors.
  run <file>          Compile and simulate, printing measurement counts.
  compile <file>      Generate code for a target backend.
  inspect <file>      Dump compiler internals: tokens, AST, IR, generated code.
  format <file>       Reformat source to the canonical style.

GLOBAL OPTIONS
  -h, --help          Show help. Works after a command too: qforge run --help
  -v, --version       Print the version and exit.

EXAMPLES
  qforge check examples/bell.qf
  qforge run examples/bell.qf --shots 1024 --seed 42
  qforge run examples/bell.qf --state
  qforge compile examples/bell.qf --target openqasm3
  qforge inspect examples/bell.qf --ir
  qforge format examples/bell.qf --check

EXIT CODES
  0  success
  1  the program had compilation errors
  2  the command line was invalid
  3  an I/O or runtime error occurred

Documentation: docs/language-spec.md and docs/cli.md`;

export const COMMAND_HELP: Readonly<Record<string, string>> = {
  check: `qforge check <file.qf>

Compile a program and report diagnostics. Prints nothing but a success line
when the program is valid.

OPTIONS
  --json             Emit diagnostics as JSON for editor integration.
  --max-qubits <n>   Override the qubit limit (default 20 for the CLI).

EXIT CODES
  0  no errors
  1  at least one error`,

  run: `qforge run <file.qf>

Compile a program and simulate it, printing measurement counts.

OPTIONS
  --shots <n>        Number of repetitions (default 1, max 1000000).
  --seed <n>         PRNG seed. Omit for a random seed, which is reported so
                     the run can be reproduced.
  --optimize         Run the optimisation passes before simulating.
  --state            Also print the final statevector amplitudes.
  --probabilities    Also print the basis-state probability distribution.
  --exact            Print exact measurement probabilities instead of sampling.
  --json             Emit results as JSON.
  --max-qubits <n>   Override the qubit limit.

NOTES
  With a fixed --seed, output is byte-for-byte reproducible.`,

  compile: `qforge compile <file.qf>

Generate code for a backend.

OPTIONS
  --target <name>    Backend. Currently only 'openqasm3' (the default).
  --optimize         Run the optimisation passes first.
  --output, -o <f>   Write to a file instead of standard output.
  --no-header        Omit the generated-by comment block.
  --no-pretty-angles Emit angles as exact decimals rather than pi forms.
  --source-comments  Annotate each line with its QForge source line.
  --max-qubits <n>   Override the qubit limit.

NOTE
  The generated OpenQASM 3 covers only the subset QForge can express. See
  docs/limitations.md.`,

  inspect: `qforge inspect <file.qf>

Dump the compiler's internal representations. Pick at least one stage.

OPTIONS
  --tokens           The token stream from the lexer.
  --ast              The abstract syntax tree.
  --ir               The quantum IR, as lowered from the AST.
  --optimized        The IR after the optimisation passes, with a pass report.
  --qasm             The generated OpenQASM 3.
  --all              Every stage.
  --json             Emit as JSON.
  --max-qubits <n>   Override the qubit limit.`,

  format: `qforge format <file.qf>

Reformat source to the canonical QForge style. Prints to standard output by
default. Comments are preserved.

OPTIONS
  --write            Rewrite the file in place.
  --check            Print nothing and exit 1 if the file is not formatted.

EXIT CODES
  0  formatted (or already formatted, with --check)
  1  not formatted (with --check only)`,
};
