'use client';

import type { Statevector } from '@qforge/simulator';
import { percent } from '../lib/format';

export interface ProbabilityChartProps {
  readonly state: Statevector | undefined;
  readonly probabilities: Float64Array | undefined;
  readonly threshold?: number;
  /** Heading describing what the bars represent. */
  readonly caption?: string;
}

/**
 * Horizontal bar chart of basis-state probabilities.
 *
 * Built from divs rather than a charting library: there is one chart in the
 * whole application, and the numeric value is printed next to every bar anyway,
 * so the bars are a reading aid rather than the data itself. That also keeps
 * the chart screen-reader friendly, since each row is a labelled table row.
 */
export function ProbabilityChart({
  state,
  probabilities,
  threshold = 1e-6,
  caption,
}: ProbabilityChartProps) {
  if (!state || !probabilities) {
    return <div className="qf-empty">Run the program to see its probability distribution.</div>;
  }

  const rows: Array<{ label: string; p: number }> = [];
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i] ?? 0;
    if (p > threshold) rows.push({ label: state.basisLabel(i), p });
  }
  rows.sort((a, b) => b.p - a.p || a.label.localeCompare(b.label));

  if (rows.length === 0) {
    return <div className="qf-empty">No basis state has probability above the threshold.</div>;
  }

  const max = Math.max(...rows.map((r) => r.p));

  return (
    <div style={{ padding: '10px 12px' }}>
      {caption ? (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', marginBottom: 8 }}>
          {caption}
        </div>
      ) : null}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption className="qf-label" style={{ textAlign: 'left', marginBottom: 6 }}>
          Basis-state probabilities
        </caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="qf-mono"
                style={{
                  textAlign: 'left',
                  fontWeight: 400,
                  padding: '3px 8px 3px 0',
                  whiteSpace: 'nowrap',
                  color: 'var(--color-text-muted)',
                }}
              >
                {row.label}
              </th>
              <td style={{ width: '100%', padding: '3px 8px' }}>
                <div
                  style={{
                    height: 12,
                    background: 'var(--color-surface-3)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(row.p / max) * 100}%`,
                      height: '100%',
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
              </td>
              <td
                className="qf-mono"
                style={{
                  padding: '3px 0',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-text)',
                }}
              >
                {percent(row.p)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
