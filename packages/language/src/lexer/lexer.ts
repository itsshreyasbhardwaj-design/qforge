import { TokenKind, KEYWORDS, type Token } from './token.js';
import { span, type SourceSpan } from '../diagnostics/span.js';
import { ErrorCode } from '../diagnostics/codes.js';
import { error, type Diagnostic } from '../diagnostics/diagnostic.js';

/** Hard cap on source length, enforced before scanning. See docs/limits. */
export const MAX_SOURCE_LENGTH = 256 * 1024;

export interface LexResult {
  /** Tokens with trivia removed, always terminated by a single EndOfFile token. */
  readonly tokens: readonly Token[];
  /** Every token including whitespace and comments, in source order. */
  readonly allTokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

/**
 * Hand-written single-pass lexer.
 *
 * Design notes:
 *  - Line/column are tracked incrementally while scanning rather than
 *    recomputed per token, so tokenisation stays O(n) in the source length.
 *  - Invalid characters produce an `Invalid` token *and* a diagnostic; the
 *    scanner then advances one character and keeps going, so a stray symbol
 *    does not hide the rest of the file's errors.
 *  - Trivia is kept in `allTokens` for the studio's token inspector; the
 *    parser consumes the filtered `tokens` list.
 */
export function tokenize(source: string): LexResult {
  const diagnostics: Diagnostic[] = [];
  const allTokens: Token[] = [];

  if (source.length > MAX_SOURCE_LENGTH) {
    const s = span(0, 1, 1, 1);
    diagnostics.push(
      error(
        ErrorCode.SourceTooLarge,
        `Source is ${source.length} characters; the limit is ${MAX_SOURCE_LENGTH}`,
        s,
        'Split the program into smaller files.',
      ),
    );
    return {
      tokens: [{ kind: TokenKind.EndOfFile, text: '', span: s }],
      allTokens: [],
      diagnostics,
    };
  }

  let pos = 0;
  let line = 1;
  let col = 1;

  const at = (offset = 0): string => source[pos + offset] ?? '';

  /** Advance `n` characters, maintaining line/column counters. */
  const advance = (n = 1): void => {
    for (let i = 0; i < n && pos < source.length; i++) {
      if (source[pos] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }
  };

  const push = (
    kind: TokenKind,
    start: number,
    startLine: number,
    startCol: number,
    value?: number,
  ): void => {
    const s: SourceSpan = {
      start,
      end: pos,
      line: startLine,
      column: startCol,
      endLine: line,
      endColumn: col,
    };
    const token: Token =
      value === undefined
        ? { kind, text: source.slice(start, pos), span: s }
        : { kind, text: source.slice(start, pos), span: s, value };
    allTokens.push(token);
  };

  while (pos < source.length) {
    const start = pos;
    const startLine = line;
    const startCol = col;
    const c = at();

    // --- whitespace ---
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      while (pos < source.length && /[ \t\r\n]/.test(at())) advance();
      push(TokenKind.Whitespace, start, startLine, startCol);
      continue;
    }

    // --- comments ---
    if (c === '/' && at(1) === '/') {
      while (pos < source.length && at() !== '\n') advance();
      push(TokenKind.LineComment, start, startLine, startCol);
      continue;
    }
    if (c === '/' && at(1) === '*') {
      advance(2);
      let closed = false;
      while (pos < source.length) {
        if (at() === '*' && at(1) === '/') {
          advance(2);
          closed = true;
          break;
        }
        advance();
      }
      push(TokenKind.BlockComment, start, startLine, startCol);
      if (!closed) {
        diagnostics.push(
          error(
            ErrorCode.UnterminatedBlockComment,
            'Unterminated block comment',
            span(start, start + 2, startLine, startCol),
            "Close the comment with '*/'.",
          ),
        );
      }
      continue;
    }

    // --- numbers: 12, 1.5, .5, 1e-3, 2.5E+4 ---
    if (isDigit(c) || (c === '.' && isDigit(at(1)))) {
      let sawDot = false;
      let sawExp = false;
      let malformed = false;
      while (pos < source.length) {
        const d = at();
        if (isDigit(d)) {
          advance();
        } else if (d === '.' && !sawDot && !sawExp) {
          sawDot = true;
          advance();
        } else if ((d === 'e' || d === 'E') && !sawExp) {
          // Only treat as an exponent if digits actually follow.
          const next = at(1);
          const afterSign = at(2);
          if (isDigit(next) || ((next === '+' || next === '-') && isDigit(afterSign))) {
            sawExp = true;
            advance(isDigit(next) ? 1 : 2);
          } else {
            malformed = true;
            advance();
            break;
          }
        } else {
          break;
        }
      }
      // A number immediately followed by identifier characters is malformed
      // (`2pi` is not an implicit product in QForge).
      if (!malformed && isIdentPart(at())) {
        malformed = true;
        while (pos < source.length && isIdentPart(at())) advance();
      }
      const text = source.slice(start, pos);
      const parsed = Number(text);
      const s = span(start, pos, startLine, startCol, line, col);
      if (malformed || !Number.isFinite(parsed)) {
        diagnostics.push(
          error(
            malformed ? ErrorCode.MalformedNumber : ErrorCode.NumberOutOfRange,
            malformed
              ? `Malformed number literal '${text}'`
              : `Number literal '${text}' is not a finite value`,
            s,
            malformed
              ? 'Write numbers as 1, 1.5, .5 or 1e-3; use * for multiplication.'
              : 'Use a value within the double-precision range.',
          ),
        );
        push(TokenKind.Invalid, start, startLine, startCol);
      } else {
        push(TokenKind.Number, start, startLine, startCol, parsed);
      }
      continue;
    }

    // --- identifiers and keywords ---
    if (isIdentStart(c)) {
      while (pos < source.length && isIdentPart(at())) advance();
      const text = source.slice(start, pos);
      push(KEYWORDS[text] ?? TokenKind.Identifier, start, startLine, startCol);
      continue;
    }

    // --- two-character operators, matched before their one-character prefixes ---
    if (c === '-' && at(1) === '>') {
      advance(2);
      push(TokenKind.Arrow, start, startLine, startCol);
      continue;
    }
    if (c === '=' && at(1) === '=') {
      advance(2);
      push(TokenKind.EqualEqual, start, startLine, startCol);
      continue;
    }
    if (c === '!' && at(1) === '=') {
      advance(2);
      push(TokenKind.BangEqual, start, startLine, startCol);
      continue;
    }

    // --- single-character punctuation ---
    const single: Record<string, TokenKind> = {
      ';': TokenKind.Semicolon,
      ',': TokenKind.Comma,
      '(': TokenKind.LParen,
      ')': TokenKind.RParen,
      '[': TokenKind.LBracket,
      ']': TokenKind.RBracket,
      '{': TokenKind.LBrace,
      '}': TokenKind.RBrace,
      '+': TokenKind.Plus,
      '-': TokenKind.Minus,
      '*': TokenKind.Star,
      '/': TokenKind.Slash,
      '^': TokenKind.Caret,
      '=': TokenKind.Equals,
    };
    const kind = single[c];
    if (kind) {
      advance();
      push(kind, start, startLine, startCol);
      continue;
    }

    // --- anything else: report and resynchronise ---
    advance();
    push(TokenKind.Invalid, start, startLine, startCol);
    diagnostics.push(
      error(
        ErrorCode.InvalidCharacter,
        `Invalid character '${c}' in source`,
        span(start, pos, startLine, startCol),
        'Remove the character. QForge uses ASCII identifiers, numbers and the operators + - * / ^.',
      ),
    );
  }

  allTokens.push({
    kind: TokenKind.EndOfFile,
    text: '',
    span: span(source.length, source.length, line, col),
  });

  const tokens = allTokens.filter(
    (t) =>
      t.kind !== TokenKind.Whitespace &&
      t.kind !== TokenKind.LineComment &&
      t.kind !== TokenKind.BlockComment,
  );

  return { tokens, allTokens, diagnostics };
}
