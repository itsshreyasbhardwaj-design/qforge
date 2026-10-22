# The QForge language specification

Version 0.1. This document defines QForge precisely enough that another engineer
could write a compatible parser without reading the reference implementation.

Everything here is enforced by `packages/language`, and
`tests/integration/spec-integrity.test.ts` fails if a diagnostic code exists in
the compiler but is missing from the table below.

---

## 1. Design goals and non-goals

QForge is a teaching language for quantum circuits. Its grammar fits on one
page, every program is a straight-line circuit, and every error has a code and
a suggested fix.

It is **not** a general quantum programming language. There are no loops, no
conditionals, no functions and no dynamic circuit construction. Those features
were left out because their _semantics_ in a quantum setting are exactly the
subtle part — classical feedback mid-circuit changes what a simulator must do —
and a teaching language that implemented them badly would be worse than one that
says plainly that it does not. See [limitations.md](limitations.md).

---

## 2. Lexical grammar

Source is UTF-8 text. The lexer is total: every character ends up in exactly one
token, including invalid ones, so nothing is silently dropped.

### 2.1 Whitespace and comments

```
whitespace  ::= (' ' | '\t' | '\r' | '\n')+
line-comment  ::= '//' [^\n]*
block-comment ::= '/*' .*? '*/'
```

Whitespace and comments are trivia: they separate tokens and are otherwise
ignored by the parser. They are retained by the lexer for the formatter and the
studio's token view.

An unterminated block comment is an error (`QF002`) but does not stop
tokenisation.

### 2.2 Identifiers and keywords

```
identifier ::= [A-Za-z_] [A-Za-z0-9_]*
```

QForge is **case sensitive**: `qubit` is a keyword, `Qubit` is an identifier.

Reserved words, which may not be used as names:

```
qubit   bit   const   measure   reset   barrier
```

Gate mnemonics (`h`, `cx`, …) are **not** reserved. A qubit may be named `h`;
the parser distinguishes them by position. The OpenQASM backend renames such a
qubit on output, because OpenQASM does reserve them.

### 2.3 Numbers

```
number   ::= digits ('.' digits?)? exponent?
           | '.' digits exponent?
exponent ::= ('e' | 'E') ('+' | '-')? digits
digits   ::= [0-9]+
```

Examples: `0`, `42`, `1.5`, `.5`, `1.`, `1e3`, `2.5E+2`, `1e-3`.

Numbers are IEEE-754 doubles. A literal immediately followed by identifier
characters is an error (`QF003`): `2pi` is not an implicit product, write
`2 * pi`.

### 2.4 Operators and punctuation

```
;   ,   (   )   [   ]   ->   +   -   *   /   ^   =
```

Any other character is an error (`QF001`). The lexer emits an `invalid` token
for it and continues, so one stray symbol does not hide the rest of the file.

---

## 3. Syntax grammar

Written in EBNF. `A*` is zero or more, `A?` is optional, `|` is alternation.

```ebnf
program     ::= statement*

statement   ::= qubit-decl
              | bit-decl
              | const-decl
              | gate-apply
              | measure-stmt
              | reset-stmt
              | barrier-stmt

qubit-decl  ::= 'qubit' ('[' expression ']')? identifier ';'
bit-decl    ::= 'bit'   ('[' expression ']')? identifier ';'
const-decl  ::= 'const' identifier '=' expression ';'

gate-apply  ::= identifier ('(' expression-list? ')')? operand-list ';'
measure-stmt::= 'measure' operand '->' operand ';'
reset-stmt  ::= 'reset' operand ';'
barrier-stmt::= 'barrier' operand-list? ';'

operand-list    ::= operand (',' operand)*
expression-list ::= expression (',' expression)*
operand         ::= identifier ('[' expression ']')?

expression  ::= unary (binary-op unary)*
unary       ::= ('+' | '-')* primary
primary     ::= number
              | identifier
              | '(' expression ')'
binary-op   ::= '+' | '-' | '*' | '/' | '^'
```

