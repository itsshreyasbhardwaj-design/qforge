'use client';

import { useMemo, useState } from 'react';
import {
  DEFAULT_PASSES,
  circuitDepth,
  displayAngle,
  gateCount,
  type CompileResult,
  type IrInstruction,
  type IrModule,
} from '@qforge/compiler';

export interface OptimisationExplorerProps {
  readonly compiled: CompileResult | undefined;
  readonly optimize: boolean;
  readonly onEnableOptimise: () => void;
  readonly onReveal: (offset: number) => void;
}

/** One line of the before/after alignment. */
interface DiffRow {
  readonly kind: 'kept' | 'removed' | 'rewritten';
  readonly before?: IrInstruction;
  readonly after?: IrInstruction;
}

function render(instruction: IrInstruction, module: IrModule): string {
  const params = instruction.params.length
    ? `(${instruction.params.map((p) => displayAngle(p)).join(', ')})`
    : '';
  const operands = instruction.qubits.map((q) => `%${q}`).join(', ');
  const guard = instruction.condition ? ` if ${instruction.condition.text}` : '';
  if (instruction.opcode === 'measure') {
    return `measure ${operands} -> $${instruction.clbit ?? 0}${guard}`;
  }
  void module;
  return `${instruction.opcode}${params} ${operands}${guard}`.trim();
}

/**
 * Align the unoptimised and optimised instruction lists.
 *
 * The passes only ever delete instructions or rewrite one in place, never
 * reorder or insert, so a single forward walk is enough: an optimised
 * instruction matches the next unoptimised one with the same opcode and
 * operands, and anything skipped over was removed. That is far easier to read
 * than a general diff, and it is exact for the transformations QForge makes.
 */
function alignModules(before: IrModule, after: IrModule): DiffRow[] {
  const rows: DiffRow[] = [];
  const sameShape = (a: IrInstruction, b: IrInstruction) =>
    a.opcode === b.opcode &&
    a.qubits.length === b.qubits.length &&
    a.qubits.every((q, i) => q === b.qubits[i]) &&
    a.loc.start === b.loc.start;

  let j = 0;
  for (const original of before.instructions) {
    const candidate = after.instructions[j];
    if (candidate && sameShape(original, candidate)) {
      const rewritten =
        original.params.length !== candidate.params.length ||
        original.params.some((p, i) => p !== candidate.params[i]);
      rows.push({ kind: rewritten ? 'rewritten' : 'kept', before: original, after: candidate });
      j++;
    } else {
      rows.push({ kind: 'removed', before: original });
    }
  }
  return rows;
}

const ROW_COLOUR: Record<DiffRow['kind'], string> = {
  kept: 'var(--color-text)',
  removed: 'var(--color-danger)',
  rewritten: 'var(--color-success)',
};

/**
 * Makes the compiler's own reasoning visible: what each pass removed, why that
 * rewrite is valid, and what the circuit cost before and after.
 */
