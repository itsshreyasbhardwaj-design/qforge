# Compiler design

## Frontend

### Why a hand-written lexer and parser

The grammar fits on one page, so a generator would have saved little code while
costing control over the two things that actually matter here: precise spans and
multi-error recovery. The studio underlines errors in Monaco and the CLI prints
caret excerpts, both of which need exact half-open ranges on every token and
every AST node. Generated parsers can be made to do this; hand-written ones do
it without fighting.

The second reason is pedagogical. A project whose point is to show how a
compiler works should not have its most interesting stage be a grammar file and
a build step.

### Lexing

Single pass, O(n), line and column tracked incrementally rather than recomputed
per token. The lexer is **total**: every character lands in exactly one token,
invalid ones included. Concatenating `allTokens` reproduces the source exactly,
which is asserted by a test and is what lets the formatter preserve comments it
never parses.

An invalid character produces a diagnostic _and_ an `invalid` token, then the
scanner advances one character. One stray symbol therefore does not hide the
rest of the file's errors.

### Parsing

Recursive descent for statements, a Pratt parser for expressions.

Pratt handles precedence and associativity with a table rather than a cascade of
grammar rules, which matters for the two cases people get wrong: `^` is
right-associative, and it binds _tighter_ than unary minus, so `-2 ^ 2` is `-4`.
Both are tested.

#### Error recovery

A malformed statement throws internally; the driver records the diagnostic and
resynchronises. A statement is abandoned at whichever comes first:

1. just past the next `;`,
2. the first token on a line after the one the statement started on, or
3. a keyword that can only begin a statement.

Rule 2 is what makes multi-error reporting work in the common case. The first
implementation had only rules 1 and 3, and on

```
h q
x r
y s
```

it consumed the whole file hunting for a `;` that never came and reported one
error instead of three. Because rule 2 can only fire on a token strictly after
the statement's first one, recovery always makes progress and the parse loop
always terminates — and there is an unconditional progress guard in the loop as
a second line of defence, so a future grammar change cannot turn a parse error
into a hang.

The cost is that a genuinely multi-line statement recovers at its second line
and can produce a follow-on diagnostic. That is the right trade for a language
whose statements are single-line by convention.

### Semantic analysis

One ordered pass that builds the symbol table, resolves every operand to a
global index, folds angle expressions, and checks the static rules.

It never throws and never stops at the first problem: each statement is checked
independently, a failing statement is dropped from the operation list, and the
rest of the program is still analysed. That is what lets the editor underline
everything at once.

#### Declare-before-use

The first implementation used two passes — all declarations, then all
statements — which meant a `const` declared at the bottom of the file was
visible at the top. A test written to pin down the opposite behaviour caught it.

Merging into a single ordered pass made the language strictly
declare-before-use, which is both simpler to implement and the right rule for a
teaching language: the reading order of a circuit is its execution order.

#### Constant folding

Angles are folded here, before the IR exists, so no backend ever sees an
expression tree. The whole evaluator is a tree walk over five operators and
three named constants.

There is no runtime expression evaluation anywhere in QForge, and no `eval` or
`Function` applied to user source in any component. That is a security property
as much as a design one — see [security](../SECURITY.md).

## Middle end

### The IR

Deliberately not the AST. Qubits are integers, registers and scoping are
resolved away, angles are doubles, and the structure is a flat list. A backend
never has to understand QForge syntax, and the optimisation passes can be read
and checked in an afternoon.

Every instruction keeps the span of its source statement. That single field is
what the studio's click-to-step, click-to-reveal and caret-follows-IR features
are built on.

### Passes

Four, run to a fixpoint by a manager that stops when a round changes nothing.

| Pass                  | Rewrite                                                                  | Why it is valid                 |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| `remove-identity`     | drop `id`, `rx/ry/rz` at multiples of `4*pi`, `p` at multiples of `2*pi` | those operators are exactly `I` |
| `cancel-self-inverse` | drop two adjacent applications of `h x y z cx cz swap ccx`               | `G G = I` for those gates       |
| `cancel-inverse-pair` | drop adjacent `s`/`sdg` or `t`/`tdg`                                     | they are exact inverses         |
| `merge-rotations`     | fuse adjacent same-axis rotations                                        | `R(a) R(b) = R(a+b)` exactly    |

#### The contract: operator equality, not statistical equality

Every QForge pass must preserve the circuit's _operator_, global phase included
— not merely its measurement statistics. The stricter rule is what lets the
debugger show optimised and unoptimised runs and get identical amplitudes.

