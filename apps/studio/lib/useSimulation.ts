'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IrModule } from '@qforge/compiler';
import { Statevector } from '@qforge/simulator';
import {
  WORKER_TIMEOUT_MS,
  type RunId,
  type TransferableState,
  type WorkerRequest,
  type WorkerResponse,
} from './worker/protocol';

/**
 * Owns the simulation worker and the rule that only the newest run counts.
 *
 * The hard problem a worker introduces is not concurrency, it is *staleness*.
 * The user edits a circuit, a run starts, they edit again and a second run
 * starts; if the first finishes last, its result must not land. Every message
 * carries a run id, the hook keeps one current, and anything else is dropped.
 */

export interface RunOutcome {
  readonly shots: number;
  readonly seed: number;
  readonly strategy: 'terminal-sampling' | 'per-shot-replay';
  readonly counts: ReadonlyMap<string, number>;
  readonly probabilities: Float64Array;
  readonly finalState: Statevector;
  readonly elapsedMs: number;
}

export interface TraceStepView {
  readonly index: number;
  readonly probabilities: Float64Array;
  readonly classicalBits: Uint8Array;
  readonly changedAmplitudes: readonly number[];
  readonly state?: Statevector;
  readonly measurement?: { qubit: number; outcome: 0 | 1; p0: number; p1: number };
  readonly conditionHeld?: boolean;
}

export interface TraceView {
  readonly seed: number;
  readonly initialState: Statevector;
  readonly steps: readonly TraceStepView[];
  readonly amplitudesTruncatedFrom?: number;
  readonly elapsedMs: number;
}

export type SimulationStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly completed: number; readonly total: number }
  | { readonly kind: 'cancelled'; readonly completed: number }
  | { readonly kind: 'error'; readonly message: string };

function reviveState(state: TransferableState): Statevector {
  const amplitudes = Array.from({ length: state.re.length }, (_, i) => ({
    re: state.re[i]!,
    im: state.im[i]!,
  }));
  return Statevector.fromAmplitudes(amplitudes);
}

let runCounter = 0;
const nextRunId = (): RunId => `run-${++runCounter}`;

export interface UseSimulation {
  readonly status: SimulationStatus;
  readonly lastRun: RunOutcome | undefined;
  readonly trace: TraceView | undefined;
  readonly workerAvailable: boolean;
  run(module: IrModule, shots: number, seed: number | undefined): void;
  requestTrace(module: IrModule, seed: number | undefined, maxTraceBytes: number): void;
  cancel(): void;
  clearRun(): void;
}

