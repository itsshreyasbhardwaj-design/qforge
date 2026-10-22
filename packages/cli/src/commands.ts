import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CLI_LIMITS,
  HARD_MAX_QUBITS,
  checkSource,
  formatSource,
  hasErrors,
  isTrivia,
  type ResourceLimits,
} from '@qforge/language';
import { compile, emitOpenQasm3, formatOptimizationReport, printIr } from '@qforge/compiler';
import { exactRegisterDistribution, executeCircuit, MAX_SHOTS_NOTE } from './shots.js';
import {
  boolFlag,
  intFlag,
  rejectUnknownFlags,
  stringFlag,
  UsageError,
  type ParsedArgs,
} from './args.js';
import { ExitCode } from './exit-codes.js';
import {
  formatCircuitStats,
  formatCounts,
  formatProbabilities,
  formatProbabilityTable,
  formatStatevector,
  reportDiagnostics,
  type Writer,
} from './output.js';
import { COMMAND_HELP } from './help.js';

export interface CommandContext {
  readonly writer: Writer;
  readonly cwd: string;
}

/** Read the single required source file argument. */
async function readSource(
  args: ParsedArgs,
  context: CommandContext,
  command: string,
): Promise<{ path: string; display: string; source: string }> {
  const [file] = args.positionals;
  if (!file) {
    throw new UsageError(
      `'qforge ${command}' needs a source file. Try: qforge ${command} program.qf`,
    );
  }
  if (args.positionals.length > 1) {
    throw new UsageError(
      `'qforge ${command}' takes one file, got ${args.positionals.length}: ${args.positionals.join(', ')}`,
    );
  }
  const path = resolve(context.cwd, file);
  try {
    return { path, display: file, source: await readFile(path, 'utf8') };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failure = new Error(`Cannot read '${file}': ${reason}`);
    (failure as { exitCode?: number }).exitCode = ExitCode.RuntimeError;
    throw failure;
  }
}

/** Resource limits, with `--max-qubits` applied. */
function limitsFrom(args: ParsedArgs): ResourceLimits {
  const maxQubits = intFlag(args, 'max-qubits', CLI_LIMITS.maxQubits, {
    min: 1,
    max: HARD_MAX_QUBITS,
  });
  return { ...CLI_LIMITS, maxQubits };
}

// ---------------------------------------------------------------- check

