import { GATES } from '@qforge/language';
import {
  FULLY_SYMMETRIC_OPCODES,
  Opcode,
  isUnitary,
  sameCondition,
  withInstructions,
  type IrInstruction,
  type IrModule,
} from '../ir/ir.js';
import { removeIndices, scanAdjacentPairs } from './adjacency.js';
import type { Pass, PassResult } from './pass.js';

/**
 * Do two instructions apply the *same* operator?
 *
 * Operand order matters in general: `cx a, b` and `cx b, a` are different
 * operators. The exceptions are recorded in the IR:
 *   - `cz` and `swap` are symmetric in both operands;
 *   - `ccx` is symmetric in its two controls but not in its target.
 */
function sameOperator(a: IrInstruction, b: IrInstruction): boolean {
  if (a.opcode !== b.opcode) return false;
  if (a.qubits.length !== b.qubits.length) return false;
  // Differently predicated gates are different operators: at runtime one may
  // fire and the other not, so `h q` and `if (c == 1) h q` never cancel.
  if (!sameCondition(a.condition, b.condition)) return false;

  if (FULLY_SYMMETRIC_OPCODES.has(a.opcode)) {
    const sortedA = [...a.qubits].sort((x, y) => x - y);
    const sortedB = [...b.qubits].sort((x, y) => x - y);
    return sortedA.every((q, i) => q === sortedB[i]);
  }

  if (a.opcode === Opcode.Ccx) {
    const controlsA = [a.qubits[0]!, a.qubits[1]!].sort((x, y) => x - y);
    const controlsB = [b.qubits[0]!, b.qubits[1]!].sort((x, y) => x - y);
    return (
      controlsA[0] === controlsB[0] &&
      controlsA[1] === controlsB[1] &&
      a.qubits[2] === b.qubits[2]
    );
  }

  return a.qubits.every((q, i) => q === b.qubits[i]);
}

/**
 * Cancel a pair of adjacent self-inverse gates.
 *
 * Applies to `h`, `x`, `y`, `z`, `cx`, `cz`, `swap` and `ccx` — every gate the
 * table marks `selfInverse`, i.e. `G * G = I` exactly. The pair must be
 * adjacent on its shared qubit set (see `adjacency.ts`) and must apply the same
 * operator, so `cx a, b; cx b, a` is correctly left alone.
 */
export const cancelSelfInverse: Pass = {
  name: 'cancel-self-inverse',
  description: 'Cancels two adjacent applications of the same self-inverse gate.',
  justification:
    "For G with G*G = I, two adjacent factors G G in the circuit compose to the identity. Adjacency is checked on the gate's full qubit set, so no intervening operation on those qubits can invalidate the rewrite, and operand order is compared with each gate's own symmetry.",

  run(module: IrModule): PassResult {
    const remove = new Set<number>();
    const notes: string[] = [];

    scanAdjacentPairs(module.instructions, module.qubitCount, ({ first, second }) => {
      const a = module.instructions[first]!;
      const b = module.instructions[second]!;
      if (!isUnitary(a.opcode)) return 'none';
      if (!GATES.get(a.opcode)?.selfInverse) return 'none';
      if (!sameOperator(a, b)) return 'none';

      remove.add(first);
      remove.add(second);
      notes.push(`cancelled ${a.opcode} pair at lines ${a.loc.line} and ${b.loc.line}`);
      return 'both-gone';
    });

    if (remove.size === 0) return { module, changed: 0, notes: [] };
    return {
      module: withInstructions(module, removeIndices(module.instructions, remove)),
      changed: remove.size,
      notes,
    };
  },
};

/**
 * Cancel a pair of adjacent gates that are each other's exact inverse:
 * `s`/`sdg` and `t`/`tdg`.
 */
export const cancelInversePair: Pass = {
  name: 'cancel-inverse-pair',
  description: 'Cancels adjacent gate pairs that are exact inverses, such as s then sdg.',
  justification:
    'The gate table records which mnemonics are exact inverses. For such a pair, G Ginv = I, and the adjacency test guarantees the two are neighbouring factors on the same qubit.',

  run(module: IrModule): PassResult {
    const remove = new Set<number>();
    const notes: string[] = [];

    scanAdjacentPairs(module.instructions, module.qubitCount, ({ first, second }) => {
      const a = module.instructions[first]!;
      const b = module.instructions[second]!;
      if (!isUnitary(a.opcode) || !isUnitary(b.opcode)) return 'none';
      if (!sameCondition(a.condition, b.condition)) return 'none';
      const signature = GATES.get(a.opcode);
      if (!signature?.inverseOf || signature.inverseOf !== b.opcode) return 'none';
      // Both are single-qubit gates; the adjacency scan already proved they act
      // on the same qubit set.
      remove.add(first);
      remove.add(second);
      notes.push(`cancelled ${a.opcode}/${b.opcode} at lines ${a.loc.line} and ${b.loc.line}`);
      return 'both-gone';
    });

    if (remove.size === 0) return { module, changed: 0, notes: [] };
    return {
      module: withInstructions(module, removeIndices(module.instructions, remove)),
      changed: remove.size,
      notes,
    };
  },
};
