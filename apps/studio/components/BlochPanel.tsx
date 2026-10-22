'use client';

import type { Statevector } from '@qforge/simulator';
import { signed } from '../lib/format';

export interface BlochPanelProps {
  readonly state: Statevector | undefined;
  readonly labels: readonly string[];
}

/**
 * Per-qubit Bloch vectors, computed from each qubit's reduced density matrix.
 *
 * The honest part: a Bloch sphere describes a *single* qubit's state, and a
 * qubit entangled with others does not have one. Rather than draw a misleading
 * arrow on a unit sphere anyway, this panel computes the real reduced density
 * matrix, reports the vector's length, and says plainly when the qubit is mixed.
 * For a Bell pair both qubits come out at length 0 - the centre of the sphere -
 * which is the correct and instructive answer.
 */
export function BlochPanel({ state, labels }: BlochPanelProps) {
  if (!state || state.qubitCount === 0) {
    return (
      <div className="qf-empty">Run or step the program to see per-qubit Bloch vectors.</div>
    );
  }

  const rows = Array.from({ length: state.qubitCount }, (_, qubit) => ({
    qubit,
    label: labels[qubit] ?? `q${qubit}`,
    ...state.blochVector(qubit),
  }));

  return (
    <div>
      <table className="qf-table">
        <thead>
          <tr>
            <th scope="col">Qubit</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              x
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              y
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              z
            </th>
            <th scope="col" style={{ textAlign: 'right' }}>
              |r|
            </th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pure = row.length > 1 - 1e-9;
            const maximallyMixed = row.length < 1e-9;
            return (
              <tr key={row.qubit}>
                <td>{row.label}</td>
                <td data-numeric="">{signed(row.x)}</td>
                <td data-numeric="">{signed(row.y)}</td>
                <td data-numeric="">{signed(row.z)}</td>
                <td data-numeric="">{signed(row.length)}</td>
                <td
                  style={{
                    color: pure
                      ? 'var(--color-success)'
                      : maximallyMixed
                        ? 'var(--color-phase)'
                        : 'var(--color-warning)',
                  }}
                >
                  {pure
                    ? 'pure'
                    : maximallyMixed
                      ? 'maximally mixed (entangled)'
                      : `mixed, purity ${row.purity.toFixed(4)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        className="qf-empty"
        style={{
          paddingTop: 10,
          paddingBottom: 12,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        A Bloch vector of length 1 means the qubit has a pure state of its own. Length 0 means
        it is maximally mixed: all its information lives in correlations with other qubits, and
        no single-qubit picture describes it. Both halves of a Bell pair sit at length 0.
      </div>
    </div>
  );
}