Statements are terminated by `;`. Newlines are not significant, but a statement
that fails to parse is abandoned at the next line boundary, which is how the
compiler reports several missing semicolons at once.

### 3.1 Operator precedence

Loosest to tightest:

| Precedence | Operators              | Associativity |
| ---------- | ---------------------- | ------------- |
| 1          | `+` `-` (binary)       | left          |
| 2          | `*` `/`                | left          |
| 3          | `+` `-` (unary prefix) | right         |
| 4          | `^`                    | right         |

Consequences worth stating explicitly, all covered by tests:

- `1 + 2 * 3` is `7`
- `10 - 3 - 2` is `5`
- `2 ^ 3 ^ 2` is `512`, not `64`
- `-2 ^ 2` is `-4`: exponentiation binds tighter than unary minus
- `(-2) ^ 2` is `4`

---

## 4. Types and declarations

QForge has three kinds of name and no type inference.

| Kind  | Declared by                 | Holds                                           |
| ----- | --------------------------- | ----------------------------------------------- |
| qubit | `qubit a;` or `qubit[n] a;` | a quantum two-level system, initialised to \|0> |
| bit   | `bit c;` or `bit[n] c;`     | a classical bit, initialised to 0               |
| const | `const k = expr;`           | a compile-time double                           |

### 4.1 Scope

There is exactly one scope: the program. There are no blocks, no shadowing and
no forward references.

**QForge is strictly declare-before-use.** A name is visible only to the
statements that follow its declaration. This keeps the reading order of a
circuit identical to its execution order, and it is why the analyser is a single
ordered pass rather than two.

### 4.2 Registers and indices

A declaration without brackets is a _scalar_ and may not be indexed (`QF212`).
A declaration with brackets is a _register_, must have size at least 1
(`QF215`), and must always be indexed (`QF213`). Indices are compile-time
constants in `0 .. size-1` (`QF211`).

### 4.3 Global index allocation

Qubits are numbered 0, 1, 2, … in declaration order, with a register occupying
`size` consecutive indices. Classical bits are numbered independently, the same
way. These global indices are the only names the IR, simulator and OpenQASM
backend use.

```
qubit a;        // a      -> qubit 0
qubit[3] q;     // q[0..2]-> qubits 1, 2, 3
bit c;          // c      -> clbit 0
bit[2] d;       // d[0..1]-> clbits 1, 2
```

---

## 5. Expressions

Expressions appear in three places: rotation angles, register sizes and
indices. All are evaluated at compile time; the IR contains numbers, never
expression trees.

**There is no runtime expression evaluation anywhere in QForge, and no use of
`eval` or `Function` on user source in any component.** The entire evaluator is
a tree walk over five operators.

### 5.1 Named constants

| Name    | Value                                |
| ------- | ------------------------------------ |
| `pi`    | the double nearest to pi (`Math.PI`) |
| `tau`   | `2 * pi`                             |
| `euler` | the double nearest to e              |

User constants declared with `const` are also in scope, subject to
declare-before-use.

### 5.2 Numerical precision

All arithmetic is IEEE-754 double precision, evaluated left to right in the
order the precedence table implies. Angles are radians. `docs/quantum-math.md`
analyses the resulting error.

Division by zero is a compile error (`QF214`), as is any expression that
evaluates to a non-finite value.

### 5.3 Integer contexts

Register sizes and indices must evaluate to a non-negative integer (`QF215`).
`qubit[1.5] q;` and `qubit[-1] q;` are both errors.

---

## 6. Gates

Seventeen gates, each with a fixed qubit arity and parameter count.

