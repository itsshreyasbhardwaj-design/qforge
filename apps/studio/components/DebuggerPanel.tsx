'use client';

import { GATES } from '@qforge/language';
import { Opcode, displayAngle } from '@qforge/compiler';
import type { IrModule } from '@qforge/compiler';
import type { TraceView } from '../lib/useSimulation';
import { percent } from '../lib/format';

export interface DebuggerPanelProps {
  readonly trace: TraceView | undefined;
  /**
   * The module the trace was taken from.
   *
   * Carried separately rather than inside the trace: the trace now crosses a
   * worker boundary, and sending the whole module back with it would duplicate
   * data the main thread already has.
   */
  readonly module: IrModule | undefined;
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
  module,
  stepIndex,
  onSelectStep,
  onReveal,
}: DebuggerPanelProps) {
  if (!trace || !module) {
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
    const labels = qubits.map((q) => module.qubitLabels[q] ?? `%${q}`);
    if (opcode === Opcode.Measure) {
      return `measure ${labels[0]} -> ${module.clbitLabels[clbit ?? 0] ?? `$${clbit}`}`;
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
          // The worker sends states and probabilities, not instructions: the
          // main thread already has the module, and shipping it back per step
          // would duplicate it once per gate.
          const instruction = module.instructions[step.index];
          if (!instruction) return null;
          const signature = GATES.get(instruction.opcode);
          const params = instruction.params.length
            ? `(${instruction.params.map((p: number) => displayAngle(p)).join(', ')})`
            : '';

          return (
            <li key={step.index}>
              <button
                type="button"
                onClick={() => onSelectStep(step.index)}
                onDoubleClick={() => onReveal(instruction.loc.start)}
                aria-current={current}
                title={
                  signature?.description ??
                  describeStep(
                    instruction.opcode,
                    instruction.qubits,
                    instruction.clbit,
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
                      {instruction.opcode}
                      {params}
                    </span>{' '}
                    {describeStep(
                      instruction.opcode,
                      instruction.qubits,
                      instruction.clbit,
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
                    line {instruction.loc.line}
                  </span>
                </div>

                {instruction.condition ? (
                  <div
                    style={{
                      marginTop: 4,
                      marginLeft: 36,
                      fontSize: 11.5,
                      display: 'flex',
                      gap: 6,
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="qf-mono" style={{ color: 'var(--color-warning)' }}>
                      if {instruction.condition.text}
                    </span>
                    {step.conditionHeld === undefined ? null : (
                      <span
                        style={{
                          color: step.conditionHeld
                            ? 'var(--color-success)'
                            : 'var(--color-text-faint)',
                        }}
                      >
                        {/* Spelled out, not colour-coded alone: "nothing
                            happened" and "the condition was false" look
                            identical in the state. */}
                        {step.conditionHeld
                          ? 'held, so it ran'
                          : 'did not hold, so it was skipped'}
                      </span>
                    )}
                  </div>
                ) : null}

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
