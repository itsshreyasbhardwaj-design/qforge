import { tokenize } from '../lexer/lexer.js';
import { TokenKind, type Token } from '../lexer/token.js';
import { hasErrors, type Diagnostic } from '../diagnostics/diagnostic.js';

export interface FormatOptions {
  /** Spaces per indent level. QForge v0.1 has no nesting, so this is unused
   * today and exists so the option does not have to be added later. */
  readonly indent?: number;
  /** Keep at most this many consecutive blank lines. Default 1. */
  readonly maxBlankLines?: number;
}

export interface FormatResult {
  readonly text: string;
  /** Diagnostics from tokenising. Formatting is refused when any are errors. */
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
}

/**
 * Canonical formatter for QForge source.
 *
 * ## Why this works on tokens, not the AST
 *
 * Printing from the AST is the usual approach and would be shorter, but the
 * QForge AST deliberately does not retain comments — nothing in the compiler
 * needs them. A formatter that silently deleted every comment would be worse
 * than no formatter, so this one walks the full token stream (which *does*
 * retain comments and their positions) and rewrites only the whitespace
 * between tokens.
 *
 * The rules:
 *   - one statement per line, broken after each `;`
 *   - a single space after `,` and around binary operators
 *   - no space inside `(...)` or `[...]`, and none before `[`
 *   - a line comment stays trailing if it was trailing, otherwise gets its
 *     own line
 *   - runs of blank lines collapse to one, so the author's grouping survives
 *
 * The formatter refuses to touch source with lexical errors rather than
 * guessing, because reformatting broken input can move the error.
 */
export function formatSource(source: string, options: FormatOptions = {}): FormatResult {
  const maxBlankLines = options.maxBlankLines ?? 1;
  const { allTokens, diagnostics } = tokenize(source);

  if (hasErrors(diagnostics)) {
    return { text: source, diagnostics, ok: false };
  }

  const significant = allTokens.filter((t) => t.kind !== TokenKind.Whitespace);
  const out: string[] = [];
  let line = '';
  let blankRun = 0;

  const flush = (): void => {
    if (line.length > 0) {
      out.push(line.trimEnd());
      line = '';
      blankRun = 0;
    }
  };

  /** Start a line at the current indent level. */
  const openLine = (): void => {
    if (line.length === 0) line = indentUnit.repeat(indentLevel);
  };

  const addBlankLine = (): void => {
    flush();
    if (out.length === 0) return; // no leading blank lines
    if (blankRun >= maxBlankLines) return;
    out.push('');
    blankRun++;
  };

  const BINARY_OPERATORS = new Set<TokenKind>([
    TokenKind.Plus,
    TokenKind.Minus,
    TokenKind.Star,
    TokenKind.Slash,
    TokenKind.Caret,
    TokenKind.EqualEqual,
    TokenKind.BangEqual,
  ]);

  const indentUnit = ' '.repeat(options.indent ?? 2);
  let indentLevel = 0;

  /**
   * Should a space be inserted between `previous` and `next`?
   * `previousIndex` locates `previous` in `significant`, so the unary/binary
   * decision can look one token further back without a search.
   */
  const needsSpace = (
    previous: Token | undefined,
    previousIndex: number,
    next: Token,
  ): boolean => {
    if (!previous) return false;

    // Never a space before these.
    if (
      next.kind === TokenKind.Semicolon ||
      next.kind === TokenKind.Comma ||
      next.kind === TokenKind.RParen ||
      next.kind === TokenKind.RBracket ||
      next.kind === TokenKind.LBracket
    ) {
      return false;
    }
    // `if (` keeps its space, unlike a gate's parameter list.
    if (next.kind === TokenKind.LParen && previous.kind === TokenKind.If) return true;
    // Never a space after these.
    if (previous.kind === TokenKind.LParen || previous.kind === TokenKind.LBracket)
      return false;

    // A gate's parameter list hugs the mnemonic: `rx(pi/2)`, not `rx (pi/2)`.
    if (next.kind === TokenKind.LParen && previous.kind === TokenKind.Identifier) return false;

    // Unary plus/minus hugs its operand. It is unary when what precedes it is
    // an operator, an opening bracket, a comma, or nothing.
    if (previous.kind === TokenKind.Plus || previous.kind === TokenKind.Minus) {
      const beforePrevious = significant[previousIndex - 1];
      const prefixPosition =
        !beforePrevious ||
        beforePrevious.kind === TokenKind.LParen ||
        beforePrevious.kind === TokenKind.LBracket ||
        beforePrevious.kind === TokenKind.Comma ||
        beforePrevious.kind === TokenKind.Equals ||
        BINARY_OPERATORS.has(beforePrevious.kind);
      if (prefixPosition) return false;
    }

    return true;
  };

  let previous: Token | undefined;
  let previousIndex = -1;
  let previousLine = 0;

  for (let index = 0; index < significant.length; index++) {
    const token = significant[index]!;
    if (token.kind === TokenKind.EndOfFile) break;

    const isComment =
      token.kind === TokenKind.LineComment || token.kind === TokenKind.BlockComment;

    // Preserve the author's blank-line grouping.
    if (previous && token.span.line - previousLine > 1) {
      addBlankLine();
    }

    if (isComment) {
      const trailing = previous !== undefined && token.span.line === previousLine;
      if (trailing && line.length > 0) {
        line += `  ${token.text.trimEnd()}`;
        flush();
      } else if (trailing && out.length > 0) {
        // The statement's `;` already flushed its line, so re-open it and
        // append rather than pushing the comment onto a line of its own.
        out[out.length - 1] = `${out[out.length - 1]}  ${token.text.trimEnd()}`;
        blankRun = 0;
      } else {
        flush();
        out.push(token.text.trimEnd());
        blankRun = 0;
      }
      previous = token;
      previousIndex = index;
      previousLine = token.span.endLine;
      continue;
    }

    // A space is only ever inserted *between* tokens, never at the start of a
    // line: `line` being empty means this token begins a fresh line.
    // A closing brace dedents before it is written, so it lines up with `if`.
    if (token.kind === TokenKind.RBrace) {
      flush();
      indentLevel = Math.max(0, indentLevel - 1);
    }

    openLine();
    if (
      line.length > indentUnit.repeat(indentLevel).length &&
      needsSpace(previous, previousIndex, token)
    )
      line += ' ';
    line += token.text;
    previous = token;
    previousIndex = index;
    previousLine = token.span.endLine;

    if (token.kind === TokenKind.LBrace) {
      flush();
      indentLevel++;
    } else if (token.kind === TokenKind.RBrace) {
      flush();
    } else if (token.kind === TokenKind.Semicolon) {
      // A single-statement `if` body keeps the whole statement on one line,
      // so only dedent for the brace form.
      flush();
    }
  }

  flush();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  return { text: out.length ? `${out.join('\n')}\n` : '', diagnostics, ok: true };
}

/** True when `source` is already canonically formatted. */
export function isFormatted(source: string, options: FormatOptions = {}): boolean {
  const result = formatSource(source, options);
  return result.ok && result.text === source;
}
