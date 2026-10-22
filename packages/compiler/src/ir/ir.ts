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

/**
 * A classical predicate guarding one instruction.
 *
 * Classical control is represented by *predicating* individual instructions
 * rather than by nesting them inside a block. The IR therefore stays a flat
 * list, which is the invariant the optimisation passes, the step debugger and
 * the circuit renderer are all built on. Predication is how real compilers
 * handle short conditional regions, and here it means `if` cost no structural
 * change at all downstream.
 */
export interface IrCondition {
  /** Classical bit indices, least significant first. */
  readonly clbits: readonly number[];
  /** Integer the register value is compared against. */
  readonly value: number;
  /** True for `!=`. */
  readonly negate: boolean;
  /** Display form, e.g. `c == 1`. */
  readonly text: string;
}

/** Do two predicates test the same thing? Used by the optimiser's safety check. */
export function sameCondition(a: IrCondition | undefined, b: IrCondition | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.value === b.value &&
    a.negate === b.negate &&
    a.clbits.length === b.clbits.length &&
    a.clbits.every((c, i) => c === b.clbits[i])
  );
}

/** Evaluate a predicate against a classical register. */
export function conditionHolds(
  condition: IrCondition,
  register: { readonly [index: number]: number } & { readonly length: number },
): boolean {
  let actual = 0;
  for (let i = 0; i < condition.clbits.length; i++) {
    const bit = register[condition.clbits[i]!] ?? 0;
    if (bit) actual |= 1 << i;
  }
  const equal = actual === condition.value;
  return condition.negate ? !equal : equal;
}

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
  /** Classical predicate; the instruction runs only when it holds. */
  readonly condition?: IrCondition;
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

/**
 * Every resource an instruction depends on or modifies, in one combined index
 * space: qubits keep their own indices, classical bit `c` becomes
 * `qubitCount + c`.
 *
 * This is what the optimiser's adjacency scan walks. Tracking qubits alone was
 * not enough once predication arrived: given
 *
 *   if (c == 1) h q1;  measure q0 -> c;  if (c == 1) h q1;
 *
 * the two conditional gates touch the same *qubit* with nothing between them,
 * so a qubit-only scan would see an adjacent pair of self-inverse gates and
 * cancel them. That is wrong -- the measurement in between can change `c`, so
 * at runtime one may fire and the other not. Including the classical bits a
 * predicate reads, and the bit a measurement writes, makes the dependency
 * visible and the rewrite is correctly refused.
 */
export function touchedResources(instruction: IrInstruction, qubitCount: number): number[] {
  const resources = touchedQubits(instruction, qubitCount);
  if (instruction.clbit !== undefined) resources.push(qubitCount + instruction.clbit);
  for (const clbit of instruction.condition?.clbits ?? []) {
    resources.push(qubitCount + clbit);
  }
  return [...new Set(resources)];
}

/** True when any instruction carries a classical predicate. */
export function hasClassicalControl(module: IrModule): boolean {
  return module.instructions.some((i) => i.condition !== undefined);
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
