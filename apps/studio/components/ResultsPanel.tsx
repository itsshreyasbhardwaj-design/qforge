'use client';

import { useMemo } from 'react';
import {
  circuitDepth,
  gateCount,
  hasClassicalControl,
  opcodeHistogram,
  type IrModule,
} from '@qforge/compiler';
import type { ExecutionResult } from '@qforge/simulator';
import { percent } from '../lib/format';

export interface CountsTableProps {
  readonly result: ExecutionResult | undefined;
  readonly clbitLabels: readonly string[];
}

/**
 * Measurement counts from the most recent run.
 *
 * Shows frequency alongside the raw count, because the frequency is what
 * approaches the theoretical probability and the count is what was actually
 * observed. For a Bell state at 1000 shots the two columns read something like
 * 508 and 50.8%, which makes the sampling error visible rather than hiding it
 * behind a rounded percentage.
 */
export function CountsTable({ result, clbitLabels }: CountsTableProps) {
  if (!result) {
    return <div className="qf-empty">Run the program to collect measurement counts.</div>;
  }

  const rows = [...result.counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  if (rows.length === 0 || (rows.length === 1 && rows[0]![0] === '')) {
    return (
      <div className="qf-empty">
        This program declares no classical bits, so there is nothing to count. Add a{' '}
        <code className="qf-mono">bit</code> declaration and a{' '}
        <code className="qf-mono">measure</code> statement.
      </div>
    );
  }

  // Register layout reminder: bit 0 is the rightmost character of a key.
  const header = clbitLabels.length > 0 ? [...clbitLabels].reverse().join(' ') : '';

  return (
    <div>
      <table className="qf-table">
        <thead>
          <tr>
            <th scope="col">Register</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Count
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Frequency
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, count]) => (
            <tr key={key}>
              <td>{key || '(none)'}</td>
              <td data-numeric="">{count.toLocaleString()}</td>
              <td data-numeric="">{percent(count / result.shots)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="qf-empty"
        style={{ borderTop: '1px solid var(--color-border)', paddingTop: 9, paddingBottom: 10 }}
      >
        Register digits are written most significant bit first
        {header ? (
          <>
            , so the columns are <code className="qf-mono">{header}</code>
          </>
        ) : null}
        . Classical bit 0 is the rightmost character, and a bit that is never measured reads 0.
      </div>
    </div>
  );
}

export interface CircuitStatsProps {
  readonly module: IrModule;
  readonly optimizedFrom?: IrModule;
}

/** Gate statistics, and the before/after comparison when optimisation ran. */
export function CircuitStats({ module, optimizedFrom }: CircuitStatsProps) {
  const histogram = useMemo(() => opcodeHistogram(module), [module]);
  const entries = Object.entries(histogram).sort(([a], [b]) => a.localeCompare(b));

  const stat = (label: string, value: string | number, was?: string | number) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--color-text-faint)' }}>{label}</span>
      <span className="qf-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {was !== undefined && was !== value ? (
          <>
            <span style={{ color: 'var(--color-text-faint)' }}>{was}</span>
            <span style={{ color: 'var(--color-text-faint)' }}> &rarr; </span>
            <span style={{ color: 'var(--color-success)' }}>{value}</span>
          </>
        ) : (
          value
        )}
      </span>
    </div>
  );

  return (
    <div style={{ padding: '10px 12px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
        {stat('qubits', module.qubitCount)}
        {stat('classical bits', module.clbitCount)}
        {stat('instructions', module.instructions.length, optimizedFrom?.instructions.length)}
        {stat('gates', gateCount(module), optimizedFrom ? gateCount(optimizedFrom) : undefined)}
        {stat(
          'depth',
          circuitDepth(module),
          optimizedFrom ? circuitDepth(optimizedFrom) : undefined,
        )}
        {stat('classical control', hasClassicalControl(module) ? 'yes' : 'no')}
      </div>

      {hasClassicalControl(module) ? (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
          This circuit has predicated instructions, so every shot is replayed individually
          rather than sampled from one final statevector &mdash; the branch taken depends on
          what was measured.
        </div>
      ) : null}

      <div>
        <div className="qf-label">Opcode counts</div>
        {entries.length === 0 ? (
          <div style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>no instructions</div>
        ) : (
          <div style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
            {entries.map(([opcode, count]) => (
              <div key={opcode} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="qf-mono">{opcode}</span>
                <span className="qf-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
