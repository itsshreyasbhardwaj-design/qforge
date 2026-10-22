'use client';

import { useMemo } from 'react';
import type { Statevector } from '@qforge/simulator';
import { complexText, percent, signed } from '../lib/format';

export interface StateInspectorProps {
  readonly state: Statevector | undefined;
  readonly probabilities: Float64Array | undefined;
  /** Basis indices whose amplitude changed at the current step, to highlight. */
  readonly changed?: readonly number[];
  /** Hide rows whose probability is below this. */
  readonly threshold?: number;
}

/**
 * Amplitude and probability table for the current state.
 *
 * Shows amplitude *and* probability side by side on purpose. The relationship
 * between them -- probability is the squared modulus, so 0.7071 becomes 0.5 --
 * is the single most useful thing to internalise about a statevector, and
 * putting the two columns next to each other teaches it better than prose.
 *
 * Negative and complex amplitudes are shown in full rather than as magnitudes,
 * because the sign is exactly what makes interference work. Compare the
 * `interference.qf` example before and after its Z gate.
 */
export function StateInspector({
  state,
  probabilities,
  changed,
  threshold = 1e-10,
}: StateInspectorProps) {
  const changedSet = useMemo(() => new Set(changed ?? []), [changed]);

  if (!state || !probabilities) {
    return <div className="qf-empty">Run or step the program to see its state.</div>;
  }

  const rows: Array<{ index: number; label: string; re: number; im: number; p: number }> = [];
  for (let i = 0; i < state.size; i++) {
    const p = probabilities[i] ?? 0;
    const amplitude = state.amplitude(i);
    if (p <= threshold && Math.hypot(amplitude.re, amplitude.im) <= threshold) continue;
    rows.push({ index: i, label: state.basisLabel(i), re: amplitude.re, im: amplitude.im, p });
  }

  const norm = state.norm();

  return (
    <div>
      <table className="qf-table">
        <thead>
          <tr>
            <th scope="col">Basis</th>
            <th scope="col">Amplitude</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Probability
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ color: 'var(--color-text-faint)' }}>
                every amplitude is below the display threshold
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const highlighted = changedSet.has(row.index);
              return (
                <tr key={row.index}>
                  <td
                    style={{
                      color: highlighted ? 'var(--color-accent)' : 'var(--color-text)',
                      fontWeight: highlighted ? 600 : 400,
                    }}
                  >
                    {/* The arrow marks a change, so the signal is not colour alone. */}
                    {highlighted ? '→ ' : '  '}
                    {row.label}
                  </td>
                  <td
                    style={{
                      color: row.re < 0 || row.im !== 0 ? 'var(--color-phase)' : 'inherit',
                    }}
                  >
                    {complexText(row.re, row.im)}
                  </td>
                  <td data-numeric="">{signed(row.p, 6)}</td>
                  <td data-numeric="">{percent(row.p)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div
        style={{
          padding: '8px 10px',
          fontSize: 11.5,
          color: 'var(--color-text-faint)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span>
          {state.qubitCount} qubit{state.qubitCount === 1 ? '' : 's'}, {state.size} amplitudes
        </span>
        <span>
          norm {norm.toFixed(12)}
          {Math.abs(norm - 1) > 1e-9 ? ' (drifted)' : ''}
        </span>
        <span>
          rows shown {rows.length} of {state.size}
        </span>
      </div>
    </div>
  );
}
