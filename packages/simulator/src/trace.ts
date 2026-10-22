import { Opcode, conditionHolds, type IrInstruction, type IrModule } from '@qforge/compiler';
import { Statevector } from './statevector/statevector.js';
import { Prng, randomSeed } from './rng/prng.js';
import { applyInstruction } from './execute.js';
import { measureQubit, resetQubit, type MeasurementOutcome } from './measurement/measure.js';

export interface TraceStep {
  /** Index into `module.instructions`. */
  readonly index: number;
  readonly instruction: IrInstruction;
  /**
   * State after this instruction. Omitted once the memory budget is spent;
   * `probabilities` is always present.
   */
  readonly state?: Statevector;
  readonly probabilities: Float64Array;
  /** Present for `measure` and `reset`: the exact probabilities and the draw. */
  readonly measurement?: MeasurementOutcome;
  /**
   * For a predicated instruction, whether the predicate held on this run.
   *
   * The debugger shows this because "nothing happened" and "the condition was
   * false" look identical in the state, and the difference is exactly what a
   * reader of a feed-forward circuit needs to see.
   */
  readonly conditionHeld?: boolean;
  /** Classical register contents after this instruction. */
  readonly classicalBits: Uint8Array;
  /**
   * Basis-state indices whose amplitude changed materially at this step.
   * This is what lets the studio highlight exactly what an operation did,
   * instead of making the user diff two tables by eye.
   */
  readonly changedAmplitudes: readonly number[];
}

export interface Trace {
  readonly module: IrModule;
  readonly seed: number;
  /** The state before any instruction ran: `|00...0>`. */
  readonly initialState: Statevector;
  readonly steps: readonly TraceStep[];
  /**
   * Index of the first step whose full amplitudes were not retained, if the
   * memory budget was reached. Probabilities are retained for every step.
   */
  readonly amplitudesTruncatedFrom?: number;
  readonly elapsedMs: number;
}

export interface TraceOptions {
  readonly seed?: number;
  /**
   * Budget for retained amplitude snapshots. A step costs `2^n * 16` bytes, so
   * a 12-qubit circuit with 200 instructions wants ~13 MB. Default 64 MB.
   */
  readonly maxTraceBytes?: number;
  /** Amplitude difference counted as a change. Default 1e-12. */
  readonly changeThreshold?: number;
}

const DEFAULT_TRACE_BYTES = 64 * 1024 * 1024;

/**
 * Execute a circuit once, recording the state after every instruction.
 *
 * This is the engine behind the step debugger. Recording every intermediate
 * state up front — rather than re-running the prefix on each step — is what
 * makes stepping *backwards* free and, more importantly, consistent: a
 * circuit containing a measurement has a random branch, so re-running the
 * prefix could land on a different branch and show the user a state that never
 * actually occurred.
 */
export function traceCircuit(module: IrModule, options: TraceOptions = {}): Trace {
  const seed = options.seed ?? randomSeed();
  const budget = options.maxTraceBytes ?? DEFAULT_TRACE_BYTES;
  const threshold = options.changeThreshold ?? 1e-12;

  const rng = new Prng(seed);
  const started = performance.now();

  const state = Statevector.zeroState(module.qubitCount);
  const initialState = state.clone();
  const register = new Uint8Array(module.clbitCount);

  const bytesPerSnapshot = state.size * 16;
  let bytesUsed = bytesPerSnapshot; // the initial state snapshot
  let truncatedFrom: number | undefined;

  const steps: TraceStep[] = [];
  let previous = initialState;

  module.instructions.forEach((instruction, index) => {
    let measurement: MeasurementOutcome | undefined;
    const held = instruction.condition
      ? conditionHolds(instruction.condition, register)
      : undefined;

    if (held === false) {
      // Skipped: record a step so the debugger can show the condition failing,
      // but leave the state untouched.
      steps.push({
        index,
        instruction,
        ...(bytesUsed + bytesPerSnapshot <= budget ? { state: state.clone() } : {}),
        probabilities: state.probabilities(),
        classicalBits: register.slice(),
        changedAmplitudes: [],
        conditionHeld: false,
      });
      if (bytesUsed + bytesPerSnapshot <= budget) bytesUsed += bytesPerSnapshot;
      else if (truncatedFrom === undefined) truncatedFrom = index;
      return;
    }

    switch (instruction.opcode) {
      case Opcode.Measure: {
        measurement = measureQubit(state, instruction.qubits[0]!, rng);
        if (instruction.clbit !== undefined) register[instruction.clbit] = measurement.outcome;
        break;
      }
      case Opcode.Reset:
        measurement = resetQubit(state, instruction.qubits[0]!, rng);
        break;
      default:
        applyInstruction(state, instruction);
    }

    const changedAmplitudes: number[] = [];
    for (let i = 0; i < state.size; i++) {
      if (
        Math.abs(state.re[i]! - previous.re[i]!) > threshold ||
        Math.abs(state.im[i]! - previous.im[i]!) > threshold
      ) {
        changedAmplitudes.push(i);
      }
    }

    const keepAmplitudes = bytesUsed + bytesPerSnapshot <= budget;
    if (keepAmplitudes) bytesUsed += bytesPerSnapshot;
    else if (truncatedFrom === undefined) truncatedFrom = index;

    const snapshot = state.clone();
    steps.push({
      index,
      instruction,
      ...(keepAmplitudes ? { state: snapshot } : {}),
      probabilities: state.probabilities(),
      ...(measurement ? { measurement } : {}),
      ...(held !== undefined ? { conditionHeld: held } : {}),
      classicalBits: register.slice(),
      changedAmplitudes,
    });
    previous = snapshot;
  });

  return {
    module,
    seed,
    initialState,
    steps,
    ...(truncatedFrom !== undefined ? { amplitudesTruncatedFrom: truncatedFrom } : {}),
    elapsedMs: performance.now() - started,
  };
}

/**
 * The state as of `stepIndex`, where `-1` means "before the first instruction".
 *
 * Returns undefined when that step's amplitudes were dropped for budget
 * reasons, which the caller should surface rather than silently showing a
 * different step.
 */
export function stateAtStep(trace: Trace, stepIndex: number): Statevector | undefined {
  if (stepIndex < 0) return trace.initialState;
  return trace.steps[stepIndex]?.state;
}

/** Probabilities as of `stepIndex`; always available. */
export function probabilitiesAtStep(trace: Trace, stepIndex: number): Float64Array {
  if (stepIndex < 0) return trace.initialState.probabilities();
  return trace.steps[stepIndex]?.probabilities ?? trace.initialState.probabilities();
}
