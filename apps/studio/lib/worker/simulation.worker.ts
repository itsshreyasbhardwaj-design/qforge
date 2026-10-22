/// <reference lib="webworker" />
import { Opcode, conditionHolds } from '@qforge/compiler';
import { HARD_MAX_QUBITS } from '@qforge/language';
import {
  Prng,
  Statevector,
  applyInstruction,
  measureQubit,
  requiresPerShotReplay,
  resetQubit,
  sampleManyBasisStates,
  traceCircuit,
} from '@qforge/simulator';
import {
  SHOT_CHUNK,
  type RunRequest,
  type TraceRequest,
  type TransferableState,
  type TransferableStep,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

/**
 * The studio's simulation worker.
 *
 * Everything expensive runs here so the editor stays responsive: at 14 qubits a
 * 390-gate circuit takes a few hundred milliseconds, which on the main thread
 * would drop frames and block typing.
 *
 * The worker owns exactly one run at a time. A new request supersedes whatever
 * was in flight, and the shot loop yields to the event loop every `SHOT_CHUNK`
 * shots so that cancellations and progress reporting are possible at all -- a
 * worker inside a synchronous loop cannot receive messages.
 */

declare const self: DedicatedWorkerGlobalScope;

/** The run the worker is currently executing, if any. */
let activeRunId: string | undefined;
/** Set when a cancel arrives for the active run. */
let cancelRequested = false;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function toTransferable(state: Statevector): TransferableState {
  // Copies rather than transfers: the caller usually still needs the state.
  return { qubitCount: state.qubitCount, re: state.re.slice(), im: state.im.slice() };
}

/** Yield to the event loop so queued messages (notably cancel) are delivered. */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function formatRegister(register: Uint8Array): string {
  let out = '';
  for (let i = register.length - 1; i >= 0; i--) out += register[i] === 1 ? '1' : '0';
  return out;
}

async function handleRun(request: RunRequest): Promise<void> {
  const { runId, module, shots } = request;
  const seed = request.seed ?? (Math.random() * 0x100000000) >>> 0;
  const started = performance.now();
  const rng = new Prng(seed);
  const counts = new Map<string, number>();

  const replay = requiresPerShotReplay(module);
  const strategy = replay ? 'per-shot-replay' : 'terminal-sampling';

  let finalState: Statevector;
  let probabilities: Float64Array;
  let completed = 0;

  if (!replay) {
    // One execution, then sample. Fast enough that chunking is unnecessary,
    // but progress is still reported so the UI behaves the same either way.
    const state = Statevector.zeroState(module.qubitCount);
    const measurements = [];
    for (const instruction of module.instructions) {
      if (instruction.opcode === Opcode.Measure) {
        measurements.push(instruction);
        continue;
      }
      applyInstruction(state, instruction);
    }
    probabilities = state.probabilities();
    finalState = state;

    if (measurements.length === 0) {
      counts.set(formatRegister(new Uint8Array(module.clbitCount)), shots);
    } else {
      const samples = sampleManyBasisStates(probabilities, shots, rng);
      const register = new Uint8Array(module.clbitCount);
      for (let shot = 0; shot < shots; shot++) {
        register.fill(0);
        const basis = samples[shot]!;
        for (const instruction of measurements) {
          if (instruction.clbit === undefined) continue;
          register[instruction.clbit] = ((basis >> instruction.qubits[0]!) & 1) as 0 | 1;
        }
        const key = formatRegister(register);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    completed = shots;
    post({ kind: 'progress', runId, completed, total: shots });
  } else {
    let lastState = Statevector.zeroState(module.qubitCount);
    while (completed < shots) {
      const chunk = Math.min(SHOT_CHUNK, shots - completed);
      for (let i = 0; i < chunk; i++) {
        const state = Statevector.zeroState(module.qubitCount);
        const register = new Uint8Array(module.clbitCount);
        for (const instruction of module.instructions) {
          if (instruction.condition && !conditionHolds(instruction.condition, register))
            continue;
          if (instruction.opcode === Opcode.Measure) {
            const outcome = measureQubit(state, instruction.qubits[0]!, rng);
            if (instruction.clbit !== undefined) register[instruction.clbit] = outcome.outcome;
            continue;
          }
          if (instruction.opcode === Opcode.Reset) {
            resetQubit(state, instruction.qubits[0]!, rng);
            continue;
          }
          applyInstruction(state, instruction);
        }
        const key = formatRegister(register);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        lastState = state;
      }
      completed += chunk;
      post({ kind: 'progress', runId, completed, total: shots });

      if (completed < shots) {
        await yieldToEventLoop();
        if (cancelRequested && activeRunId === runId) {
          post({ kind: 'cancelled', runId, completed });
          return;
        }
      }
    }
    finalState = lastState;
    probabilities = lastState.probabilities();
  }

  const state = toTransferable(finalState);
  post(
    {
      kind: 'run-result',
      runId,
      shots,
      seed,
      strategy,
      counts: [...counts.entries()],
      probabilities,
      finalState: state,
      elapsedMs: performance.now() - started,
    },
    // Hand the buffers over rather than copying them again: the worker has no
    // further use for them, and at 14 qubits each is 128 KiB.
    [probabilities.buffer, state.re.buffer, state.im.buffer],
  );
}

function handleTrace(request: TraceRequest): void {
  const { runId, module, maxTraceBytes } = request;
  const seed = request.seed ?? (Math.random() * 0x100000000) >>> 0;
  const trace = traceCircuit(module, { seed, maxTraceBytes });

  const steps: TransferableStep[] = trace.steps.map((step) => ({
    index: step.index,
    probabilities: step.probabilities,
    classicalBits: step.classicalBits,
    changedAmplitudes: step.changedAmplitudes,
    ...(step.state ? { state: toTransferable(step.state) } : {}),
    ...(step.measurement
      ? {
          measurement: {
            qubit: step.measurement.qubit,
            outcome: step.measurement.outcome,
            p0: step.measurement.p0,
            p1: step.measurement.p1,
          },
        }
      : {}),
    ...(step.conditionHeld !== undefined ? { conditionHeld: step.conditionHeld } : {}),
  }));

  post({
    kind: 'trace-result',
    runId,
    seed,
    initialState: toTransferable(trace.initialState),
    steps,
    ...(trace.amplitudesTruncatedFrom !== undefined
      ? { amplitudesTruncatedFrom: trace.amplitudesTruncatedFrom }
      : {}),
    elapsedMs: trace.elapsedMs,
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.kind === 'cancel') {
    if (activeRunId === request.runId) cancelRequested = true;
    return;
  }

  // A new request supersedes anything in flight. The old run's chunk loop sees
  // the changed runId on its next yield and stops.
  activeRunId = request.runId;
  cancelRequested = false;

  // The worker enforces the qubit ceiling itself. The frontend checks it too,
  // but the worker is reachable with a module built any other way, and an
  // oversized allocation here would take the whole worker down.
  if (request.module.qubitCount > HARD_MAX_QUBITS) {
    post({
      kind: 'error',
      runId: request.runId,
      message: `Circuit uses ${request.module.qubitCount} qubits; the hard limit is ${HARD_MAX_QUBITS}`,
      rejected: true,
    });
    return;
  }

  try {
    if (request.kind === 'run') {
      void handleRun(request).catch((error: unknown) => {
        post({
          kind: 'error',
          runId: request.runId,
          message: error instanceof Error ? error.message : String(error),
          rejected: false,
        });
      });
    } else {
      handleTrace(request);
    }
  } catch (error) {
    post({
      kind: 'error',
      runId: request.runId,
      message: error instanceof Error ? error.message : String(error),
      rejected: false,
    });
  }
};
