'use client';

import type { RunOutcome, SimulationStatus, TraceView } from '../lib/useSimulation';
import { duration } from '../lib/format';

export interface ExecutionPanelProps {
  readonly shots: number;
  readonly onShotsChange: (shots: number) => void;
  readonly seedText: string;
  readonly onSeedChange: (seed: string) => void;
  readonly optimize: boolean;
  readonly onOptimizeChange: (value: boolean) => void;

  readonly canRun: boolean;
  readonly onRun: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onReset: () => void;
  readonly onRunToEnd: () => void;

  readonly trace: TraceView | undefined;
  readonly stepIndex: number;
  readonly lastRun: RunOutcome | undefined;
  readonly simulationStatus: SimulationStatus;
  readonly onCancel: () => void;
  readonly status: string;
}

const MAX_SHOTS = 1_000_000;

/**
 * Run, step, reset and the knobs that affect a run.
 *
 * The seed field is a plain text input rather than a number input so that
 * "empty means pick one for me" is expressible. Whatever seed is used gets
 * reported back after the run, so an interesting result stays reproducible even
 * when the user did not think to fix the seed in advance.
 */
export function ExecutionPanel({
  shots,
  onShotsChange,
  seedText,
  onSeedChange,
  optimize,
  onOptimizeChange,
  canRun,
  onRun,
  onStepForward,
  onStepBack,
  onReset,
  onRunToEnd,
  trace,
  stepIndex,
  lastRun,
  status,
  simulationStatus,
  onCancel,
}: ExecutionPanelProps) {
  const totalSteps = trace?.steps.length ?? 0;
  const atStart = stepIndex < 0;
  const atEnd = totalSteps === 0 || stepIndex >= totalSteps - 1;
  const busy = simulationStatus.kind === 'running';
  const progress =
    busy && simulationStatus.total > 0 ? simulationStatus.completed / simulationStatus.total : 0;

  return (
    <div style={{ padding: '10px 12px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {busy ? (
          <button
            type="button"
            className="qf-button"
            onClick={onCancel}
            title="Stop the run in progress"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="qf-button"
            data-variant="primary"
            onClick={onRun}
            disabled={!canRun}
            title="Simulate the whole circuit for the configured shot count (Ctrl/Cmd+Enter)"
          >
            Run
          </button>
        )}
        <button
          type="button"
          className="qf-button"
          onClick={onStepBack}
          disabled={!canRun || atStart}
          title="Go back one instruction, using the recorded state"
        >
          Step back
        </button>
        <button
          type="button"
          className="qf-button"
          onClick={onStepForward}
          disabled={!canRun || atEnd}
          title="Apply the next instruction (Ctrl/Cmd+')"
        >
          Step
        </button>
        <button
          type="button"
          className="qf-button"
          onClick={onRunToEnd}
          disabled={!canRun || atEnd}
          title="Jump to the end of the recorded trace"
        >
          To end
        </button>
        <button
          type="button"
          className="qf-button"
          onClick={onReset}
          disabled={!canRun}
          title="Return to the initial state and draw a fresh trace"
        >
          Reset
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 8,
        }}
      >
        <div>
          <label className="qf-label" htmlFor="qf-shots">
            Shots
          </label>
          <input
            id="qf-shots"
            className="qf-input"
            type="number"
            min={1}
            max={MAX_SHOTS}
            step={1}
            value={shots}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                onShotsChange(Math.max(1, Math.min(MAX_SHOTS, Math.round(next))));
              }
            }}
          />
        </div>
        <div>
          <label className="qf-label" htmlFor="qf-seed">
            Seed
          </label>
          <input
            id="qf-seed"
            className="qf-input"
            type="text"
            inputMode="numeric"
            placeholder="random"
            value={seedText}
            onChange={(event) => onSeedChange(event.target.value.replace(/[^\d]/g, ''))}
            aria-describedby="qf-seed-help"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              cursor: 'pointer',
              paddingBottom: 5,
            }}
          >
            <input
              type="checkbox"
              checked={optimize}
              onChange={(event) => onOptimizeChange(event.target.checked)}
            />
            Optimise
          </label>
        </div>
      </div>

      <p
        id="qf-seed-help"
        style={{ margin: 0, fontSize: 11, color: 'var(--color-text-faint)' }}
      >
        Leave the seed empty for a random one. A fixed seed makes every outcome, and the whole
        step trace, reproducible.
      </p>

      {busy ? (
        <div>
          {/* A determinate bar, because the worker reports shots completed.
              It matters for the per-shot-replay path, where a large shot count
              on a wide circuit genuinely takes seconds. */}
          <div
            style={{
              height: 4,
              background: 'var(--color-surface-3)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={simulationStatus.total}
            aria-valuenow={simulationStatus.completed}
            aria-label="Simulation progress"
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                background: 'var(--color-accent)',
              }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-faint)' }}>
            {simulationStatus.completed.toLocaleString()} of{' '}
            {simulationStatus.total.toLocaleString()} shots
          </div>
        </div>
      ) : null}

      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: 8,
          fontSize: 11.5,
          color: 'var(--color-text-muted)',
          display: 'grid',
          gap: 3,
        }}
      >
        <div>
          {simulationStatus.kind === 'error' ? (
            <span style={{ color: 'var(--color-danger)' }}>{simulationStatus.message}</span>
          ) : simulationStatus.kind === 'cancelled' ? (
            <span>
              Cancelled after {simulationStatus.completed.toLocaleString()} shot
              {simulationStatus.completed === 1 ? '' : 's'}.
            </span>
          ) : (
            status
          )}
        </div>
        {trace ? (
          <div>
            step {stepIndex + 1} of {totalSteps} &middot; trace seed {trace.seed}
            {trace.amplitudesTruncatedFrom !== undefined
              ? ` · amplitudes dropped from step ${trace.amplitudesTruncatedFrom + 1} (memory budget)`
              : ''}
          </div>
        ) : null}
        {lastRun ? (
          <div>
            last run: {lastRun.shots.toLocaleString()} shot
            {lastRun.shots === 1 ? '' : 's'} &middot; seed {lastRun.seed} &middot;{' '}
            {lastRun.strategy} &middot; {duration(lastRun.elapsedMs)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
