/**
 * A deliberately independent, minimal OpenQASM 3 reader — written to *check*
 * QForge's code generator, not to be part of it.
 *
 * ## Why write a second parser
 *
 * The obvious way to test a code generator is to generate code and compare it
 * to a golden string. That catches formatting regressions but proves nothing
 * about meaning: if the backend emitted operands in the wrong order, the golden
 * file would simply record the wrong order.
 *
 * The check that has teeth is a round trip through a *different* implementation:
 * emit OpenQASM, parse it back with code that shares nothing with the QForge
 * frontend, simulate the result, and require the same statevector. That catches
 * swapped operands, off-by-one register indices, wrong gate-name mappings and
 * mis-serialised angles.
 *
 * To keep it genuinely independent this parser is written in a different style
 * from `@qforge/language`: line-oriented regular expressions instead of a
 * hand-written lexer, and a shunting-yard evaluator instead of a Pratt parser.
 *
 * ## Scope
 *
 * It understands exactly the subset QForge emits, and throws on anything else
 * rather than guessing. It is not an OpenQASM 3 implementation and makes no
 * claim to be one.
 */

export interface QasmRegister {
  readonly name: string;
  readonly size: number;
  /** True when declared as `qubit[n] name;` rather than `qubit name;`. */
  readonly indexed: boolean;
}

export interface QasmCondition {
  /** Global classical-bit indices, least significant first. */
  readonly clbits: readonly number[];
  readonly value: number;
  readonly negate: boolean;
}

export interface QasmOperation {
  readonly gate: string;
  readonly params: readonly number[];
  /** Global qubit indices, in the order written. */
  readonly qubits: readonly number[];
  /** Destination classical bit, for `measure` only. */
  readonly clbit?: number;
  /** Present when the statement was wrapped in `if (...) { ... }`. */
  readonly condition?: QasmCondition;
}

export interface QasmCircuit {
  readonly version: string;
  readonly includes: readonly string[];
  readonly qubitRegisters: readonly QasmRegister[];
  readonly clbitRegisters: readonly QasmRegister[];
  readonly qubitCount: number;
  readonly clbitCount: number;
  readonly operations: readonly QasmOperation[];
}

export class QasmParseError extends Error {}

const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, euler: Math.E };

/**
 * Evaluate an OpenQASM angle expression using the shunting-yard algorithm.
 *
 * Supports `+ - * /`, unary minus, parentheses, decimal literals and the named
 * constants. Deliberately a different algorithm from QForge's Pratt parser.
 */
export function evaluateQasmExpression(text: string): number {
  const tokens = text.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_]\w*|[()+\-*/]/g);
  if (!tokens) throw new QasmParseError(`Cannot tokenize expression: ${text}`);

  const output: Array<number | string> = [];
  const operators: string[] = [];
  const precedence: Record<string, number> = { 'u-': 3, '*': 2, '/': 2, '+': 1, '-': 1 };
  let expectOperand = true;

  for (const token of tokens) {
    if (/^[\d.]/.test(token)) {
      output.push(Number(token));
      expectOperand = false;
    } else if (/^[A-Za-z_]/.test(token)) {
      const value = CONSTANTS[token];
      if (value === undefined) throw new QasmParseError(`Unknown constant '${token}'`);
      output.push(value);
      expectOperand = false;
    } else if (token === '(') {
      operators.push(token);
      expectOperand = true;
    } else if (token === ')') {
      while (operators.length && operators[operators.length - 1] !== '(') {
        output.push(operators.pop()!);
      }
      if (operators.pop() !== '(')
        throw new QasmParseError(`Unbalanced parentheses in ${text}`);
      expectOperand = false;
    } else {
      const op = expectOperand && token === '-' ? 'u-' : token;
      if (expectOperand && token === '+') continue;
      while (operators.length) {
        const top = operators[operators.length - 1]!;
        if (top === '(') break;
        if (precedence[top]! < precedence[op]!) break;
        if (op === 'u-' && precedence[top]! <= precedence[op]!) break;
        output.push(operators.pop()!);
      }
      operators.push(op);
      expectOperand = true;
    }
  }
  while (operators.length) {
    const op = operators.pop()!;
    if (op === '(') throw new QasmParseError(`Unbalanced parentheses in ${text}`);
    output.push(op);
  }

  const stack: number[] = [];
  for (const item of output) {
    if (typeof item === 'number') {
      stack.push(item);
      continue;
    }
    if (item === 'u-') {
      stack.push(-stack.pop()!);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined)
      throw new QasmParseError(`Malformed expression: ${text}`);
    switch (item) {
      case '+':
        stack.push(a + b);
        break;
      case '-':
        stack.push(a - b);
        break;
      case '*':
        stack.push(a * b);
        break;
      case '/':
        stack.push(a / b);
        break;
      default:
        throw new QasmParseError(`Unknown operator '${item}'`);
    }
  }
  if (stack.length !== 1) throw new QasmParseError(`Malformed expression: ${text}`);
  return stack[0]!;
}

