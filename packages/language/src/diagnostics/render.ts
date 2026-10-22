import type { Diagnostic } from './diagnostic.js';
import type { SourceSpan } from './span.js';

export interface RenderOptions {
  /** Shown in the location line; defaults to `<source>`. */
  readonly fileName?: string;
  /** Draw the offending line with a caret run under the span. Default true. */
  readonly showSource?: boolean;
}

function lineOf(source: string, lineNumber: number): string {
  // Lines are 1-based; `split` keeps empty trailing lines, which is what we want
  // so that a caret on the final (possibly empty) line still renders.
  return source.split('\n')[lineNumber - 1] ?? '';
}

function caretRun(text: string, span: SourceSpan): string {
  const col = Math.max(1, span.column);
  const sameLine = span.endLine === span.line;
  const endCol = sameLine ? Math.max(col + 1, span.endColumn) : text.length + 1;
  const width = Math.max(1, endCol - col);
  // Preserve tab stops so the caret lines up with the glyphs above it.
  const prefix = text
    .slice(0, col - 1)
    .replace(/[^\t]/g, ' ')
    .padEnd(col - 1, ' ');
  return `${prefix}${'^'.repeat(width)}`;
}

/**
 * Render one diagnostic in the QForge CLI format:
 *
 * ```text
 * error QF202:
 * Unknown qubit 'target'
 *
 * line 6, column 12
 *
 * cx control, target;
 *             ^^^^^^
 *
 * Declare the qubit before using it.
 * ```
 */
export function renderDiagnostic(
  diag: Diagnostic,
  source: string,
  options: RenderOptions = {},
): string {
  const { fileName, showSource = true } = options;
  const out: string[] = [];
  out.push(`${diag.severity} ${diag.code}:`);
  out.push(diag.message);
  out.push('');
  out.push(
    fileName
      ? `${fileName}:${diag.span.line}:${diag.span.column}`
      : `line ${diag.span.line}, column ${diag.span.column}`,
  );
  if (showSource) {
    const text = lineOf(source, diag.span.line);
    out.push('');
    out.push(text);
    out.push(caretRun(text, diag.span));
  }
  for (const rel of diag.related ?? []) {
    out.push('');
    out.push(`  note: ${rel.message} (line ${rel.span.line}, column ${rel.span.column})`);
  }
  if (diag.hint) {
    out.push('');
    out.push(diag.hint);
  }
  return out.join('\n');
}

export function renderDiagnostics(
  diags: readonly Diagnostic[],
  source: string,
  options: RenderOptions = {},
): string {
  return diags.map((d) => renderDiagnostic(d, source, options)).join('\n\n');
}
