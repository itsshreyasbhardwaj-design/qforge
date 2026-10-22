/**
 * Process exit codes, stable across releases so scripts and CI can rely on them.
 *
 * The distinction that matters is 1 vs 2: a program that fails to compile is a
 * *result* the CLI produced successfully, whereas a bad command line means the
 * CLI could not do anything at all. Conflating them makes `qforge check` useless
 * in a pre-commit hook.
 */
export const ExitCode = {
  /** Everything succeeded. */
  Success: 0,
  /** The program was read and processed, but had compilation errors. */
  CompileError: 1,
  /** The command line was wrong: unknown command, bad flag, missing argument. */
  UsageError: 2,
  /** An I/O or runtime failure: unreadable file, resource limit exceeded. */
  RuntimeError: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
