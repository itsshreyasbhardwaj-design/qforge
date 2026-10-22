/**
 * `qforge` — the QForge command-line interface.
 *
 * `main()` is exported and takes an injectable writer and cwd so the whole CLI
 * can be exercised in-process by the test suite as well as spawned as a
 * subprocess. Nothing here writes to `process.stdout` directly.
 */
import { parseArgs, UsageError } from './args.js';
import { ExitCode } from './exit-codes.js';
import { consoleWriter, type Writer } from './output.js';
import { USAGE, VERSION } from './help.js';
import {
  commandCheck,
  commandCompile,
  commandFormat,
  commandHelp,
  commandInspect,
  commandRun,
  type CommandContext,
} from './commands.js';

export * from './args.js';
export * from './exit-codes.js';
export * from './output.js';
export * from './help.js';

export interface MainOptions {
  readonly writer?: Writer;
  readonly cwd?: string;
}

const COMMANDS = ['check', 'run', 'compile', 'inspect', 'format'] as const;

export async function main(
  argv: readonly string[],
  options: MainOptions = {},
): Promise<ExitCode> {
  const writer = options.writer ?? consoleWriter;
  const context: CommandContext = { writer, cwd: options.cwd ?? process.cwd() };

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    writer.err(`${error instanceof Error ? error.message : String(error)}\n`);
    writer.err(`Run 'qforge --help' for usage.\n`);
    return ExitCode.UsageError;
  }

  if (args.flags.get('version') === true) {
    writer.out(`${VERSION}\n`);
    return ExitCode.Success;
  }

  if (!args.command) {
    writer.out(`${USAGE}\n`);
    // No command is a usage question, not a failure, when --help was asked for.
    return args.flags.get('help') === true ? ExitCode.Success : ExitCode.UsageError;
  }

  if (args.flags.get('help') === true) {
    return commandHelp(args.command, writer);
  }

  try {
    switch (args.command) {
      case 'check':
        return await commandCheck(args, context);
      case 'run':
        return await commandRun(args, context);
      case 'compile':
        return await commandCompile(args, context);
      case 'inspect':
        return await commandInspect(args, context);
      case 'format':
        return await commandFormat(args, context);
      case 'help':
        return commandHelp(args.positionals[0], writer);
      default: {
        const suggestion = COMMANDS.find((c) => c.startsWith(args.command!.slice(0, 2)));
        writer.err(
          `Unknown command '${args.command}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}\n`,
        );
        writer.err(`Commands: ${COMMANDS.join(', ')}. Run 'qforge --help' for usage.\n`);
        return ExitCode.UsageError;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      writer.err(`${error.message}\n`);
      writer.err(`Run 'qforge ${args.command} --help' for usage.\n`);
      return ExitCode.UsageError;
    }
    const code = (error as { exitCode?: ExitCode }).exitCode;
    writer.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return code ?? ExitCode.RuntimeError;
  }
}
