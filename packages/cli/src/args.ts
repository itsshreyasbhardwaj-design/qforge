import { ExitCode } from './exit-codes.js';

export class UsageError extends Error {
  readonly exitCode = ExitCode.UsageError;
}

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

/**
 * Minimal argument parser.
 *
 * Deliberately dependency-free: the CLI's whole job is to be installable and
 * runnable from a clean checkout, and an argument parser is forty lines. It
 * accepts `--flag`, `--flag=value`, `--flag value` and `--no-flag`, and rejects
 * anything it does not recognise rather than ignoring it — a silently dropped
 * `--seed` would make a run irreproducible without telling anyone.
 */
/**
 * Can `token` be the value of the flag that precedes it?
 *
 * Anything not starting with `-` can. A negative number can too: `--seed -1`
 * should report that -1 is out of range for a seed, not that `-1` is an unknown
 * option, which is what a naive "starts with a dash" test produces.
 */
function looksLikeValue(token: string | undefined): token is string {
  if (token === undefined) return false;
  if (!token.startsWith('-')) return true;
  return /^-\d/.test(token);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const equals = body.indexOf('=');
      if (equals >= 0) {
        flags.set(body.slice(0, equals), body.slice(equals + 1));
        continue;
      }
      if (body.startsWith('no-')) {
        flags.set(body.slice(3), false);
        continue;
      }
      // A following token that is not itself a flag becomes this flag's value.
      const next = argv[i + 1];
      if (looksLikeValue(next)) {
        flags.set(body, next);
        i++;
      } else {
        flags.set(body, true);
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const short: Record<string, string> = { h: 'help', v: 'version', o: 'output' };
      const name = short[arg.slice(1)];
      if (!name) throw new UsageError(`Unknown option '${arg}'`);
      const next = argv[i + 1];
      if (name === 'output') {
        if (next === undefined) throw new UsageError(`Option '${arg}' needs a value`);
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    if (command === undefined) command = arg;
    else positionals.push(arg);
  }

  return { command, positionals, flags };
}

/** Read a flag that must be a positive integer. */
export function intFlag(
  args: ParsedArgs,
  name: string,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  if (typeof raw === 'boolean') throw new UsageError(`Option '--${name}' needs a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(
      `Option '--${name}' must be an integer in ${min}..${max}, got '${raw}'`,
    );
  }
  return value;
}

export function boolFlag(args: ParsedArgs, name: string, fallback = false): boolean {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new UsageError(`Option '--${name}' is a switch and does not take a value`);
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const raw = args.flags.get(name);
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') throw new UsageError(`Option '--${name}' needs a value`);
  return raw;
}

/** Reject flags the command does not understand. */
export function rejectUnknownFlags(args: ParsedArgs, allowed: readonly string[]): void {
  const permitted = new Set([...allowed, 'help']);
  for (const name of args.flags.keys()) {
    if (!permitted.has(name)) {
      throw new UsageError(
        `Unknown option '--${name}'. Allowed here: ${[...permitted]
          .sort()
          .map((f) => `--${f}`)
          .join(', ')}`,
      );
    }
  }
}