export function useSimulation(): UseSimulation {
  const workerRef = useRef<Worker | null>(null);
  const currentRunRef = useRef<RunId | undefined>(undefined);
  const currentTraceRef = useRef<RunId | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [status, setStatus] = useState<SimulationStatus>({ kind: 'idle' });
  const [lastRun, setLastRun] = useState<RunOutcome | undefined>(undefined);
  const [trace, setTrace] = useState<TraceView | undefined>(undefined);
  const [workerAvailable, setWorkerAvailable] = useState(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const isCurrentRun = message.runId === currentRunRef.current;
      const isCurrentTrace = message.runId === currentTraceRef.current;
      // Stale: a superseded run finishing after a newer one started.
      if (!isCurrentRun && !isCurrentTrace) return;

      switch (message.kind) {
        case 'progress':
          if (isCurrentRun) {
            setStatus({ kind: 'running', completed: message.completed, total: message.total });
          }
          break;

        case 'run-result':
          clearTimer();
          currentRunRef.current = undefined;
          setStatus({ kind: 'idle' });
          setLastRun({
            shots: message.shots,
            seed: message.seed,
            strategy: message.strategy,
            counts: new Map(message.counts),
            probabilities: message.probabilities,
            finalState: reviveState(message.finalState),
            elapsedMs: message.elapsedMs,
          });
          break;

        case 'trace-result':
          currentTraceRef.current = undefined;
          setTrace({
            seed: message.seed,
            initialState: reviveState(message.initialState),
            steps: message.steps.map((step) => ({
              index: step.index,
              probabilities: step.probabilities,
              classicalBits: step.classicalBits,
              changedAmplitudes: step.changedAmplitudes,
              ...(step.state ? { state: reviveState(step.state) } : {}),
              ...(step.measurement ? { measurement: step.measurement } : {}),
              ...(step.conditionHeld !== undefined
                ? { conditionHeld: step.conditionHeld }
                : {}),
            })),
            ...(message.amplitudesTruncatedFrom !== undefined
              ? { amplitudesTruncatedFrom: message.amplitudesTruncatedFrom }
              : {}),
            elapsedMs: message.elapsedMs,
          });
          break;

        case 'cancelled':
          clearTimer();
          currentRunRef.current = undefined;
          setStatus({ kind: 'cancelled', completed: message.completed });
          break;

        case 'error':
          clearTimer();
          if (isCurrentRun) currentRunRef.current = undefined;
          if (isCurrentTrace) currentTraceRef.current = undefined;
          setStatus({ kind: 'error', message: message.message });
          break;
      }
    },
    [clearTimer],
  );

  /** Create the worker, replacing a dead one if necessary. */
  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    try {
      const worker = new Worker(new URL('./worker/simulation.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = handleMessage;
      worker.onerror = (event) => {
        // A worker that threw at the top level is unusable; drop it so the
        // next request builds a fresh one rather than hanging forever.
        setStatus({ kind: 'error', message: event.message || 'The simulation worker failed' });
        worker.terminate();
        workerRef.current = null;
        currentRunRef.current = undefined;
        currentTraceRef.current = undefined;
      };
      workerRef.current = worker;
      setWorkerAvailable(true);
      return worker;
    } catch {
      setWorkerAvailable(false);
      return null;
    }
  }, [handleMessage]);

  useEffect(() => {
    ensureWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [ensureWorker]);

  const send = useCallback(
    (request: WorkerRequest): boolean => {
      const worker = ensureWorker();
      if (!worker) return false;
      worker.postMessage(request);
      return true;
    },
    [ensureWorker],
  );

  const cancel = useCallback(() => {
    const runId = currentRunRef.current;
    if (!runId) return;
    send({ kind: 'cancel', runId });
  }, [send]);

  const run = useCallback(
    (module: IrModule, shots: number, seed: number | undefined) => {
      const runId = nextRunId();
      currentRunRef.current = runId;
      setStatus({ kind: 'running', completed: 0, total: shots });

      const sent = send({
        kind: 'run',
        runId,
        module,
        shots,
        ...(seed !== undefined ? { seed } : {}),
      });
      if (!sent) {
        setStatus({ kind: 'error', message: 'Web Workers are unavailable in this browser' });
        currentRunRef.current = undefined;
        return;
      }

      clearTimer();
      timeoutRef.current = setTimeout(() => {
        // Ask politely first; if the worker is wedged inside a loop that never
        // yields, terminate it and start a fresh one.
        if (currentRunRef.current !== runId) return;
        send({ kind: 'cancel', runId });
        setTimeout(() => {
          if (currentRunRef.current !== runId) return;
          workerRef.current?.terminate();
          workerRef.current = null;
          currentRunRef.current = undefined;
          setStatus({
            kind: 'error',
            message: `The run exceeded ${WORKER_TIMEOUT_MS / 1000}s and was stopped. The worker has been restarted.`,
          });
        }, 1_000);
      }, WORKER_TIMEOUT_MS);
    },
    [clearTimer, send],
  );

  const requestTrace = useCallback(
    (module: IrModule, seed: number | undefined, maxTraceBytes: number) => {
      const runId = nextRunId();
      currentTraceRef.current = runId;
      const sent = send({
        kind: 'trace',
        runId,
        module,
        maxTraceBytes,
        ...(seed !== undefined ? { seed } : {}),
      });
      if (!sent) {
        currentTraceRef.current = undefined;
        setTrace(undefined);
      }
    },
    [send],
  );

  const clearRun = useCallback(() => {
    setLastRun(undefined);
    setStatus({ kind: 'idle' });
  }, []);

  return { status, lastRun, trace, workerAvailable, run, requestTrace, cancel, clearRun };
}
