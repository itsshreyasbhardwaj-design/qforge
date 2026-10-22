import {
  compile,
  Opcode,
  type IrInstruction,
  type IrModule,
  type IrRegister,
} from '@qforge/compiler';
import { Prng } from '@qforge/simulator';
import { CLI_LIMITS } from '@qforge/language';

/** A span placeholder for programmatically built IR, which has no source text. */
const SYNTHETIC_SPAN = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
} as const;

/** Compile source and return the IR module, failing loudly on any diagnostic. */
export function moduleFromSource(source: string, optimize = false): IrModule {
  const result = compile(source, { optimize, limits: CLI_LIMITS });
  if (!result.ok || !result.module) {
    const detail = result.diagnostics.map((d) => `${d.code}: ${d.message}`).join('; ');
    throw new Error(`Expected ${JSON.stringify(source)} to compile, got: ${detail}`);
  }
  return result.module;
}

/** Build an IR module directly, bypassing the frontend. */
export function makeModule(
  qubitCount: number,
  instructions: readonly Omit<IrInstruction, 'loc'>[],
  clbitCount = 0,
): IrModule {
  const qubitRegisters: IrRegister[] =
    qubitCount > 0 ? [{ name: 'q', baseIndex: 0, size: qubitCount, isRegister: true }] : [];
  const clbitRegisters: IrRegister[] =
    clbitCount > 0 ? [{ name: 'c', baseIndex: 0, size: clbitCount, isRegister: true }] : [];

  return {
    qubitCount,
    clbitCount,
    qubitLabels: Array.from({ length: qubitCount }, (_, i) => `q[${i}]`),
    clbitLabels: Array.from({ length: clbitCount }, (_, i) => `c[${i}]`),
    qubitRegisters,
    clbitRegisters,
    instructions: instructions.map((i) => ({ ...i, loc: SYNTHETIC_SPAN })),
    metadata: { passes: [], notes: [] },
  };
}

const ONE_QUBIT_NO_PARAM = [
  Opcode.H,
  Opcode.X,
  Opcode.Y,
  Opcode.Z,
  Opcode.S,
  Opcode.Sdg,
  Opcode.T,
  Opcode.Tdg,
  Opcode.Id,
] as const;
const ONE_QUBIT_PARAM = [Opcode.Rx, Opcode.Ry, Opcode.Rz, Opcode.P] as const;
const TWO_QUBIT = [Opcode.Cx, Opcode.Cz, Opcode.Swap] as const;

export interface RandomCircuitOptions {
  readonly qubitCount: number;
  readonly gateCount: number;
  readonly seed: number;
  /** Include three-qubit `ccx`. Requires at least 3 qubits. Default true. */
  readonly includeToffoli?: boolean;
}

/**
 * Generate a random unitary circuit.
 *
 * Used by the property tests: a fixed seed makes every generated circuit
 * reproducible, so a failure can be replayed exactly rather than described.
 */
export function randomCircuit(options: RandomCircuitOptions): IrModule {
  const { qubitCount, gateCount, seed, includeToffoli = true } = options;
  if (qubitCount < 1) throw new Error('randomCircuit needs at least one qubit');
  const rng = new Prng(seed);
  const instructions: Omit<IrInstruction, 'loc'>[] = [];

  /** Pick `count` distinct qubit indices. */
  const pickQubits = (count: number): number[] => {
    const pool = Array.from({ length: qubitCount }, (_, i) => i);
    const chosen: number[] = [];
    for (let i = 0; i < count; i++) {
      chosen.push(pool.splice(rng.nextInt(pool.length), 1)[0]!);
    }
    return chosen;
  };

  for (let i = 0; i < gateCount; i++) {
    const canUseTwo = qubitCount >= 2;
    const canUseThree = qubitCount >= 3 && includeToffoli;
    const roll = rng.nextFloat();

    if (canUseThree && roll < 0.1) {
      instructions.push({ opcode: Opcode.Ccx, qubits: pickQubits(3), params: [] });
    } else if (canUseTwo && roll < 0.4) {
      const opcode = TWO_QUBIT[rng.nextInt(TWO_QUBIT.length)]!;
      instructions.push({ opcode, qubits: pickQubits(2), params: [] });
    } else if (roll < 0.7) {
      const opcode = ONE_QUBIT_PARAM[rng.nextInt(ONE_QUBIT_PARAM.length)]!;
      // Angles spread over a few periods so sign conventions actually matter.
      const theta = (rng.nextFloat() - 0.5) * 8 * Math.PI;
      instructions.push({ opcode, qubits: pickQubits(1), params: [theta] });
    } else {
      const opcode = ONE_QUBIT_NO_PARAM[rng.nextInt(ONE_QUBIT_NO_PARAM.length)]!;
      instructions.push({ opcode, qubits: pickQubits(1), params: [] });
    }
  }

  return makeModule(qubitCount, instructions);
}

/** Total variation distance between two discrete distributions. */
export function totalVariationDistance(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let sum = 0;
  for (const key of keys) sum += Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0));
  return sum / 2;
}

/** Convert integer counts to a normalised distribution. */
export function countsToDistribution(
  counts: ReadonlyMap<string, number>,
  shots: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of counts) out.set(key, value / shots);
  return out;
}