This has a concrete consequence. `rx(2*pi)` equals `-I`, which differs from the
identity only by a global phase, so removing it would preserve every probability
in every circuit. QForge keeps it, and only drops a rotation at multiples of
`4*pi`. `examples/optimisable.qf` contains both cases side by side.

#### Adjacency

The legality test the cancellation and merge passes need is "are these two
instructions adjacent on their shared qubit set?" — the same set of qubits, with
nothing between them touching any of those qubits.

A single left-to-right scan answers it. `lastOn[q]` holds the most recent
instruction on qubit `q`. For instruction `i` on qubit set `S`, if every `q` in
`S` has `lastOn[q] === j` and instruction `j` acts on exactly `S`, then nothing
between them touches `S`, so the two operators are adjacent factors in the
circuit's tensor decomposition and may be combined.

Barriers block everything they cover; `measure` and `reset` block because their
opcodes never match a gate's.

Operand symmetry is handled per gate: `cz` and `swap` are symmetric, `ccx` is
symmetric in its two controls only, and `cx` is symmetric in nothing. So
`cx a,b; cx b,a` is correctly left alone while `cz a,b; cz b,a` cancels.

#### Runs, and a bug worth recording

The scan reports a verdict so that _runs_ of more than two gates resolve in one
pass:

- `both-gone`: roll `lastOn` back past the first instruction, so `h h h h`
  collapses entirely in a single scan.
- `kept-first`: the pass folded the second into the first, so `lastOn` keeps
  pointing at the first.

The `kept-first` case exists because of a real bug. The first version of
`merge-rotations` returned a plain boolean and let the scan advance normally,
so on `rx(1) rx(2) rx(3)` the third rotation merged against the _stale_
unmerged second instruction and produced `rx(3)` instead of `rx(6)`. The
three-way verdict fixed it, and a test now pins the case.

#### How the passes are verified

Not by inspection. `tests/property/pass-equivalence.test.ts` generates random
circuits — including ones deliberately seeded with cancellable structure, so the
test is not vacuous — runs the full pipeline, and compares complete statevectors
before and after. A pass that dropped a `-I` would pass a probability-only check
and fail here. The suite also asserts that the passes actually removed something,
that a second run is a no-op, and that nothing is ever rewritten across a
barrier, measurement or reset.

## Backend

### OpenQASM 3

The backend emits the subset of OpenQASM 3 that QForge programs can express:
declarations, the seventeen `stdgates.inc` gates QForge exposes, `measure`,
`reset` and `barrier`. It is **not** an OpenQASM 3 implementation, and the
generated file says so in its header.

Registers keep the programmer's own names rather than being flattened into one
anonymous array. Names that collide with an OpenQASM keyword — or with a
`stdgates.inc` gate name, which would change what a later call means — are
prefixed with `_`, and the renaming is recorded in a comment.

Output is deterministic: the same module always produces byte-identical source,
with nothing time- or environment-dependent.

#### Angles

Two requirements pull against each other: generated code should read as `pi/2`
rather than `1.5707963267948966`, and a rewritten angle must parse back to the
same double.

The formatter tries a small set of `k*pi/d` forms and accepts one only when
re-evaluating it reproduces the original bit pattern exactly. Otherwise it falls
back to `String(x)`, which in JavaScript is the shortest decimal that round-trips
through an IEEE-754 double. The output is therefore always exact and pretty
whenever pretty happens to be exact. A test checks round-tripping for sixteen
values including optimiser-produced angles with no closed form.

#### How code generation is verified

A golden-file test would catch formatting regressions but prove nothing about
meaning: if the backend emitted operands in the wrong order, the golden file
would simply record the wrong order.

So `tests/conformance/qasm-parser.ts` is a second, deliberately independent
OpenQASM reader — line-oriented regular expressions and a shunting-yard
evaluator, sharing nothing with the QForge frontend's hand-written lexer and
Pratt parser. The conformance suite emits QASM, reads it back with that parser,
simulates both, and requires identical statevectors. It runs on 140 circuits,
including asymmetric `cx` and `ccx` cases that would pass a symmetric test.

## The formatter

Works on the token stream, not the AST, because the AST deliberately does not
retain comments — nothing in the compiler needs them — and a formatter that
silently deleted every comment would be worse than no formatter.

It rewrites only the whitespace between tokens: one statement per line, a space
after `,` and around binary operators, nothing inside `(...)` or `[...]`, and
runs of blank lines collapsed to one so the author's grouping survives. It
refuses to touch source with lexical errors rather than guessing, because
reformatting broken input can move the error.

Tested for idempotence, for preserving program meaning, and for never deleting
a comment. Every published example is checked to be canonically formatted.
