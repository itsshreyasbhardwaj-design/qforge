import { Opcode, type IrInstruction, type IrModule } from '@qforge/compiler';
import { HARD_MAX_QUBITS, MAX_SHOTS, statevectorBytes } from '@qforge/language';
import { singleQubitMatrix } from './gates/matrices.js';
import { Statevector } from './statevector/statevector.js';
import { Prng, randomSeed } from './rng/prng.js';
import {
  measureQubit,
  resetQubit,
  sampleManyBasisStates,
  type MeasurementOutcome,
} from './measurement/measure.js';

/** Classical register: one bit per declared classical bit, initialised to 0. */
export type ClassicalRegister = Uint8Array;

export type SamplingStrategy = 'terminal-sampling' | 'per-shot-replay';

export interface ExecuteOptions {
  /** Number of repetitions. Default 1. */
  readonly shots?: number;
  /** PRNG seed. When omitted a random seed is chosen and reported back. */
  readonly seed?: number;
}

export interface ExecutionResult {
  readonly shots: number;
  /** The seed actually used, so any run can be reproduced exactly. */
  readonly seed: number;
  readonly strategy: SamplingStrategy;
  /**
   * Measurement counts keyed by classical register contents, written most
   * significant bit first so classical bit 0 is the rightmost character.
   * Classical bits start each shot at 0, so a bit that is never measured
   * reads 0.
   */
  readonly counts: ReadonlyMap<string, number>;
  /**
   * The statevector at the end of the circuit.
   *
   * For `terminal-sampling` this is the exact pre-measurement state, shared by
   * every shot. For `per-shot-replay` it is the collapsed state of the *last*
   * shot only, since each shot follows a different branch.
   */
  readonly finalState: Statevector;
  /** Born-rule probabilities of the pre-measurement state. */
  readonly probabilities: Float64Array;
  /** Global indices of classical bits written by at least one measurement. */
  readonly measuredClbits: readonly number[];
  readonly elapsedMs: number;
}

/**
 * Does this circuit have to be replayed once per shot, or can every shot be
 * sampled from a single final statevector?
 *
 * Sampling from the final state is exact whenever all measurements are
 * terminal: drawing a basis state `k` from `|psi|^2` and reading off the
 * measured qubits' bits reproduces the correct joint distribution, including
 * all correlations, and unmeasured qubits are correctly traced out. Measuring
 * the same qubit twice is also fine — both reads see the same bit of `k`,
 * which is exactly the repeatability a real measurement has.
 *
 * Replay is required when the circuit's later evolution depends on a sampled
 * outcome:
 *   - any `reset`, which is a measurement in disguise, or
 *   - any gate acting on a qubit that has already been measured.
 *
 * Getting this wrong in the optimistic direction would silently produce wrong
 * statistics, so the test suite checks a mid-circuit-measurement circuit
 * against brute-force replay.
 */
export function requiresPerShotReplay(module: IrModule): boolean {
  const measured = new Set<number>();
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Reset) return true;
    if (instruction.opcode === Opcode.Measure) {
      const q = instruction.qubits[0];
      if (q !== undefined) measured.add(q);
      continue;
    }
    if (instruction.opcode === Opcode.Barrier) continue;
    if (instruction.qubits.some((q) => measured.has(q))) return true;
  }
  return false;
}

/**
 * Apply one unitary instruction to `state`.
 *
 * Dispatches to the dedicated permutation kernels for `cx`, `cz`, `swap` and
 * `ccx`, and to the general 2x2 kernel otherwise.
 */
export function applyInstruction(state: Statevector, instruction: IrInstruction): void {
  const { opcode, qubits, params } = instruction;

  switch (opcode) {
    case Opcode.Cx:
      state.applyCx(qubits[0]!, qubits[1]!);
      return;
    case Opcode.Cz:
      state.applyCz(qubits[0]!, qubits[1]!);
      return;
    case Opcode.Swap:
      state.applySwap(qubits[0]!, qubits[1]!);
      return;
    case Opcode.Ccx:
      state.applyCcx(qubits[0]!, qubits[1]!, qubits[2]!);
      return;
    case Opcode.Barrier:
      // A barrier constrains the optimiser; it has no effect on the state.
      return;
    case Opcode.Measure:
    case Opcode.Reset:
      throw new Error(
        `applyInstruction received the non-unitary opcode '${opcode}'; use executeCircuit instead`,
      );
    default: {
      const m = singleQubitMatrix(opcode, params);
      if (!m) throw new Error(`No kernel for opcode '${opcode}'`);
      state.applyMatrix(qubits[0]!, m);
    }
  }
}

