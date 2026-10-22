'use client';

import { GATES } from '@qforge/language';
import { Opcode, displayAngle } from '@qforge/compiler';
import type { Trace } from '@qforge/simulator';
import { percent } from '../lib/format';

export interface DebuggerPanelProps {
  readonly trace: Trace | undefined;
  readonly stepIndex: number;
  readonly onSelectStep: (index: number) => void;
  readonly onReveal: (offset: number) => void;
}

/**
 * The step list: one row per instruction, with the measurement detail inline.
 *
 * Measurement rows are the interesting ones. They show the exact probabilities
 * computed from the pre-measurement state *and* the outcome that was sampled,
 * kept visibly separate. A debugger that printed only the outcome would make
 * measurement look deterministic; one that printed only the probabilities would
 * make it look like nothing happened.
 */
export function DebuggerPanel({
  trace,
  stepIndex,
  onSelectStep,
  onReveal,
}: DebuggerPanelProps) {
  if (!trace) {
    return <div className="qf-empty">Compile a program to start stepping through it.</div>;
  }
  if (trace.steps.length === 0) {
    return (
      <div className="qf-empty">
        This program has no executable instructions, so there is nothing to step through.
      </div>
    );
  }

  const describeStep = (opcode: string, qubits: readonly number[], clbit?: number): string => {
    const labels = qubits.map((q) => trace.module.qubitLabels[q] ?? `%${q}`);
    if (opcode === Opcode.Measure) {
      return `measure ${labels[0]} -> ${trace.module.clbitLabels[clbit ?? 0] ?? `$${clbit}`}`;
    }
    if (opcode === Opcode.Barrier)
      return labels.length ? `barrier ${labels.join(', ')}` : 'barrier';
    return `${opcode} ${labels.join(', ')}`;
  };

  return (
    <div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {/* Step 0 is the initial state, before any instruction has run. */}
        <li>
          <button
            type="button"
            onClick={() => onSelectStep(-1)}
            aria-current={stepIndex === -1}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              font: 'inherit',
              background:
                stepIndex === -1
                  ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                  : 'transparent',
              color: 'inherit',
              border: 'none',
              borderBottom: '1px solid var(--color-border)',
              padding: '7px 12px',
              cursor: 'pointer',
            }}
          >
            <span className="qf-mono" style={{ color: 'var(--color-text-faint)' }}>
              init
            </span>
            <span style={{ marginLeft: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
              all qubits in |0&gt;
            </span>
          </button>
        </li>

        {trace.steps.map((step) => {
          const current = step.index === stepIndex;
          const executed = step.index <= stepIndex;
          const signature = GATES.get(step.instruction.opcode);
          const params = step.instruction.params.length
            ? `(${step.instruction.params.map((p) => displayAngle(p)).join(', ')})`
            : '';

          return (
            <li key={step.index}>
              <button
                type="button"
                onClick={() => onSelectStep(step.index)}
                onDoubleClick={() => onReveal(step.instruction.loc.start)}
                aria-current={current}
                title={
                  signature?.description ??
                  describeStep(
                    step.instruction.opcode,
                    step.instruction.qubits,
                    step.instruction.clbit,
                  )
                }
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  font: 'inherit',
                  background: current
                    ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                    : 'transparent',
                  color: executed ? 'inherit' : 'var(--color-text-faint)',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  borderLeft: current
                    ? '2px solid var(--color-accent)'
                    : '2px solid transparent',
                  padding: '7px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span
                    className="qf-mono"
                    style={{
                      color: 'var(--color-text-faint)',
                      minWidth: 26,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {step.index + 1}
                  </span>
                  <span className="qf-mono">
                    <span style={{ color: current ? 'var(--color-accent)' : 'inherit' }}>
                      {step.instruction.opcode}
                      {params}
                    </span>{' '}
                    {describeStep(
                      step.instruction.opcode,
                      step.instruction.qubits,
                      step.instruction.clbit,
                    )
                      .split(' ')
                      .slice(1)
                      .join(' ')}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    line {step.instruction.loc.line}
                  </span>
                </div>

                {step.measurement ? (
                  <div
                    style={{
                      marginTop: 4,
                      marginLeft: 36,
                      fontSize: 11.5,
                      display: 'grid',
                      gap: 2,
                    }}
                  >
                    <div style={{ color: 'var(--color-text-muted)' }}>
                      before: P(0) = {percent(step.measurement.p0, 2)}, P(1) ={' '}
                      {percent(step.measurement.p1, 2)}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-faint)' }}>sampled: </span>
                      <span
                        className="qf-mono"
                        style={{ color: 'var(--color-warning)', fontWeight: 600 }}
                      >
                        {step.measurement.outcome}
                      </span>
                      <span style={{ color: 'var(--color-text-faint)' }}>
                        {' '}
                        &middot; state collapsed
                      </span>
                    </div>
                  </div>
                ) : null}

                {executed && step.changedAmplitudes.length > 0 ? (
                  <div
                    style={{
                      marginTop: 3,
                      marginLeft: 36,
                      fontSize: 11,
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    changed {step.changedAmplitudes.length} amplitude
                    {step.changedAmplitudes.length === 1 ? '' : 's'}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="qf-empty" style={{ paddingTop: 10 }}>
        Click a step to jump to the state just after it; double-click to move the editor caret
        to the statement. Stepping backwards reads the recorded state rather than re-running, so
        a measurement&rsquo;s sampled branch stays the one you actually saw.
      </div>
    </div>
  );
}
