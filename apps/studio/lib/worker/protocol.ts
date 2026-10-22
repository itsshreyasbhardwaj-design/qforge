import type { IrModule } from '@qforge/compiler';

/**
 * The wire protocol between the studio and its simulation worker.
 *
 * Every message carries a `runId`. The main thread keeps exactly one run
 * current, and a response whose `runId` is not the current one is dropped
 * rather than applied: without that, a slow 20-qubit run finishing after a fast
 * 4-qubit one would overwrite newer results with older ones, and the UI would
 * show a state that does not correspond to the program on screen.
 */

export type RunId = string;

/** An IR module is plain data, so it survives structured cloning unchanged. */
export type TransferableModule = IrModule;

export interface RunRequest {
  readonly kind: 'run';
  readonly runId: RunId;
  readonly module: TransferableModule;
  readonly shots: number;
  readonly seed?: number;
}

export interface TraceRequest {
  readonly kind: 'trace';
  readonly runId: RunId;
  readonly module: TransferableModule;
  readonly seed?: number;
  readonly maxTraceBytes: number;
}

export interface CancelRequest {
  readonly kind: 'cancel';
  /** Cancels this run if it is the one in flight. */
  readonly runId: RunId;
}

export type WorkerRequest = RunRequest | TraceRequest | CancelRequest;

/** A statevector flattened for transfer; the class itself is not cloneable. */
export interface TransferableState {
  readonly qubitCount: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
}

export interface TransferableStep {
  readonly index: number;
  readonly probabilities: Float64Array;
  readonly classicalBits: Uint8Array;
  readonly changedAmplitudes: readonly number[];
  readonly state?: TransferableState;
  readonly measurement?: {
    readonly qubit: number;
    readonly outcome: 0 | 1;
    readonly p0: number;
    readonly p1: number;
  };
  readonly conditionHeld?: boolean;
}

export interface ProgressMessage {
  readonly kind: 'progress';
  readonly runId: RunId;
  readonly completed: number;
  readonly total: number;
}

export interface RunResultMessage {
  readonly kind: 'run-result';
  readonly runId: RunId;
  readonly shots: number;
  readonly seed: number;
  readonly strategy: 'terminal-sampling' | 'per-shot-replay';
  readonly counts: ReadonlyArray<readonly [string, number]>;
  readonly probabilities: Float64Array;
  readonly finalState: TransferableState;
  readonly elapsedMs: number;
}

export interface TraceResultMessage {
  readonly kind: 'trace-result';
  readonly runId: RunId;
  readonly seed: number;
  readonly initialState: TransferableState;
  readonly steps: readonly TransferableStep[];
  readonly amplitudesTruncatedFrom?: number;
  readonly elapsedMs: number;
}

export interface ErrorMessage {
  readonly kind: 'error';
  readonly runId: RunId;
  readonly message: string;
  /** True when the worker refused the work rather than failing during it. */
  readonly rejected: boolean;
}

export interface CancelledMessage {
  readonly kind: 'cancelled';
  readonly runId: RunId;
  /** Shots completed before the cancellation took effect. */
  readonly completed: number;
}

export type WorkerResponse =
  ProgressMessage | RunResultMessage | TraceResultMessage | ErrorMessage | CancelledMessage;

/**
 * Shots processed between yields to the worker's event loop.
 *
 * A worker cannot receive a message while it is inside a synchronous loop, so
 * without yielding there would be no way to cancel a long run or report
 * progress. 2,000 is small enough that a cancel lands within a few
 * milliseconds even for wide circuits, and large enough that the yields cost
 * nothing measurable: at 12 qubits a chunk is about 0.6 ms of work.
 */
export const SHOT_CHUNK = 2_000;

/** Hard ceiling on a single run, enforced by the worker itself. */
export const WORKER_TIMEOUT_MS = 30_000;