function assertExecutable(module: IrModule, shots: number): void {
  if (module.qubitCount > HARD_MAX_QUBITS) {
    throw new RangeError(
      `Circuit uses ${module.qubitCount} qubits (${statevectorBytes(module.qubitCount)} bytes); the hard limit is ${HARD_MAX_QUBITS}`,
    );
  }
  if (!Number.isInteger(shots) || shots < 1 || shots > MAX_SHOTS) {
    throw new RangeError(`shots must be an integer in 1..${MAX_SHOTS}, got ${shots}`);
  }
}

/** Render a classical register, most significant bit first. */
export function formatRegister(register: ClassicalRegister): string {
  let out = '';
  for (let i = register.length - 1; i >= 0; i--) out += register[i] === 1 ? '1' : '0';
  return out;
}

/** Classical bits written by at least one measurement, ascending. */
function measuredClbitsOf(module: IrModule): number[] {
  const out = new Set<number>();
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Measure && instruction.clbit !== undefined) {
      out.add(instruction.clbit);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Execute `module` for `shots` repetitions.
 *
 * Picks the sampling strategy automatically; `result.strategy` reports which
 * was used, and both paths produce the same distribution.
 */
export function executeCircuit(
  module: IrModule,
  options: ExecuteOptions = {},
): ExecutionResult {
  const shots = options.shots ?? 1;
  assertExecutable(module, shots);

  const seed = options.seed ?? randomSeed();
  const rng = new Prng(seed);
  const started = performance.now();
  const counts = new Map<string, number>();
  const measuredClbits = measuredClbitsOf(module);

  if (requiresPerShotReplay(module)) {
    let lastState = Statevector.zeroState(module.qubitCount);
    let lastProbabilities = lastState.probabilities();

    for (let shot = 0; shot < shots; shot++) {
      const state = Statevector.zeroState(module.qubitCount);
      const register: ClassicalRegister = new Uint8Array(module.clbitCount);

      for (const instruction of module.instructions) {
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
      lastProbabilities = state.probabilities();
    }

    return {
      shots,
      seed,
      strategy: 'per-shot-replay',
      counts,
      finalState: lastState,
      probabilities: lastProbabilities,
      measuredClbits,
      elapsedMs: performance.now() - started,
    };
  }

  // --- terminal sampling ---
  const state = Statevector.zeroState(module.qubitCount);
  const measurements: IrInstruction[] = [];
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Measure) {
      measurements.push(instruction);
      continue;
    }
    applyInstruction(state, instruction);
  }

  const probabilities = state.probabilities();

  if (measurements.length === 0) {
    // Nothing is measured, so every shot yields the all-zero register. The
    // statevector is still the useful output here.
    const key = formatRegister(new Uint8Array(module.clbitCount));
    counts.set(key, shots);
  } else {
    const samples = sampleManyBasisStates(probabilities, shots, rng);
    const register: ClassicalRegister = new Uint8Array(module.clbitCount);
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

  return {
    shots,
    seed,
    strategy: 'terminal-sampling',
    counts,
    finalState: state,
    probabilities,
    measuredClbits,
    elapsedMs: performance.now() - started,
  };
}

/**
 * Exact measurement probability for each classical register value, with no
 * sampling at all.
 *
 * This is the distribution that `executeCircuit` draws from; comparing the two
 * is how the test suite checks that shot sampling converges to the right
 * answer. Only valid for circuits with terminal measurements.
 */
export function exactRegisterDistribution(module: IrModule): Map<string, number> {
  if (requiresPerShotReplay(module)) {
    throw new Error(
      'exactRegisterDistribution requires terminal measurements; this circuit needs per-shot replay',
    );
  }
  const state = Statevector.zeroState(module.qubitCount);
  const measurements: IrInstruction[] = [];
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Measure) measurements.push(instruction);
    else applyInstruction(state, instruction);
  }

  const probabilities = state.probabilities();
  const out = new Map<string, number>();
  const register: ClassicalRegister = new Uint8Array(module.clbitCount);

  for (let basis = 0; basis < probabilities.length; basis++) {
    const p = probabilities[basis]!;
    if (p === 0) continue;
    register.fill(0);
    for (const instruction of measurements) {
      if (instruction.clbit === undefined) continue;
      register[instruction.clbit] = ((basis >> instruction.qubits[0]!) & 1) as 0 | 1;
    }
    const key = formatRegister(register);
    out.set(key, (out.get(key) ?? 0) + p);
  }
  return out;
}

export type { MeasurementOutcome };
