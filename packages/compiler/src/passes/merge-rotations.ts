import {
  Opcode,
  sameCondition,
  withInstructions,
  type IrInstruction,
  type IrModule,
} from '../ir/ir.js';
import { scanAdjacentPairs } from './adjacency.js';
import type { Pass, PassResult } from './pass.js';

/** Gates that form a one-parameter group under addition of their angle. */
const MERGEABLE: ReadonlySet<Opcode> = new Set<Opcode>([
  Opcode.Rx,
  Opcode.Ry,
  Opcode.Rz,
  Opcode.P,
]);

/**
 * Fuse two adjacent same-axis rotations into one.
 *
 * `rx(a) rx(b) = rx(a+b)` holds *exactly*, not just up to phase: each of `rx`,
 * `ry`, `rz` and `p` is a one-parameter group, `R(a)R(b) = R(a+b)`. So the
 * rewrite preserves the operator, and any resulting zero angle is then removed
 * by `remove-identity` on the next round of the pass manager.
 *
 * Floating-point note: `a + b` is a single rounding of the true sum, so the
 * merged gate can differ from the unmerged product by at most one ulp in the
 * angle. The property test allows that tolerance rather than demanding bitwise
 * equality.
 */
export const mergeRotations: Pass = {
  name: 'merge-rotations',
  description: 'Fuses two adjacent rotations about the same axis into a single rotation.',
  justification:
    'rx, ry, rz and p are one-parameter groups: R(a) R(b) = R(a+b) exactly. The adjacency test proves the two rotations are neighbouring factors on the same qubit, so the product may be replaced by the fused gate.',

  run(module: IrModule): PassResult {
    const instructions: IrInstruction[] = [...module.instructions];
    const remove = new Set<number>();
    const notes: string[] = [];

    scanAdjacentPairs(module.instructions, module.qubitCount, ({ first, second }) => {
      const a = instructions[first]!;
      const b = instructions[second]!;
      if (a.opcode !== b.opcode || !MERGEABLE.has(a.opcode)) return 'none';
      if (a.qubits[0] !== b.qubits[0]) return 'none';
      // Only fuse rotations that fire under the same circumstances.
      if (!sameCondition(a.condition, b.condition)) return 'none';

      const merged = (a.params[0] ?? 0) + (b.params[0] ?? 0);
      // Rewrite the earlier instruction in place and drop the later one. The
      // `kept-first` verdict keeps `first` as the live instruction on this
      // qubit, so a run of three or more same-axis rotations accumulates into
      // it within this single scan.
      instructions[first] = { ...a, params: [merged] };
      remove.add(second);
      notes.push(
        `merged ${a.opcode} at lines ${a.loc.line} and ${b.loc.line} into ${a.opcode}(${merged})`,
      );
      return 'kept-first';
    });

    if (remove.size === 0) return { module, changed: 0, notes: [] };
    const kept = instructions.filter((_, index) => !remove.has(index));
    return { module: withInstructions(module, kept), changed: remove.size, notes };
  },
};