export function OptimisationExplorer({
  compiled,
  optimize,
  onEnableOptimise,
  onReveal,
}: OptimisationExplorerProps) {
  const [showJustifications, setShowJustifications] = useState(false);

  const rows = useMemo(() => {
    if (!compiled?.unoptimized || !compiled.module) return [];
    return alignModules(compiled.unoptimized, compiled.module);
  }, [compiled]);

  if (!compiled?.unoptimized) {
    return <div className="qf-empty">Nothing to show: the program did not compile.</div>;
  }

  if (!optimize) {
    return (
      <div className="qf-empty" style={{ display: 'grid', gap: 12 }}>
        <div>
          Optimisation is off, so the IR is a one-to-one lowering of the source. Turn it on to
          see which instructions the passes remove and why each rewrite is valid.
        </div>
        <div>
          <button
            type="button"
            className="qf-button"
            data-variant="primary"
            onClick={onEnableOptimise}
          >
            Turn on optimisation
          </button>
        </div>
        <div>
          <div className="qf-label">The passes that would run</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
            {DEFAULT_PASSES.map((pass) => (
              <div key={pass.name}>
                <div className="qf-mono" style={{ color: 'var(--color-accent)', fontSize: 12 }}>
                  {pass.name}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                  {pass.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const before = compiled.unoptimized;
  const after = compiled.module!;
  const report = compiled.report;

  const removedCount = rows.filter((r) => r.kind === 'removed').length;
  const rewrittenCount = rows.filter((r) => r.kind === 'rewritten').length;

  const metric = (label: string, a: number, b: number) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--color-text-faint)' }}>{label}</span>
      <span className="qf-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {a === b ? (
          a
        ) : (
          <>
            <span style={{ color: 'var(--color-text-faint)' }}>{a}</span>
            <span style={{ color: 'var(--color-text-faint)' }}> &rarr; </span>
            <span style={{ color: 'var(--color-success)' }}>{b}</span>
          </>
        )}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 14, padding: '10px 12px' }}>
      <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
        {metric('instructions', before.instructions.length, after.instructions.length)}
        {metric('gates', gateCount(before), gateCount(after))}
        {metric('depth', circuitDepth(before), circuitDepth(after))}
        {report ? metric('rounds to fixpoint', report.rounds, report.rounds) : null}
      </div>

      <div
        style={{
          fontSize: 11.5,
          color: 'var(--color-text-faint)',
          lineHeight: 1.5,
          borderLeft: '2px solid var(--color-border-strong)',
          paddingLeft: 8,
        }}
      >
        Fewer gates is not automatically faster on real hardware: what a device charges for
        depends on its native gate set, its connectivity and its error rates, none of which
        QForge models. What these passes guarantee is that the circuit still computes the same
        thing &mdash; the operator is preserved exactly, global phase included.
      </div>

      <div>
        <div className="qf-label">
          Instruction by instruction ({removedCount} removed, {rewrittenCount} rewritten)
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>No instructions.</div>
        ) : (
          <table className="qf-table" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Unoptimised</th>
                <th scope="col">Optimised</th>
                <th scope="col">Line</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => row.before && onReveal(row.before.loc.start)}
                  style={{ cursor: row.before ? 'pointer' : 'default' }}
                >
                  <td data-numeric="" style={{ color: 'var(--color-text-faint)' }}>
                    {i}
                  </td>
                  <td
                    style={{
                      color: ROW_COLOUR[row.kind],
                      textDecoration: row.kind === 'removed' ? 'line-through' : 'none',
                    }}
                  >
                    {row.before ? render(row.before, before) : ''}
                  </td>
                  <td
                    style={{
                      color: row.kind === 'rewritten' ? 'var(--color-success)' : 'inherit',
                    }}
                  >
                    {row.after ? render(row.after, after) : '—'}
                  </td>
                  <td style={{ color: 'var(--color-text-faint)' }}>
                    {row.before?.loc.line ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {report && report.runs.length > 0 ? (
        <div>
          <div className="qf-label">What each pass did</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
            {report.runs.map((run, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span
                    className="qf-mono"
                    style={{ color: 'var(--color-accent)', fontSize: 12 }}
                  >
                    {run.pass}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                    round {run.round} &middot; {run.changed} instruction
                    {run.changed === 1 ? '' : 's'}
                  </span>
                </div>
                <ul
                  style={{
                    margin: '3px 0 0',
                    paddingLeft: 16,
                    fontSize: 11.5,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {run.notes.map((note, n) => (
                    <li key={n}>{note}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-faint)' }}>
          No pass changed anything: this circuit is already minimal under the rules QForge can
          prove.
        </div>
      )}

      <div>
        <button
          type="button"
          className="qf-button"
          onClick={() => setShowJustifications((value) => !value)}
          aria-expanded={showJustifications}
        >
          {showJustifications ? 'Hide' : 'Show'} why each rewrite is valid
        </button>
        {showJustifications ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {DEFAULT_PASSES.map((pass) => (
              <div key={pass.name}>
                <div className="qf-mono" style={{ color: 'var(--color-accent)', fontSize: 12 }}>
                  {pass.name}
                </div>
                <div
                  style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}
                >
                  {pass.justification}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
