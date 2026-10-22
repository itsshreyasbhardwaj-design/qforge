#!/usr/bin/env node
import { main } from './index.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Anything reaching here is a bug in the CLI rather than a user error, so
    // print the stack: silently swallowing it would make the bug unreportable.
    process.stderr.write(
      `qforge: internal error\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 3;
  });