export async function commandCheck(
  args: ParsedArgs,
  context: CommandContext,
): Promise<ExitCode> {
  rejectUnknownFlags(args, ['json', 'max-qubits']);
  const json = boolFlag(args, 'json');
  const { display, source } = await readSource(args, context, 'check');

  const result = checkSource(source, { limits: limitsFrom(args) });
  reportDiagnostics(context.writer, result.diagnostics, source, display, json);

  if (hasErrors(result.diagnostics)) return ExitCode.CompileError;

  if (json) {
    context.writer.out(
      `${JSON.stringify(
        {
          file: display,
          ok: true,
          qubits: result.semantics.qubitCount,
          classicalBits: result.semantics.clbitCount,
          operations: result.semantics.operations.length,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.writer.out(
      `${display}: ok - ${result.semantics.qubitCount} qubit(s), ${result.semantics.clbitCount} classical bit(s), ${result.semantics.operations.length} operation(s)\n`,
    );
  }
  return ExitCode.Success;
}

// ---------------------------------------------------------------- run

export async function commandRun(args: ParsedArgs, context: CommandContext): Promise<ExitCode> {
  rejectUnknownFlags(args, [
    'shots',
    'seed',
    'optimize',
    'state',
    'probabilities',
    'exact',
    'json',
    'max-qubits',
  ]);
  const json = boolFlag(args, 'json');
  const shots = intFlag(args, 'shots', 1, { min: 1, max: 1_000_000 });
  const seedFlag = args.flags.has('seed')
    ? intFlag(args, 'seed', 0, { min: 0, max: 0xffffffff })
    : undefined;
  const optimizeFlag = boolFlag(args, 'optimize');
  const showState = boolFlag(args, 'state');
  const showProbabilities = boolFlag(args, 'probabilities');
  const exact = boolFlag(args, 'exact');

  const { display, source } = await readSource(args, context, 'run');
  const compiled = compile(source, { optimize: optimizeFlag, limits: limitsFrom(args) });
  reportDiagnostics(context.writer, compiled.diagnostics, source, display, json);
  if (!compiled.ok || !compiled.module) return ExitCode.CompileError;

  const module = compiled.module;

  if (exact) {
    const distribution = exactRegisterDistribution(module);
    if (json) {
      context.writer.out(
        `${JSON.stringify(
          { file: display, exact: true, probabilities: Object.fromEntries(distribution) },
          null,
          2,
        )}\n`,
      );
    } else {
      context.writer.out(`${formatCircuitStats(module)}\n\n`);
      context.writer.out(`exact measurement probabilities (no sampling)\n`);
      context.writer.out(`${formatProbabilityTable(distribution)}\n`);
    }
    return ExitCode.Success;
  }

  const result = executeCircuit(module, {
    shots,
    ...(seedFlag !== undefined ? { seed: seedFlag } : {}),
  });

  if (json) {
    context.writer.out(
      `${JSON.stringify(
        {
          file: display,
          shots: result.shots,
          seed: result.seed,
          strategy: result.strategy,
          qubits: module.qubitCount,
          classicalBits: module.clbitCount,
          counts: Object.fromEntries(result.counts),
          ...(showProbabilities ? { probabilities: Array.from(result.probabilities) } : {}),
          ...(showState
            ? {
                statevector: result.finalState
                  .amplitudes()
                  .map((a) => ({ re: a.re, im: a.im })),
              }
            : {}),
          elapsedMs: Number(result.elapsedMs.toFixed(3)),
        },
        null,
        2,
      )}\n`,
    );
    return ExitCode.Success;
  }

  context.writer.out(`${formatCircuitStats(module)}\n`);
  if (compiled.report && compiled.report.runs.length > 0) {
    context.writer.out(`\noptimisation\n${formatOptimizationReport(compiled.report)}\n`);
  }
  context.writer.out(
    `\nshots ${result.shots}  seed ${result.seed}  strategy ${result.strategy}\n`,
  );
  if (shots >= 1) context.writer.out(`${MAX_SHOTS_NOTE(result.strategy)}\n`);
  context.writer.out(`\n${formatCounts(result.counts, result.shots)}\n`);

  if (showProbabilities) {
    context.writer.out(
      `\nbasis-state probabilities (pre-measurement)\n${formatProbabilities(result.finalState, result.probabilities)}\n`,
    );
  }
  if (showState) {
    context.writer.out(`\nstatevector\n${formatStatevector(result.finalState)}\n`);
  }
  return ExitCode.Success;
}

// ---------------------------------------------------------------- compile

const TARGETS = ['openqasm3'] as const;

export async function commandCompile(
  args: ParsedArgs,
  context: CommandContext,
): Promise<ExitCode> {
  rejectUnknownFlags(args, [
    'target',
    'optimize',
    'output',
    'header',
    'pretty-angles',
    'source-comments',
    'json',
    'max-qubits',
  ]);
  const target = stringFlag(args, 'target') ?? 'openqasm3';
  if (!TARGETS.includes(target as (typeof TARGETS)[number])) {
    throw new UsageError(`Unknown target '${target}'. Supported: ${TARGETS.join(', ')}`);
  }
  const json = boolFlag(args, 'json');
  const output = stringFlag(args, 'output');

  const { display, source } = await readSource(args, context, 'compile');
  const compiled = compile(source, {
    optimize: boolFlag(args, 'optimize'),
    limits: limitsFrom(args),
  });
  reportDiagnostics(context.writer, compiled.diagnostics, source, display, json);
  if (!compiled.ok || !compiled.module) return ExitCode.CompileError;

  const emitted = emitOpenQasm3(compiled.module, {
    header: boolFlag(args, 'header', true),
    prettyAngles: boolFlag(args, 'pretty-angles', true),
    sourceComments: boolFlag(args, 'source-comments'),
  });

  if (output) {
    const path = resolve(context.cwd, output);
    try {
      await writeFile(path, emitted.code, 'utf8');
    } catch (error) {
      const failure = new Error(
        `Cannot write '${output}': ${error instanceof Error ? error.message : String(error)}`,
      );
      (failure as { exitCode?: number }).exitCode = ExitCode.RuntimeError;
      throw failure;
    }
    context.writer.out(`wrote ${output} (${target})\n`);
    return ExitCode.Success;
  }

  if (json) {
    context.writer.out(
      `${JSON.stringify(
        {
          file: display,
          target,
          code: emitted.code,
          renames: Object.fromEntries(emitted.renames),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.writer.out(emitted.code);
  }
  return ExitCode.Success;
}

// ---------------------------------------------------------------- inspect

export async function commandInspect(
  args: ParsedArgs,
  context: CommandContext,
): Promise<ExitCode> {
  rejectUnknownFlags(args, [
    'tokens',
    'ast',
    'ir',
    'optimized',
    'qasm',
    'all',
    'json',
    'max-qubits',
  ]);
  const all = boolFlag(args, 'all');
  const wantTokens = all || boolFlag(args, 'tokens');
  const wantAst = all || boolFlag(args, 'ast');
  const wantIr = all || boolFlag(args, 'ir');
  const wantOptimized = all || boolFlag(args, 'optimized');
  const wantQasm = all || boolFlag(args, 'qasm');
  const json = boolFlag(args, 'json');

  if (!wantTokens && !wantAst && !wantIr && !wantOptimized && !wantQasm) {
    throw new UsageError(
      "'qforge inspect' needs a stage: --tokens, --ast, --ir, --optimized, --qasm or --all",
    );
  }

  const { display, source } = await readSource(args, context, 'inspect');
  const compiled = compile(source, { optimize: wantOptimized, limits: limitsFrom(args) });
  reportDiagnostics(context.writer, compiled.diagnostics, source, display, json);
  if (!compiled.ok || !compiled.unoptimized) return ExitCode.CompileError;

  const tokens = compiled.frontend.allTokens
    .filter((t) => !isTrivia(t.kind))
    .map((t) => ({
      kind: t.kind,
      text: t.text,
      line: t.span.line,
      column: t.span.column,
      start: t.span.start,
      end: t.span.end,
      ...(t.value !== undefined ? { value: t.value } : {}),
    }));

  if (json) {
    context.writer.out(
      `${JSON.stringify(
        {
          file: display,
          ...(wantTokens ? { tokens } : {}),
          ...(wantAst ? { ast: compiled.frontend.program } : {}),
          ...(wantIr ? { ir: compiled.unoptimized } : {}),
          ...(wantOptimized
            ? { optimizedIr: compiled.module, report: compiled.report ?? null }
            : {}),
          ...(wantQasm
            ? { openqasm3: emitOpenQasm3(compiled.module ?? compiled.unoptimized).code }
            : {}),
        },
        null,
        2,
      )}\n`,
    );
    return ExitCode.Success;
  }

  const sections: string[] = [];

  if (wantTokens) {
    const lines = tokens.map(
      (t) =>
        `${String(t.line).padStart(4)}:${String(t.column).padStart(3)}  ${t.kind.padEnd(14)} ${JSON.stringify(t.text)}`,
    );
    sections.push(`=== tokens (${tokens.length}) ===\n${lines.join('\n')}`);
  }

  if (wantAst) {
    sections.push(`=== ast ===\n${JSON.stringify(compiled.frontend.program, null, 2)}`);
  }

  if (wantIr) {
    sections.push(`=== ir (unoptimised) ===\n${printIr(compiled.unoptimized)}`);
  }

  if (wantOptimized && compiled.module) {
    sections.push(`=== ir (optimised) ===\n${printIr(compiled.module)}`);
    if (compiled.report) {
      sections.push(
        `=== optimisation report ===\n${formatOptimizationReport(compiled.report)}`,
      );
    }
  }

  if (wantQasm) {
    sections.push(
      `=== openqasm 3 ===\n${emitOpenQasm3(compiled.module ?? compiled.unoptimized).code.trimEnd()}`,
    );
  }

  context.writer.out(`${sections.join('\n\n')}\n`);
  return ExitCode.Success;
}

// ---------------------------------------------------------------- format

export async function commandFormat(
  args: ParsedArgs,
  context: CommandContext,
): Promise<ExitCode> {
  rejectUnknownFlags(args, ['write', 'check']);
  const write = boolFlag(args, 'write');
  const checkOnly = boolFlag(args, 'check');
  if (write && checkOnly) {
    throw new UsageError("'--write' and '--check' cannot be combined");
  }

  const { path, display, source } = await readSource(args, context, 'format');
  const result = formatSource(source);

  if (!result.ok) {
    reportDiagnostics(context.writer, result.diagnostics, source, display, false);
    context.writer.err(`refusing to format '${display}' while it has lexical errors\n`);
    return ExitCode.CompileError;
  }

  if (checkOnly) {
    if (result.text === source) {
      context.writer.out(`${display}: already formatted\n`);
      return ExitCode.Success;
    }
    context.writer.err(`${display}: not formatted\n`);
    return ExitCode.CompileError;
  }

  if (write) {
    if (result.text === source) {
      context.writer.out(`${display}: already formatted\n`);
      return ExitCode.Success;
    }
    try {
      await writeFile(path, result.text, 'utf8');
    } catch (error) {
      const failure = new Error(
        `Cannot write '${display}': ${error instanceof Error ? error.message : String(error)}`,
      );
      (failure as { exitCode?: number }).exitCode = ExitCode.RuntimeError;
      throw failure;
    }
    context.writer.out(`${display}: formatted\n`);
    return ExitCode.Success;
  }

  context.writer.out(result.text);
  return ExitCode.Success;
}

export function commandHelp(command: string | undefined, writer: Writer): ExitCode {
  const text = command ? COMMAND_HELP[command] : undefined;
  if (command && !text) {
    writer.err(`No help for '${command}'\n`);
    return ExitCode.UsageError;
  }
  writer.out(`${text ?? ''}\n`);
  return ExitCode.Success;
}
