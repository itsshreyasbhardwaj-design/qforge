# Security policy

## Scope

QForge is a compiler, a simulator, a CLI and a static web page. It has no
server, no database, no accounts and no network calls at runtime. That removes
most of the usual attack surface, but not all of it.

## Design properties

**No evaluation of user source.** There is no `eval`, no `new Function` and no
`vm` applied to user input anywhere in the project. QForge expressions are
numbers, three named constants and five operators, evaluated by an explicit tree
walk over an AST the project parsed itself. A `.qf` file cannot execute code.

**No data leaves the machine.** The studio is a static export
(`output: 'export'`). There is no server component doing work, no API route and
no telemetry: the compiler and simulator run in the browser. A quantum program
typed into the editor is never transmitted anywhere.

**No runtime third-party fetches.** Monaco is bundled rather than loaded from a
CDN. The deployed page requests nothing from any external origin.

**Resource limits are enforced, not advisory.** A statevector needs `2^n * 16`
bytes, so an unchecked qubit count is a memory-exhaustion vector. Limits are
checked at compile time _and_ again in the simulator, which is a public API that
can be called without going through the compiler:

| Limit          |   Browser |       CLI | Hard ceiling |
| -------------- | --------: | --------: | -----------: |
| Qubits         |        14 |        20 |           26 |
| Classical bits |        64 |       256 |            — |
| Instructions   |    20,000 |   200,000 |            — |
| Source size    |   256 KiB |   256 KiB |      256 KiB |
| Shots          | 1,000,000 | 1,000,000 |    1,000,000 |

**Malformed input is handled, not trusted.** The lexer is total and the parser
has a guaranteed-progress recovery loop, so no input causes a hang. Diagnostics
are returned as data rather than thrown. A deliberately pathological input set
(`((((`, `-----`, `,,,,`, `[[[[`, …) is in the test suite.

**No secrets.** The repository contains no credentials, tokens or keys, and the
project needs none: there is nothing to authenticate to.

**File system access.** Only the CLI touches the file system, only at paths the
user names on the command line. The browser build cannot read local files.

## Known residual risks

- **Dependencies.** The studio depends on Next, React and Monaco; the toolchain
  on TypeScript, Vitest, ESLint and Playwright. The compiler, simulator and CLI
  have **no runtime dependencies at all**. All versions are pinned exactly and
  committed in `pnpm-lock.yaml`. Run `pnpm audit` before a release.
- **Resource use within the limits.** A 20-qubit circuit legitimately allocates
  16 MiB and can take seconds. The limits bound this; they do not eliminate it.
- **The CLI writes files** where `--output` or `--write` says to, with no
  additional sandboxing beyond the operating system's.
- **Self-hosted deployments** are the deployer's responsibility: QForge ships
  static files and sets no headers of its own.

## Reporting a vulnerability

Open a GitHub security advisory on the repository, or a regular issue if the
problem is not sensitive. Please include a reproduction and the affected
version.

Since QForge handles no user data and runs no server, the realistic categories
are: a resource limit that can be bypassed, a parser input that hangs or
crashes, a dependency advisory, or a way to make the studio contact an external
origin. All four are in scope and worth reporting.

There is no bug bounty.

## Supported versions

Only the latest release. QForge is at 0.1 and has no maintenance branches.
