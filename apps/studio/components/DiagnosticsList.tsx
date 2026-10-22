'use client';

import type { Diagnostic } from '@qforge/language';

export interface DiagnosticsListProps {
  readonly diagnostics: readonly Diagnostic[];
  readonly source: string;
  /** Called when the user activates a diagnostic, to move the editor caret. */
  readonly onSelect: (diagnostic: Diagnostic) => void;
}

/** The offending source line with a caret run under the span. */
function Excerpt({ diagnostic, source }: { diagnostic: Diagnostic; source: string }) {
  const line = source.split('\n')[diagnostic.span.line - 1] ?? '';
  const column = Math.max(1, diagnostic.span.column);
  const width =
    diagnostic.span.endLine === diagnostic.span.line
      ? Math.max(1, diagnostic.span.endColumn - column)
      : Math.max(1, line.length - column + 1);

  return (
    <pre
      className="qf-mono"
      style={{
        margin: '5px 0 0',
        padding: '6px 8px',
        background: 'var(--color-surface-0)',
        borderRadius: 3,
        color: 'var(--color-text-muted)',
        overflowX: 'auto',
        lineHeight: 1.45,
      }}
    >
      {line}
      {'\n'}
      <span style={{ color: 'var(--color-danger)' }}>
        {' '.repeat(column - 1)}
        {'^'.repeat(width)}
      </span>
    </pre>
  );
}

export function DiagnosticsList({ diagnostics, source, onSelect }: DiagnosticsListProps) {
  if (diagnostics.length === 0) {
    return <div className="qf-empty">No diagnostics. The program compiles.</div>;
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {diagnostics.map((diagnostic, index) => {
        const isError = diagnostic.severity === 'error';
        const colour = isError ? 'var(--color-danger)' : 'var(--color-warning)';
        return (
          <li
            key={`${diagnostic.code}-${diagnostic.span.start}-${index}`}
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <button
              type="button"
              onClick={() => onSelect(diagnostic)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                background: 'transparent',
                border: 'none',
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <div
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
              >
                {/* The severity is spelled out, not only colour-coded. */}
                <span style={{ color: colour, fontWeight: 600, fontSize: 11.5 }}>
                  {diagnostic.severity}
                </span>
                <span className="qf-mono" style={{ color: colour, fontSize: 11.5 }}>
                  {diagnostic.code}
                </span>
                <span style={{ color: 'var(--color-text-faint)', fontSize: 11.5 }}>
                  line {diagnostic.span.line}, column {diagnostic.span.column}
                </span>
              </div>
              <div style={{ marginTop: 3 }}>{diagnostic.message}</div>
              <Excerpt diagnostic={diagnostic} source={source} />
              {diagnostic.related?.map((related, i) => (
                <div
                  key={i}
                  style={{ marginTop: 5, color: 'var(--color-text-faint)', fontSize: 12 }}
                >
                  note: {related.message} (line {related.span.line})
                </div>
              ))}
              {diagnostic.hint ? (
                <div style={{ marginTop: 5, color: 'var(--color-accent)', fontSize: 12.5 }}>
                  {diagnostic.hint}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