/**
 * Strip `//` comments and split into statements on `;`, but only at brace
 * depth zero so that `if (c == 1) { x q; }` stays one statement.
 *
 * A character scan rather than a regex split, because the brace nesting cannot
 * be expressed in one. It is still a deliberately different technique from the
 * QForge frontend's hand-written token stream.
 */
function statementsOf(source: string): string[] {
  const withoutComments = source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of withoutComments) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ';' && depth === 0) {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
    // A `}` that closes back to depth 0 ends the statement on its own: an
    // `if` block carries no trailing semicolon, so two consecutive ones would
    // otherwise run together into a single unparseable blob.
    if (ch === '}' && depth === 0) {
      statements.push(current);
      current = '';
    }
  }
  statements.push(current);

  return statements.map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s.length > 0);
}

export function parseQasm3(source: string): QasmCircuit {
  const statements = statementsOf(source);
  if (statements.length === 0) throw new QasmParseError('Empty program');

  let version: string | undefined;
  const includes: string[] = [];
  const qubitRegisters: QasmRegister[] = [];
  const clbitRegisters: QasmRegister[] = [];
  const operations: QasmOperation[] = [];

  let qubitCount = 0;
  let clbitCount = 0;
  const qubitBase = new Map<string, QasmRegister & { base: number }>();
  const clbitBase = new Map<string, QasmRegister & { base: number }>();

  /** Resolve `name` or `name[i]` to a global index. */
  const resolve = (
    text: string,
    table: Map<string, QasmRegister & { base: number }>,
    kind: string,
  ): number => {
    const indexed = /^([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/.exec(text);
    const bare = /^([A-Za-z_]\w*)$/.exec(text);
    if (indexed) {
      const register = table.get(indexed[1]!);
      if (!register) throw new QasmParseError(`Undeclared ${kind} '${indexed[1]}'`);
      const offset = Number(indexed[2]);
      if (offset >= register.size) {
        throw new QasmParseError(`Index ${offset} out of range for '${register.name}'`);
      }
      return register.base + offset;
    }
    if (bare) {
      const register = table.get(bare[1]!);
      if (!register) throw new QasmParseError(`Undeclared ${kind} '${bare[1]}'`);
      if (register.indexed) {
        throw new QasmParseError(`'${register.name}' is a register and needs an index`);
      }
      return register.base;
    }
    throw new QasmParseError(`Cannot parse ${kind} operand '${text}'`);
  };

  for (const statement of statements) {
    parseOne(statement);
  }

  function parseOne(statement: string): void {
    let match: RegExpExecArray | null;

    if ((match = /^OPENQASM\s+([\d.]+)$/.exec(statement))) {
      version = match[1]!;
      return;
    }
    if ((match = /^include\s+"([^"]+)"$/.exec(statement))) {
      includes.push(match[1]!);
      return;
    }
    if ((match = /^(qubit|bit)\s*(?:\[\s*(\d+)\s*\])?\s+([A-Za-z_]\w*)$/.exec(statement))) {
      const kind = match[1]!;
      const size = match[2] === undefined ? 1 : Number(match[2]);
      const name = match[3]!;
      const indexed = match[2] !== undefined;
      const register: QasmRegister = { name, size, indexed };
      if (kind === 'qubit') {
        qubitRegisters.push(register);
        qubitBase.set(name, { ...register, base: qubitCount });
        qubitCount += size;
      } else {
        clbitRegisters.push(register);
        clbitBase.set(name, { ...register, base: clbitCount });
        clbitCount += size;
      }
      return;
    }
    // `if (cond) { body }` -- the body is one statement, handled by recursing
    // into `parseOne` and then stamping the condition onto whatever it
    // produced. QForge predicates individual instructions, so a body is always
    // exactly one operation, but the loop costs nothing and is honest about it.
    if ((match = /^if\s*\((.+?)\)\s*\{\s*(.*?)\s*;?\s*\}$/.exec(statement))) {
      const conditionText = match[1]!.trim();
      const body = match[2]!.trim();
      // A single `bit` compares against a boolean and a `bit[n]` against an
      // integer, which is what the OpenQASM 3 type system requires.
      const parts = /^([A-Za-z_]\w*(?:\s*\[\s*\d+\s*\])?)\s*(==|!=)\s*(true|false|\d+)$/.exec(
        conditionText,
      );
      if (!parts) throw new QasmParseError(`Cannot parse condition '${conditionText}'`);
      const rawValue = parts[3]!;
      const conditionValue =
        rawValue === 'true' ? 1 : rawValue === 'false' ? 0 : Number(rawValue);

      const targetText = parts[1]!.trim();
      let clbits: number[];
      if (/\[/.test(targetText)) {
        clbits = [resolve(targetText, clbitBase, 'bit')];
      } else {
        const register = clbitBase.get(targetText);
        if (!register) throw new QasmParseError(`Undeclared bit '${targetText}'`);
        clbits = Array.from({ length: register.size }, (_, i) => register.base + i);
      }

      const condition: QasmCondition = {
        clbits,
        value: conditionValue,
        negate: parts[2] === '!=',
      };

      const before = operations.length;
      parseOne(body);
      for (let i = before; i < operations.length; i++) {
        operations[i] = { ...operations[i]!, condition };
      }
      return;
    }

    if (
      (match = /^([A-Za-z_]\w*(?:\s*\[\s*\d+\s*\])?)\s*=\s*measure\s+(.+)$/.exec(statement))
    ) {
      operations.push({
        gate: 'measure',
        params: [],
        qubits: [resolve(match[2]!.trim(), qubitBase, 'qubit')],
        clbit: resolve(match[1]!.trim(), clbitBase, 'bit'),
      });
      return;
    }
    if ((match = /^reset\s+(.+)$/.exec(statement))) {
      operations.push({
        gate: 'reset',
        params: [],
        qubits: [resolve(match[1]!.trim(), qubitBase, 'qubit')],
      });
      return;
    }
    if ((match = /^barrier\s*(.*)$/.exec(statement))) {
      const operands = match[1]!.trim();
      operations.push({
        gate: 'barrier',
        params: [],
        qubits: operands
          ? operands.split(',').map((o) => resolve(o.trim(), qubitBase, 'qubit'))
          : [],
      });
      return;
    }
    if ((match = /^([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s+(.+)$/.exec(statement))) {
      const gate = match[1]!;
      const paramText = match[2];
      const params = paramText
        ? paramText.split(',').map((p) => evaluateQasmExpression(p.trim()))
        : [];
      const qubits = match[3]!.split(',').map((o) => resolve(o.trim(), qubitBase, 'qubit'));
      operations.push({ gate, params, qubits });
      return;
    }

    throw new QasmParseError(`Unsupported statement: '${statement}'`);
  }

  if (!version) throw new QasmParseError('Missing OPENQASM version declaration');

  return {
    version,
    includes,
    qubitRegisters,
    clbitRegisters,
    qubitCount,
    clbitCount,
    operations,
  };
}
