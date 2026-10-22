import { TokenKind, describeToken, type Token } from '../lexer/token.js';
import { tokenize } from '../lexer/lexer.js';
import { mergeSpans, type SourceSpan } from '../diagnostics/span.js';
import { ErrorCode } from '../diagnostics/codes.js';
import { error, type Diagnostic } from '../diagnostics/diagnostic.js';
import type {
  BinaryOperator,
  Expression,
  OperandRef,
  Program,
  Statement,
  UnaryOperator,
} from '../ast/nodes.js';

export interface ParseResult {
  readonly program: Program;
  readonly tokens: readonly Token[];
  readonly allTokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Binding powers for the expression Pratt parser.
 *
 * `^` is right-associative and binds tighter than unary minus, matching the
 * usual mathematical reading: `-2 ^ 2` is `-(2 ^ 2)` and `2 ^ 3 ^ 2` is
 * `2 ^ (3 ^ 2)`. Documented in docs/language-spec.md.
 */
const BINARY_PRECEDENCE: Partial<Record<TokenKind, number>> = {
  [TokenKind.Plus]: 1,
  [TokenKind.Minus]: 1,
  [TokenKind.Star]: 2,
  [TokenKind.Slash]: 2,
  [TokenKind.Caret]: 4,
};
const UNARY_PRECEDENCE = 3;
const RIGHT_ASSOCIATIVE = new Set<TokenKind>([TokenKind.Caret]);

/** Tokens that may legally start a statement — the recovery synchronisation set. */
const STATEMENT_START = new Set<TokenKind>([
  TokenKind.Qubit,
  TokenKind.Bit,
  TokenKind.Const,
  TokenKind.Measure,
  TokenKind.Reset,
  TokenKind.Barrier,
  TokenKind.Identifier,
]);

class RecoverError extends Error {}

/**
 * Hand-written recursive-descent parser with a Pratt sub-parser for angle
 * expressions.
 *
 * Why hand-written rather than generated: the grammar is small, and the editor
 * needs precise spans plus multi-error recovery, both of which are easier to
 * control directly than through a parser generator's error machinery. See
 * docs/compiler-design.md.
 *
 * Recovery strategy: a malformed statement throws internally, the driver
 * records the diagnostic and then skips tokens up to and including the next
 * `;` (or up to the next statement-start keyword), so one bad line does not
 * mask the rest of the file.
 */
class Parser {
  private index = 0;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: readonly Token[]) {}

  // ---- token helpers ----