| Mnemonic    | Qubits | Params | Operation                                        |
| ----------- | -----: | -----: | ------------------------------------------------ |
| `id`        |      1 |      0 | identity                                         |
| `h`         |      1 |      0 | Hadamard                                         |
| `x`         |      1 |      0 | Pauli-X (bit flip)                               |
| `y`         |      1 |      0 | Pauli-Y                                          |
| `z`         |      1 |      0 | Pauli-Z (phase flip)                             |
| `s`         |      1 |      0 | phase, equals `p(pi/2)`                          |
| `sdg`       |      1 |      0 | inverse phase, equals `p(-pi/2)`                 |
| `t`         |      1 |      0 | equals `p(pi/4)`                                 |
| `tdg`       |      1 |      0 | equals `p(-pi/4)`                                |
| `p(theta)`  |      1 |      1 | phase shift `diag(1, exp(i*theta))`              |
| `rx(theta)` |      1 |      1 | rotation about X                                 |
| `ry(theta)` |      1 |      1 | rotation about Y                                 |
| `rz(theta)` |      1 |      1 | rotation about Z                                 |
| `cx`        |      2 |      0 | controlled-X; operands are `control, target`     |
| `cz`        |      2 |      0 | controlled-Z; symmetric in its operands          |
| `swap`      |      2 |      0 | exchange two qubits; symmetric                   |
| `ccx`       |      3 |      0 | Toffoli; operands are `control, control, target` |

Matrices are given in [quantum-math.md](quantum-math.md).

### 6.1 Operand rules

- The operand count must match the gate's arity exactly (`QF204`).
- The parameter count must match exactly (`QF205`). A gate with no parameters
  must be written without parentheses.
- A multi-qubit gate's operands must be **distinct** qubits (`QF208`).
  `cx a, a` is not a no-op, it is undefined: the gate's matrix is only defined
  on a tensor product of distinct factors.
- Operand order is significant except where the table says symmetric.

---

## 7. Measurement, reset and barrier

### 7.1 `measure q -> c;`

Measures qubit `q` in the computational basis and stores the outcome in
classical bit `c`. The qubit's state collapses onto the observed outcome.

- The source must be a qubit (`QF206`) and the destination a classical bit
  (`QF207`).
- Classical bits start each shot at 0, so a bit that is never measured reads 0.
- A later measurement into the same bit overwrites the earlier value.
- Measuring the same qubit twice with nothing in between yields the same bit
  both times: measurement is repeatable.

### 7.2 `reset q;`

Returns `q` to |0>. **Reset is a measurement whose result is discarded,
followed by a flip if the result was 1** — not a projection onto |0>. The
distinction matters whenever `q` is entangled: the partner must be left
correlated with the outcome that actually occurred.

### 7.3 `barrier;` and `barrier a, b;`

A fence for the optimiser. It has no effect on the quantum state and generates
no gate. No pass will cancel, merge or move an instruction across a barrier that
covers a qubit they share. A bare `barrier;` covers every qubit.

---

## 8. Compilation stages

```
source text
   -> tokenize()   lexer       packages/language/src/lexer
   -> parse()      parser      packages/language/src/parser      -> typed AST
   -> analyze()    semantics   packages/language/src/semantic    -> SemanticModel
   -> lower()      lowering    packages/compiler/src/ir          -> IrModule
   -> optimize()   passes      packages/compiler/src/passes      -> IrModule
   -> emit / run   backends    packages/compiler/src/backends
                               packages/simulator
```

Each stage is independently testable and has no knowledge of the stages after
it. Diagnostics are collected, never thrown, so one error never hides the rest.

---

## 9. Diagnostic codes

Codes are a public contract: once published, a code never changes meaning and is
never reused.

| Range | Stage             |
| ----- | ----------------- |
| QF0xx | lexical analysis  |
| QF1xx | parsing           |
| QF2xx | semantic analysis |
| QF3xx | resource limits   |
| QF4xx | backends          |

### Lexical

| Code    | Meaning                                            |
| ------- | -------------------------------------------------- |
| `QF001` | Invalid character in source                        |
| `QF002` | Unterminated block comment                         |
| `QF003` | Malformed number literal (for example `2pi`, `1e`) |
| `QF004` | Number literal is not a finite value               |

### Syntax

