import type { SourceSpan } from '@qforge/language';

/**
 * QForge quantum intermediate representation.
 *
 * The IR is deliberately *not* the AST. Three properties matter:
 *
 *  1. **Syntax independence.** Instructions name qubits by global integer
 *     index, never by source identifier. Registers, indexing and scoping have
 *     all been resolved away, so a backend never has to understand QForge
 *     syntax.
 *  2. **Flatness.** A module is a linear instruction list. There is no nesting,
 *     which is what makes the optimisation passes and the step debugger simple
 *     and auditable.
 *  3. **Source mapping.** Every instruction keeps the span of the statement it
 *     came from, so the studio can map a gate back to a line and a line forward
 *     to the gates it produced.
 *
 * Angle parameters are already-evaluated doubles: constant folding happens in
 * the frontend, so no backend ever sees an expression tree.
 */

export const Opcode = {
  Id: 'id',
  H: 'h',
  X: 'x',
  Y: 'y',
  Z: 'z',
  S: 's',
  Sdg: 'sdg',
  T: 't',
  Tdg: 'tdg',
  P: 'p',
  Rx: 'rx',
  Ry: 'ry',
  Rz: 'rz',
  Cx: 'cx',
  Cz: 'cz',
  Swap: 'swap',
  Ccx: 'ccx',
  Measure: 'measure',
  Reset: 'reset',
  Barrier: 'barrier',
} as const;

export type Opcode = (typeof Opcode)[keyof typeof Opcode];

/** Opcodes that are unitary gates (everything except measure/reset/barrier). */
export const UNITARY_OPCODES: ReadonlySet<Opcode> = new Set<Opcode>([
  Opcode.Id,
  Opcode.H,
  Opcode.X,
  Opcode.Y,
  Opcode.Z,
  Opcode.S,
  Opcode.Sdg,
  Opcode.T,
  Opcode.Tdg,
  Opcode.P,
  Opcode.Rx,
  Opcode.Ry,
  Opcode.Rz,
  Opcode.Cx,
  Opcode.Cz,
  Opcode.Swap,
  Opcode.Ccx,
]);

export function isUnitary(opcode: Opcode): boolean {
  return UNITARY_OPCODES.has(opcode);
}

/**
 * Opcodes whose qubit operands may be permuted without changing the operator.
 *
 * Used by the cancellation pass: `cz a, b` and `cz b, a` are the same operator,
 * so they cancel, whereas `cx a, b` and `cx b, a` are different operators and
 * must not. For `ccx` only the two controls commute, which is handled
 * specially rather than by this flag.
 */
export const FULLY_SYMMETRIC_OPCODES: ReadonlySet<Opcode> = new Set<Opcode>([
  Opcode.Cz,
  Opcode.Swap,
]);

export interface IrInstruction {
  readonly opcode: Opcode;
  /** Global qubit indices, in operand order (control(s) first, then target). */
  readonly qubits: readonly number[];
  /** Evaluated angle parameters in radians. Empty for non-parameterised gates. */
  readonly params: readonly number[];
  /** Destination classical bit index. Present only for `measure`. */
  readonly clbit?: number;
  /** Span of the source statement this instruction was lowered from. */
  readonly loc: SourceSpan;
}

/**
 * A declared qubit or classical-bit register, retained so backends can emit
 * declarations that keep the programmer's own names instead of flattening
 * everything into one anonymous array.
 */
export interface IrRegister {
  readonly name: string;
  /** Global index of element 0. */
  readonly baseIndex: number;
  readonly size: number;
  /** False for a scalar `qubit a;`, true for `qubit[n] a;`. */
  readonly isRegister: boolean;
}

export interface IrMetadata {
  /** Names of the passes that ran, in order. Empty when unoptimised. */
  readonly passes: readonly string[];
  /** Human-readable notes from the passes, for the studio's inspector. */
  readonly notes: readonly string[];
}

export interface IrModule {
  readonly qubitCount: number;
  readonly clbitCount: number;
  /** Display labels indexed by global qubit index, e.g. `['alice','q[0]']`. */
  readonly qubitLabels: readonly string[];
  readonly clbitLabels: readonly string[];
  /** Qubit registers in declaration order. */
  readonly qubitRegisters: readonly IrRegister[];
  /** Classical-bit registers in declaration order. */
  readonly clbitRegisters: readonly IrRegister[];
  readonly instructions: readonly IrInstruction[];
  readonly metadata: IrMetadata;
}

/** The register containing `index`, plus the offset within it. */
export function resolveRegister(
  registers: readonly IrRegister[],
  index: number,
): { register: IrRegister; offset: number } | undefined {
  for (const register of registers) {
    if (index >= register.baseIndex && index < register.baseIndex + register.size) {
      return { register, offset: index - register.baseIndex };
    }
  }
  return undefined;
}

/** Circuit depth: the longest chain of instructions sharing a qubit. */
export function circuitDepth(module: IrModule): number {
  const depthOf = new Array<number>(module.qubitCount).fill(0);
  let max = 0;
  for (const instruction of module.instructions) {
    const touched =
      instruction.opcode === Opcode.Barrier && instruction.qubits.length === 0
        ? Array.from({ length: module.qubitCount }, (_, i) => i)
        : instruction.qubits;
    let level = 0;
    for (const q of touched) level = Math.max(level, depthOf[q] ?? 0);
    level += 1;
    for (const q of touched) depthOf[q] = level;
    max = Math.max(max, level);
  }
  return max;
}

/** Count of each opcode, for the studio's gate statistics panel. */
export function opcodeHistogram(module: IrModule): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const instruction of module.instructions) {
    counts[instruction.opcode] = (counts[instruction.opcode] ?? 0) + 1;
  }
  return counts;
}

/** Number of unitary gate instructions (excludes measure/reset/barrier). */
export function gateCount(module: IrModule): number {
  return module.instructions.filter((i) => isUnitary(i.opcode)).length;
}

/** True when no gate acts on a qubit after that qubit has been measured. */
export function hasMidCircuitMeasurement(module: IrModule): boolean {
  const measured = new Set<number>();
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Measure) {
      const q = instruction.qubits[0];
      if (q !== undefined) measured.add(q);
      continue;
    }
    if (instruction.opcode === Opcode.Barrier) continue;
    // A reset or gate acting on an already-measured qubit means the circuit
    // cannot be sampled from a single final statevector.
    if (instruction.qubits.some((q) => measured.has(q))) return true;
  }
  return false;
}

/** All qubit indices an instruction acts on, expanding a bare barrier. */
export function touchedQubits(instruction: IrInstruction, qubitCount: number): number[] {
  if (instruction.opcode === Opcode.Barrier && instruction.qubits.length === 0) {
    return Array.from({ length: qubitCount }, (_, i) => i);
  }
  return [...instruction.qubits];
}

export function withInstructions(
  module: IrModule,
  instructions: readonly IrInstruction[],
  metadata?: Partial<IrMetadata>,
): IrModule {
  return {
    ...module,
    instructions,
    metadata: { ...module.metadata, ...metadata },
  };
}