  private peek(offset = 0): Token {
    // The token stream always ends with EndOfFile, so the clamp is safe.
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private get current(): Token {
    return this.peek();
  }

  private atEnd(): boolean {
    return this.current.kind === TokenKind.EndOfFile;
  }

  private advance(): Token {
    const token = this.current;
    if (!this.atEnd()) this.index++;
    return token;
  }

  private check(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private match(kind: TokenKind): Token | undefined {
    return this.check(kind) ? this.advance() : undefined;
  }

  private fail(code: ErrorCode, message: string, hint?: string, span?: SourceSpan): never {
    this.diagnostics.push(error(code, message, span ?? this.current.span, hint));
    throw new RecoverError(message);
  }

  private expect(kind: TokenKind, code: ErrorCode, what: string, hint?: string): Token {
    const token = this.match(kind);
    if (token) return token;
    this.fail(code, `Expected ${what}, found ${describeToken(this.current)}`, hint);
  }

  // ---- program ----

  parseProgram(): Program {
    const statements: Statement[] = [];
    const start = this.current.span;

    while (!this.atEnd()) {
      // An `Invalid` token already produced a lexical diagnostic; skip it so the
      // parser does not report a second, redundant error for the same character.
      if (this.check(TokenKind.Invalid)) {
        this.advance();
        continue;
      }
      const startIndex = this.index;
      const startLine = this.current.span.line;
      try {
        statements.push(this.parseStatement());
      } catch (err) {
        if (!(err instanceof RecoverError)) throw err;
        this.synchronize(startLine);
      }
      // Safety net: every iteration must consume at least one token. Recovery is
      // designed to guarantee this, but an unconditional guard means a future
      // grammar change can never turn a parse error into a hang.
      if (this.index === startIndex) this.advance();
    }

    const end = this.current.span;
    return {
      kind: 'Program',
      statements,
      span: statements.length
        ? mergeSpans(start, statements[statements.length - 1]!.span)
        : mergeSpans(start, end),
    };
  }

  /**
   * Abandon the current statement and resynchronise.
   *
   * A statement is abandoned at whichever comes first:
   *   1. just past the next `;`,
   *   2. the first token on a line after the one the statement started on, or
   *   3. a keyword that can only begin a statement.
   *
   * Rule 2 is what makes multi-error reporting work for the common case of a
   * forgotten semicolon: without it, `h q` followed by `x r` on the next line
   * would consume the rest of the file looking for a `;` that never comes, and
   * the editor would show one error instead of two. Because the rule can only
   * fire on a token strictly after the statement's first one, recovery always
   * makes progress and the parse loop always terminates.
   *
   * The cost is that a genuinely multi-line statement recovers at its second
   * line, which can produce a follow-on diagnostic. That is the right trade:
   * QForge statements are single-line by convention.
   */
  private synchronize(startLine: number): void {
    while (!this.atEnd()) {
      if (this.current.span.line > startLine) return;
      if (this.match(TokenKind.Semicolon)) return;
      // Only treat an identifier as a fresh statement start if it plausibly
      // begins a gate application, i.e. it is not mid-expression.
      if (
        STATEMENT_START.has(this.current.kind) &&
        this.current.kind !== TokenKind.Identifier
      ) {
        return;
      }
      this.advance();
    }
  }

  // ---- statements ----

  private parseStatement(): Statement {
    switch (this.current.kind) {
      case TokenKind.Qubit:
      case TokenKind.Bit:
        return this.parseDeclaration();
      case TokenKind.Const:
        return this.parseConstDeclaration();
      case TokenKind.Measure:
        return this.parseMeasure();
      case TokenKind.Reset:
        return this.parseReset();
      case TokenKind.Barrier:
        return this.parseBarrier();
      case TokenKind.Identifier:
        return this.parseGateApplication();
      default:
        this.fail(
          this.atEnd() ? ErrorCode.UnexpectedEndOfInput : ErrorCode.UnexpectedToken,
          `Expected a statement, found ${describeToken(this.current)}`,
          "A statement is a declaration ('qubit', 'bit', 'const'), a gate application, 'measure', 'reset' or 'barrier'.",
        );
    }
  }

  /** `qubit alice;` | `qubit[3] q;` | `bit c;` | `bit[2] c;` */
  private parseDeclaration(): Statement {
    const keyword = this.advance();
    const isQubit = keyword.kind === TokenKind.Qubit;

    let size: Expression | undefined;
    if (this.match(TokenKind.LBracket)) {
      if (this.check(TokenKind.RBracket)) {
        this.fail(
          ErrorCode.ExpectedRegisterSize,
          'Expected a register size inside the brackets',
          `Write ${isQubit ? 'qubit' : 'bit'}[3] name; for a three-element register, or drop the brackets for a single value.`,
        );
      }
      size = this.parseExpression();
      this.expect(
        TokenKind.RBracket,
        ErrorCode.ExpectedCloseBracket,
        "']' to close the register size",
      );
    }

    const name = this.expect(
      TokenKind.Identifier,
      ErrorCode.ExpectedIdentifier,
      'a name for the declaration',
      `Write ${isQubit ? 'qubit alice;' : 'bit result;'}`,
    );
    const semi = this.expectSemicolon();

    const base = {
      name: name.text,
      nameSpan: name.span,
      span: mergeSpans(keyword.span, semi.span),
    };
    return isQubit
      ? { kind: 'QubitDeclaration', ...base, ...(size ? { size } : {}) }
      : { kind: 'BitDeclaration', ...base, ...(size ? { size } : {}) };
  }

  /** `const theta = pi / 4;` */
  private parseConstDeclaration(): Statement {
    const keyword = this.advance();
    const name = this.expect(
      TokenKind.Identifier,
      ErrorCode.ExpectedIdentifier,
      'a name for the constant',
      'Write const theta = pi / 4;',
    );
    this.expect(TokenKind.Equals, ErrorCode.UnexpectedToken, "'=' after the constant name");
    const value = this.parseExpression();
    const semi = this.expectSemicolon();
    return {
      kind: 'ConstDeclaration',
      name: name.text,
      nameSpan: name.span,
      value,
      span: mergeSpans(keyword.span, semi.span),
    };
  }

  /** `h q;` `cx a, b;` `rx(pi/2) q;` */
  private parseGateApplication(): Statement {
    const gate = this.advance();

    const params: Expression[] = [];
    let paramListSpan: SourceSpan | undefined;
    if (this.check(TokenKind.LParen)) {
      const open = this.advance();
      if (!this.check(TokenKind.RParen)) {
        params.push(this.parseExpression());
        while (this.match(TokenKind.Comma)) params.push(this.parseExpression());
      }
      const close = this.expect(
        TokenKind.RParen,
        ErrorCode.UnbalancedParenthesis,
        "')' to close the parameter list",
        'Every opening parenthesis needs a matching closing parenthesis.',
      );
      paramListSpan = mergeSpans(open.span, close.span);
    }

    const operands: OperandRef[] = [this.parseOperand()];
    while (this.match(TokenKind.Comma)) operands.push(this.parseOperand());
    const semi = this.expectSemicolon();

    return {
      kind: 'GateApplication',
      gate: gate.text,
      gateSpan: gate.span,
      params,
      ...(paramListSpan ? { paramListSpan } : {}),
      operands,
      span: mergeSpans(gate.span, semi.span),
    };
  }

  /** `measure q -> c;` */
  private parseMeasure(): Statement {
    const keyword = this.advance();
    const qubit = this.parseOperand();
    this.expect(
      TokenKind.Arrow,
      ErrorCode.ExpectedArrow,
      "'->' between the qubit and the classical bit",
      'Write measure alice -> result;',
    );
    const target = this.parseOperand();
    const semi = this.expectSemicolon();
    return {
      kind: 'MeasureStatement',
      qubit,
      target,
      span: mergeSpans(keyword.span, semi.span),
    };
  }

  /** `reset q;` */
  private parseReset(): Statement {
    const keyword = this.advance();
    const qubit = this.parseOperand();
    const semi = this.expectSemicolon();
    return { kind: 'ResetStatement', qubit, span: mergeSpans(keyword.span, semi.span) };
  }

  /** `barrier;` | `barrier a, b;` */
  private parseBarrier(): Statement {
    const keyword = this.advance();
    const qubits: OperandRef[] = [];
    if (!this.check(TokenKind.Semicolon)) {
      qubits.push(this.parseOperand());
      while (this.match(TokenKind.Comma)) qubits.push(this.parseOperand());
    }
    const semi = this.expectSemicolon();
    return { kind: 'BarrierStatement', qubits, span: mergeSpans(keyword.span, semi.span) };
  }

  private expectSemicolon(): Token {
    return this.expect(
      TokenKind.Semicolon,
      ErrorCode.ExpectedSemicolon,
      "';' at the end of the statement",
      'Every QForge statement ends with a semicolon.',
    );
  }

  /** `name` | `name[expr]` */
  private parseOperand(): OperandRef {
    const name = this.expect(
      TokenKind.Identifier,
      ErrorCode.ExpectedIdentifier,
      'a qubit or bit name',
      'Operands are names you declared earlier, optionally indexed as q[0].',
    );
    let index: Expression | undefined;
    let end = name.span;
    if (this.match(TokenKind.LBracket)) {
      index = this.parseExpression();
      end = this.expect(
        TokenKind.RBracket,
        ErrorCode.ExpectedCloseBracket,
        "']' to close the index",
      ).span;
    }
    return {
      kind: 'OperandRef',
      name: name.text,
      nameSpan: name.span,
      ...(index ? { index } : {}),
      span: mergeSpans(name.span, end),
    };
  }

  // ---- expressions (Pratt) ----

  parseExpression(minPrecedence = 1): Expression {
    let left = this.parsePrefix();

    for (;;) {
      const precedence = BINARY_PRECEDENCE[this.current.kind];
      if (precedence === undefined || precedence < minPrecedence) break;
      const operator = this.advance();
      const nextMin = RIGHT_ASSOCIATIVE.has(operator.kind) ? precedence : precedence + 1;
      const right = this.parseExpression(nextMin);
      left = {
        kind: 'BinaryExpr',
        operator: operator.text as BinaryOperator,
        left,
        right,
        span: mergeSpans(left.span, right.span),
      };
    }

    return left;
  }

  private parsePrefix(): Expression {
    if (this.check(TokenKind.Plus) || this.check(TokenKind.Minus)) {
      const operator = this.advance();
      const operand = this.parseExpression(UNARY_PRECEDENCE);
      return {
        kind: 'UnaryExpr',
        operator: operator.text as UnaryOperator,
        operand,
        span: mergeSpans(operator.span, operand.span),
      };
    }

    const token = this.current;
    switch (token.kind) {
      case TokenKind.Number:
        this.advance();
        return {
          kind: 'NumberLiteral',
          value: token.value ?? Number(token.text),
          span: token.span,
        };
      case TokenKind.Identifier:
        this.advance();
        return { kind: 'IdentifierExpr', name: token.text, span: token.span };
      case TokenKind.LParen: {
        const open = this.advance();
        const inner = this.parseExpression();
        const close = this.expect(
          TokenKind.RParen,
          ErrorCode.UnbalancedParenthesis,
          "')' to close the group",
          'Every opening parenthesis needs a matching closing parenthesis.',
        );
        return { kind: 'GroupExpr', inner, span: mergeSpans(open.span, close.span) };
      }
      default:
        this.fail(
          this.atEnd() ? ErrorCode.UnexpectedEndOfInput : ErrorCode.ExpectedExpression,
          `Expected an expression, found ${describeToken(token)}`,
          'Expressions are numbers, named constants such as pi, and the operators + - * / ^.',
        );
    }
  }

  get collected(): readonly Diagnostic[] {
    return this.diagnostics;
  }
}

/** Tokenize and parse `source`, returning the AST plus all diagnostics. */
export function parse(source: string): ParseResult {
  const lex = tokenize(source);
  const parser = new Parser(lex.tokens);
  const program = parser.parseProgram();
  return {
    program,
    tokens: lex.tokens,
    allTokens: lex.allTokens,
    diagnostics: [...lex.diagnostics, ...parser.collected],
  };
}

/** Parse a bare expression. Used by tests and the CLI's angle evaluator. */
export function parseExpressionOnly(source: string): {
  expression: Expression | undefined;
  diagnostics: readonly Diagnostic[];
} {
  const lex = tokenize(source);
  const parser = new Parser(lex.tokens);
  try {
    const expression = parser.parseExpression();
    return { expression, diagnostics: [...lex.diagnostics, ...parser.collected] };
  } catch {
    return { expression: undefined, diagnostics: [...lex.diagnostics, ...parser.collected] };
  }
}
