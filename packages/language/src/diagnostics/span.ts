/**
 * A half-open range `[start, end)` of UTF-16 code units in the source text,
 * carried alongside 1-based line/column coordinates for human-facing output.
 *
 * Every token and every AST node owns a span, so a diagnostic raised at any
 * compilation stage can be rendered against the original source.
 */
export interface SourceSpan {
  /** Inclusive byte offset (UTF-16 code units) of the first character. */
  readonly start: number;
  /** Exclusive offset one past the last character. */
  readonly end: number;
  /** 1-based line of `start`. */
  readonly line: number;
  /** 1-based column of `start`, counted in UTF-16 code units. */
  readonly column: number;
  /** 1-based line of the last character (equals `line` for single-line spans). */
  readonly endLine: number;
  /** 1-based column one past the last character. */
  readonly endColumn: number;
}

export function span(
  start: number,
  end: number,
  line: number,
  column: number,
  endLine = line,
  endColumn = column + (end - start),
): SourceSpan {
  return { start, end, line, column, endLine, endColumn };
}

/** Smallest span covering both inputs. Used to give parent AST nodes a full extent. */
export function mergeSpans(a: SourceSpan, b: SourceSpan): SourceSpan {
  const first = a.start <= b.start ? a : b;
  const last = a.end >= b.end ? a : b;
  return {
    start: first.start,
    end: last.end,
    line: first.line,
    column: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
  };
}
