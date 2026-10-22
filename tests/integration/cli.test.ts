import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { BufferWriter, ExitCode, main } from '../../packages/cli/src/index.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const CLI_BIN = join(REPO_ROOT, 'packages/cli/dist/bin.js');

/** Run the CLI in-process, capturing output. */
async function run(argv: string[], cwd = REPO_ROOT) {
  const writer = new BufferWriter();
  const code = await main(argv, { writer, cwd });
  return { code, stdout: writer.stdout, stderr: writer.stderr };
}

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'qforge-cli-'));
});

describe('usage and help', () => {
  it('prints usage with no arguments and exits 2', async () => {
    const result = await run([]);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stdout).toContain('USAGE');
    expect(result.stdout).toContain('qforge <command>');
  });

  it('prints usage and exits 0 for --help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('COMMANDS');
  });

  it('prints the version', async () => {
    const result = await run(['--version']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('gives per-command help', async () => {
    for (const command of ['check', 'run', 'compile', 'inspect', 'format']) {
      const result = await run([command, '--help']);
      expect(result.code).toBe(ExitCode.Success);
      expect(result.stdout).toContain(`qforge ${command}`);
    }
  });

  it('rejects an unknown command with a suggestion', async () => {
    const result = await run(['ru', 'examples/bell.qf']);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain("Unknown command 'ru'");
    expect(result.stderr).toContain("Did you mean 'run'?");
  });

  it('rejects an unknown option rather than ignoring it', async () => {
    const result = await run(['run', 'examples/bell.qf', '--shotz', '10']);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain("Unknown option '--shotz'");
  });

  it('rejects a missing file argument', async () => {
    const result = await run(['check']);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain('needs a source file');
  });

  it('exits 3 when the file cannot be read', async () => {
    const result = await run(['check', 'does-not-exist.qf']);
    expect(result.code).toBe(ExitCode.RuntimeError);
    expect(result.stderr).toContain('Cannot read');
  });
});

describe('check', () => {
  it('reports a valid program', async () => {
    const result = await run(['check', 'examples/bell.qf']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('ok - 2 qubit(s), 2 classical bit(s), 4 operation(s)');
  });

  it('exits 1 and renders a caret diagnostic for a bad program', async () => {
    const file = join(scratch, 'bad.qf');
    await writeFile(file, 'qubit control;\nbit c;\n\ncx control, target;\n');
    const result = await run(['check', file]);
    expect(result.code).toBe(ExitCode.CompileError);
    expect(result.stderr).toContain('error QF202:');
    expect(result.stderr).toContain("Unknown qubit 'target'");
    expect(result.stderr).toContain('cx control, target;');
    expect(result.stderr).toContain('^^^^^^');
    expect(result.stderr).toContain('1 error in');
  });

  it('emits machine-readable diagnostics with --json', async () => {
    const file = join(scratch, 'bad2.qf');
    await writeFile(file, 'qubit q;\nh nope;\n');
    const result = await run(['check', file, '--json']);
    expect(result.code).toBe(ExitCode.CompileError);
    const payload = JSON.parse(result.stderr) as {
      diagnostics: Array<{ code: string; line: number; column: number }>;
    };
    expect(payload.diagnostics[0]!.code).toBe('QF202');
    expect(payload.diagnostics[0]!.line).toBe(2);
  });

  it('reports every error, not just the first', async () => {
    const file = join(scratch, 'many.qf');
    await writeFile(file, 'qubit a;\nh b;\ncx a, a;\nrx a;\n');
    const result = await run(['check', file, '--json']);
    const payload = JSON.parse(result.stderr) as { diagnostics: Array<{ code: string }> };
    const codes = payload.diagnostics.map((d) => d.code);
    expect(codes).toContain('QF202');
    expect(codes).toContain('QF208');
    expect(codes).toContain('QF205');
  });

  it('honours --max-qubits', async () => {
    const file = join(scratch, 'wide.qf');
    await writeFile(file, 'qubit[5] q;\n');
    expect((await run(['check', file])).code).toBe(ExitCode.Success);
    const limited = await run(['check', file, '--max-qubits', '4']);
    expect(limited.code).toBe(ExitCode.CompileError);
    expect(limited.stderr).toContain('QF301');
  });
});

describe('run', () => {
  it('simulates and prints a counts table', async () => {
    const result = await run(['run', 'examples/bell.qf', '--shots', '1000', '--seed', '42']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('shots 1000  seed 42');
    expect(result.stdout).toContain('state');
    expect(result.stdout).toMatch(/\b00\b/);
    expect(result.stdout).toMatch(/\b11\b/);
    expect(result.stdout).not.toMatch(/^01\s/m);
  });

  it('is byte-for-byte reproducible for a fixed seed', async () => {
    const argv = ['run', 'examples/ghz.qf', '--shots', '500', '--seed', '7'];
    const a = await run(argv);
    const b = await run(argv);
    expect(a.stdout).toBe(b.stdout);
  });

  it('produces different output for a different seed', async () => {
    const a = await run(['run', 'examples/bell.qf', '--shots', '500', '--seed', '1']);
    const b = await run(['run', 'examples/bell.qf', '--shots', '500', '--seed', '2']);
    expect(a.stdout).not.toBe(b.stdout);
  });

  it('reports the strategy it used', async () => {
    const terminal = await run(['run', 'examples/bell.qf', '--shots', '10', '--seed', '1']);
    expect(terminal.stdout).toContain('strategy terminal-sampling');
    const replay = await run([
      'run',
      'examples/mid-circuit-measure.qf',
      '--shots',
      '10',
      '--seed',
      '1',
    ]);
    expect(replay.stdout).toContain('strategy per-shot-replay');
    expect(replay.stdout).toContain('replayed once per shot');
  });

  it('prints the statevector with --state', async () => {
    const result = await run([
      'run',
      'examples/bell.qf',
      '--shots',
      '1',
      '--seed',
      '1',
      '--state',
    ]);
    expect(result.stdout).toContain('|00> : 0.7071 + 0.0000i');
    expect(result.stdout).toContain('|11> : 0.7071 + 0.0000i');
    expect(result.stdout).not.toContain('|01>');
  });

  it('prints a probability bar chart with --probabilities', async () => {
    const result = await run([
      'run',
      'examples/bell.qf',
      '--shots',
      '1',
      '--seed',
      '1',
      '--probabilities',
    ]);
    expect(result.stdout).toContain('|00>');
    expect(result.stdout).toContain('50.00%');
  });

  it('prints exact probabilities with --exact and no sampling', async () => {
    const result = await run(['run', 'examples/bell.qf', '--exact']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('exact measurement probabilities (no sampling)');
    expect(result.stdout).toContain('0.5000000000');
    expect(result.stdout).not.toContain('seed');
  });

  it('emits JSON with --json', async () => {
    const result = await run([
      'run',
      'examples/bell.qf',
      '--shots',
      '100',
      '--seed',
      '3',
      '--json',
    ]);
    const payload = JSON.parse(result.stdout) as {
      shots: number;
      seed: number;
      counts: Record<string, number>;
      strategy: string;
    };
    expect(payload.shots).toBe(100);
    expect(payload.seed).toBe(3);
    expect(payload.strategy).toBe('terminal-sampling');
    expect(Object.keys(payload.counts).sort()).toEqual(['00', '11']);
    expect(Object.values(payload.counts).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('includes the statevector in JSON when asked', async () => {
    const result = await run([
      'run',
      'examples/bell.qf',
      '--shots',
      '1',
      '--seed',
      '1',
      '--state',
      '--json',
    ]);
    const payload = JSON.parse(result.stdout) as {
      statevector: Array<{ re: number; im: number }>;
    };
    expect(payload.statevector).toHaveLength(4);
    expect(payload.statevector[0]!.re).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('shows the optimisation report with --optimize', async () => {
    const result = await run([
      'run',
      'examples/optimisable.qf',
      '--shots',
      '10',
      '--seed',
      '1',
      '--optimize',
    ]);
    expect(result.stdout).toContain('optimisation');
    expect(result.stdout).toContain('instructions 14 -> 6');
    expect(result.stdout).toContain('cancel-self-inverse');
  });

  it('gives the same distribution with and without --optimize', async () => {
    const plain = await run([
      'run',
      'examples/optimisable.qf',
      '--shots',
      '500',
      '--seed',
      '9',
      '--json',
    ]);
    const tuned = await run([
      'run',
      'examples/optimisable.qf',
      '--shots',
      '500',
      '--seed',
      '9',
      '--optimize',
      '--json',
    ]);
    const a = JSON.parse(plain.stdout) as { counts: Record<string, number> };
    const b = JSON.parse(tuned.stdout) as { counts: Record<string, number> };
    expect(a.counts).toEqual(b.counts);
  });

  it('rejects an invalid shot count', async () => {
    for (const shots of ['0', '-1', '1.5', '2000000', 'abc']) {
      const result = await run(['run', 'examples/bell.qf', '--shots', shots]);
      expect(result.code, `shots=${shots}`).toBe(ExitCode.UsageError);
      expect(result.stderr).toContain('--shots');
    }
  });

  it('rejects a flag that needs a value but got none', async () => {
    const result = await run(['run', 'examples/bell.qf', '--seed', '--json']);
    expect(result.code).toBe(ExitCode.UsageError);
  });

  it('exits 1 without simulating when the program does not compile', async () => {
    const file = join(scratch, 'broken.qf');
    await writeFile(file, 'qubit q;\nh nope;\n');
    const result = await run(['run', file, '--shots', '10']);
    expect(result.code).toBe(ExitCode.CompileError);
    expect(result.stdout).not.toContain('state');
  });
});

describe('compile', () => {
  it('writes OpenQASM 3 to stdout', async () => {
    const result = await run(['compile', 'examples/bell.qf']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('OPENQASM 3.0;');
    expect(result.stdout).toContain('include "stdgates.inc";');
    expect(result.stdout).toContain('cx alice, bob;');
    expect(result.stdout).toContain('resultA = measure alice;');
  });

  it('is deterministic', async () => {
    const a = await run(['compile', 'examples/ghz.qf']);
    const b = await run(['compile', 'examples/ghz.qf']);
    expect(a.stdout).toBe(b.stdout);
  });

  it('writes to a file with --output', async () => {
    const out = join(scratch, 'bell.qasm');
    const result = await run(['compile', 'examples/bell.qf', '--output', out]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('wrote');
    expect(await readFile(out, 'utf8')).toContain('OPENQASM 3.0;');
  });

  it('omits the header with --no-header', async () => {
    const result = await run(['compile', 'examples/bell.qf', '--no-header']);
    expect(result.stdout.startsWith('OPENQASM 3.0;')).toBe(true);
  });

  it('emits decimal angles with --no-pretty-angles', async () => {
    const pretty = await run(['compile', 'examples/rotations.qf']);
    expect(pretty.stdout).toContain('ry(pi/3)');
    const plain = await run(['compile', 'examples/rotations.qf', '--no-pretty-angles']);
    expect(plain.stdout).toContain('ry(1.0471975511965976)');
  });

  it('annotates source lines with --source-comments', async () => {
    const result = await run(['compile', 'examples/bell.qf', '--source-comments']);
    expect(result.stdout).toMatch(/h alice;\s+\/\/ line \d+/);
  });

  it('rejects an unknown target', async () => {
    const result = await run(['compile', 'examples/bell.qf', '--target', 'qir']);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain("Unknown target 'qir'");
    expect(result.stderr).toContain('openqasm3');
  });

  it('exits 3 when the output path is unwritable', async () => {
    const result = await run([
      'compile',
      'examples/bell.qf',
      '--output',
      '/nonexistent-dir-xyz/out.qasm',
    ]);
    expect(result.code).toBe(ExitCode.RuntimeError);
    expect(result.stderr).toContain('Cannot write');
  });
});

describe('inspect', () => {
  it('requires a stage to be chosen', async () => {
    const result = await run(['inspect', 'examples/bell.qf']);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain('needs a stage');
  });

  it('dumps the token stream', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--tokens']);
    expect(result.stdout).toContain('=== tokens');
    expect(result.stdout).toContain('qubit');
    expect(result.stdout).toContain('identifier');
    // Trivia is filtered out of the inspector view.
    expect(result.stdout).not.toContain('whitespace');
  });

  it('dumps the AST with source spans', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--ast']);
    expect(result.stdout).toContain('"kind": "Program"');
    expect(result.stdout).toContain('"kind": "GateApplication"');
    expect(result.stdout).toContain('"line":');
  });

  it('dumps the IR with global indices and source mapping', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--ir']);
    expect(result.stdout).toContain('; qforge ir');
    expect(result.stdout).toContain('cx %0, %1');
    expect(result.stdout).toContain('measure %0 -> $0');
    expect(result.stdout).toMatch(/; line \d+:\d+/);
  });

  it('dumps the optimised IR and the pass report', async () => {
    const result = await run(['inspect', 'examples/optimisable.qf', '--optimized']);
    expect(result.stdout).toContain('=== ir (optimised) ===');
    expect(result.stdout).toContain('=== optimisation report ===');
    expect(result.stdout).toContain('instructions 14 -> 6');
  });

  it('dumps generated OpenQASM', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--qasm']);
    expect(result.stdout).toContain('=== openqasm 3 ===');
    expect(result.stdout).toContain('OPENQASM 3.0;');
  });

  it('--all includes every stage', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--all']);
    for (const heading of [
      '=== tokens',
      '=== ast ===',
      '=== ir (unoptimised) ===',
      '=== ir (optimised) ===',
      '=== openqasm 3 ===',
    ]) {
      expect(result.stdout).toContain(heading);
    }
  });

  it('emits structured JSON', async () => {
    const result = await run(['inspect', 'examples/bell.qf', '--all', '--json']);
    const payload = JSON.parse(result.stdout) as {
      tokens: unknown[];
      ast: { kind: string };
      ir: { instructions: unknown[] };
      openqasm3: string;
    };
    expect(payload.tokens.length).toBeGreaterThan(10);
    expect(payload.ast.kind).toBe('Program');
    expect(payload.ir.instructions).toHaveLength(4);
    expect(payload.openqasm3).toContain('OPENQASM');
  });
});

describe('format', () => {
  it('prints the canonical form to stdout', async () => {
    const file = join(scratch, 'messy.qf');
    await writeFile(file, 'qubit    a;qubit b;h   a;cx a,b;');
    const result = await run(['format', file]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toBe('qubit a;\nqubit b;\nh a;\ncx a, b;\n');
  });

  it('rewrites in place with --write', async () => {
    const file = join(scratch, 'write.qf');
    await writeFile(file, 'qubit q;h q;');
    const result = await run(['format', file, '--write']);
    expect(result.code).toBe(ExitCode.Success);
    expect(await readFile(file, 'utf8')).toBe('qubit q;\nh q;\n');
    // A second run is a no-op.
    const again = await run(['format', file, '--write']);
    expect(again.stdout).toContain('already formatted');
  });

  it('--check exits 1 for unformatted input and 0 otherwise', async () => {
    const file = join(scratch, 'check.qf');
    await writeFile(file, 'qubit q;h q;');
    expect((await run(['format', file, '--check'])).code).toBe(ExitCode.CompileError);
    await writeFile(file, 'qubit q;\nh q;\n');
    expect((await run(['format', file, '--check'])).code).toBe(ExitCode.Success);
  });

  it('reports every example as already formatted', async () => {
    for (const file of ['bell.qf', 'ghz.qf', 'deutsch-jozsa.qf', 'optimisable.qf']) {
      const result = await run(['format', `examples/${file}`, '--check']);
      expect(result.code, `examples/${file}`).toBe(ExitCode.Success);
    }
  });

  it('refuses to format source with lexical errors', async () => {
    const file = join(scratch, 'lex.qf');
    await writeFile(file, 'qubit q$;');
    const result = await run(['format', file]);
    expect(result.code).toBe(ExitCode.CompileError);
    expect(result.stderr).toContain('refusing to format');
  });

  it('rejects --write with --check', async () => {
    const result = await run(['format', 'examples/bell.qf', '--write', '--check']);
    expect(result.code).toBe(ExitCode.UsageError);
  });
});

describe('the built binary works as a subprocess', () => {
  it('runs an example end to end with the real exit code', async () => {
    if (!existsSync(CLI_BIN)) {
      throw new Error(
        `${CLI_BIN} is missing. Run 'pnpm build' before 'pnpm test' to exercise the built CLI.`,
      );
    }
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_BIN, 'run', 'examples/bell.qf', '--shots', '256', '--seed', '5', '--json'],
      { cwd: REPO_ROOT },
    );
    const payload = JSON.parse(stdout) as { counts: Record<string, number> };
    expect(Object.keys(payload.counts).sort()).toEqual(['00', '11']);
  });

  it('exits 1 from the shell for a program with errors', async () => {
    const file = join(scratch, 'subproc-bad.qf');
    await writeFile(file, 'qubit q;\nh nope;\n');
    await expect(
      execFileAsync(process.execPath, [CLI_BIN, 'check', file], { cwd: REPO_ROOT }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('exits 0 from the shell for a valid program', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_BIN, 'check', 'examples/bell.qf'],
      { cwd: REPO_ROOT },
    );
    expect(stdout).toContain('ok -');
  });
});
