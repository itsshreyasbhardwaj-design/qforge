import type { SourceSpan } from './span.js';
import type { ErrorCode } from './codes.js';

export type Severity = 'error' | 'warning';

/**
 * A single compiler message. Diagnostics are data, never thrown: each stage
 * collects them so the studio can underline every problem at once instead of
 * stopping at the first one.
 */
export interface Diagnostic {
  readonly code: ErrorCode;
  readonly severity: Severity;
  /** One line, no trailing period, naming the problem. */
  readonly message: string;
  readonly span: SourceSpan;
  /** Optional second line telling the user what to do about it. */
  readonly hint?: string;
  /** Optional secondary locations, e.g. the earlier declaration of a duplicate. */
  readonly related?: ReadonlyArray<{ readonly span: SourceSpan; readonly message: string }>;
}

export function error(
  code: ErrorCode,
  message: string,
  span: SourceSpan,
  hint?: string,
  related?: Diagnostic['related'],
): Diagnostic {
  return { code, severity: 'error', message, span, hint, related };
}

export function warning(
  code: ErrorCode,
  message: string,
  span: SourceSpan,
  hint?: string,
): Diagnostic {
  return { code, severity: 'warning', message, span, hint };
}

export function hasErrors(diags: readonly Diagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error');
}

/** Sort by source position, then by code, so output order is deterministic. */
export function sortDiagnostics(diags: readonly Diagnostic[]): Diagnostic[] {
  return [...diags].sort((a, b) => a.span.start - b.span.start || a.code.localeCompare(b.code));
}
