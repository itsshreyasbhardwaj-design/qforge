import type { SourceSpan } from '../diagnostics/span.js';

/**
 * QForge token kinds. The lexer is total: every character of the input ends up
 * inside exactly one token (including `Invalid`), so nothing is silently dropped.
 */
export const TokenKind = {
  // Literals and names
  Identifier: 'identifier',
  Number: 'number',

  // Keywords
  Qubit: 'qubit',
  Bit: 'bit',
  Measure: 'measure',
  Reset: 'reset',
  Const: 'const',
  Barrier: 'barrier',
  If: 'if',

  // Punctuation and operators
  Semicolon: ';',
  Comma: ',',
  LParen: '(',
  RParen: ')',
  LBracket: '[',
  RBracket: ']',
  LBrace: '{',
  RBrace: '}',
  Arrow: '->',
  Plus: '+',
  Minus: '-',
  Star: '*',
  Slash: '/',
  Caret: '^',
  Equals: '=',
  EqualEqual: '==',
  BangEqual: '!=',

  // Trivia (retained for tooling; the parser skips these)
  LineComment: 'line-comment',
  BlockComment: 'block-comment',
  Whitespace: 'whitespace',

  // Terminals
  Invalid: 'invalid',
  EndOfFile: 'eof',
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

/** Reserved words. Identifiers are matched against this table after scanning. */
export const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  qubit: TokenKind.Qubit,
  bit: TokenKind.Bit,
  measure: TokenKind.Measure,
  reset: TokenKind.Reset,
  const: TokenKind.Const,
  barrier: TokenKind.Barrier,
  if: TokenKind.If,
};

export interface Token {
  readonly kind: TokenKind;
  /** Exact source text of the token, unmodified. */
  readonly text: string;
  readonly span: SourceSpan;
  /** Parsed value for `Number` tokens; absent otherwise. */
  readonly value?: number;
}

export function isTrivia(kind: TokenKind): boolean {
  return (
    kind === TokenKind.Whitespace ||
    kind === TokenKind.LineComment ||
    kind === TokenKind.BlockComment
  );
}

/** Human-readable name used in "expected X, found Y" messages. */
export function describeToken(token: Token): string {
  switch (token.kind) {
    case TokenKind.EndOfFile:
      return 'end of input';
    case TokenKind.Identifier:
      return `identifier '${token.text}'`;
    case TokenKind.Number:
      return `number '${token.text}'`;
    case TokenKind.Invalid:
      return `invalid character '${token.text}'`;
    default:
      return `'${token.text}'`;
  }
}