| Code    | Meaning                                         |
| ------- | ----------------------------------------------- |
| `QF101` | Unexpected token where a statement was expected |
| `QF102` | Missing `;` at the end of a statement           |
| `QF103` | Expected an identifier                          |
| `QF104` | Unbalanced parenthesis                          |
| `QF105` | Expected `->` in a measure statement            |
| `QF106` | Expected an expression                          |
| `QF107` | Unexpected end of input                         |
| `QF108` | Expected `]`                                    |
| `QF109` | Expected a register size inside `[ ]`           |
| `QF110` | Expected `,`                                    |

### Semantics

| Code    | Meaning                                                  |
| ------- | -------------------------------------------------------- |
| `QF201` | Name is already declared                                 |
| `QF202` | Unknown identifier                                       |
| `QF203` | Unknown gate                                             |
| `QF204` | Gate applied to the wrong number of qubits               |
| `QF205` | Gate given the wrong number of parameters                |
| `QF206` | Classical bit or constant used where a qubit is required |
| `QF207` | Qubit used where a classical bit is required             |
| `QF208` | A multi-qubit gate names the same qubit twice            |
| `QF209` | Invalid measurement target                               |
| `QF210` | Expression is not a compile-time constant                |
| `QF211` | Register index out of range                              |
| `QF212` | A scalar declaration cannot be indexed                   |
| `QF213` | A register must be indexed                               |
| `QF214` | Division by zero in a constant expression                |
| `QF215` | Register size or index is not a non-negative integer     |
| `QF216` | Unsupported language feature                             |
| `QF217` | Constant does not evaluate to a number                   |

### Resource limits

| Code    | Meaning                                  |
| ------- | ---------------------------------------- |
| `QF301` | Too many qubits for the configured limit |
| `QF302` | Source file is too large                 |
| `QF303` | Too many instructions                    |
| `QF304` | Shot count out of range                  |
| `QF305` | Too many classical bits                  |

### Backends

| Code    | Meaning                                             |
| ------- | --------------------------------------------------- |
| `QF401` | Opcode has no representation in the selected target |

### Diagnostic format

```text
error QF202:
Unknown qubit 'target'

examples/broken.qf:4:13

cx control, target;
            ^^^^^^

Declare it first, for example 'qubit target;'.
```

---

## 10. Resource limits

Enforced at compile time, so a program that would exhaust memory is rejected
rather than attempted.

| Limit          |   Browser |       CLI | Hard ceiling |
| -------------- | --------: | --------: | -----------: |
| Qubits         |        14 |        20 |           26 |
| Classical bits |        64 |       256 |            — |
| Instructions   |    20,000 |   200,000 |            — |
| Source size    |   256 KiB |   256 KiB |      256 KiB |
| Shots          | 1,000,000 | 1,000,000 |    1,000,000 |

A statevector needs `2^n` complex amplitudes stored as two `Float64Array`s, so
memory is `2^n * 16` bytes: 256 KiB at 14 qubits, 16 MiB at 20, 1 GiB at 26.

---

## 11. Worked example

```qforge
// A Bell state.
qubit alice;
qubit bob;

bit resultA;
bit resultB;

h alice;
cx alice, bob;

measure alice -> resultA;
measure bob -> resultB;
```

Compiles to the IR

```
h %0
cx %0, %1
measure %0 -> $0
measure %1 -> $1
```

and the OpenQASM 3

```qasm
OPENQASM 3.0;
include "stdgates.inc";

qubit alice;
qubit bob;
bit resultA;
bit resultB;

h alice;
cx alice, bob;
resultA = measure alice;
resultB = measure bob;
```

and produces only the outcomes `00` and `11`, each with probability 1/2.

---

## 12. Known limitations

Summarised here, detailed in [limitations.md](limitations.md):

- no classical control flow, so quantum teleportation cannot be expressed
- no user-defined gates or subroutines
- no arbitrary unitary gate, and no `u`/`u3`
- no classical arithmetic on measured bits
- no qubit aliasing, slicing or iteration
- the OpenQASM backend covers only the subset above
