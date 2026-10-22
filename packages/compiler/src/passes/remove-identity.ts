import { Opcode, withInstructions, type IrModule } from '../ir/ir.js';
import { isIdentityPhase, isIdentityRotation } from './numeric.js';
import type { Pass, PassResult } from './pass.js';

/**
 * Drop instructions that are provably the identity operator.
 *
 * Three cases:
 *   - `id q`, which is the identity by definition;
 *   - `rx/ry/rz(theta)` where `theta` is a multiple of `4*pi`;
 *   - `p(theta)` where `theta` is a multiple of `2*pi`.
 *
 * See `numeric.ts` for why rotations need `4*pi` rather than `2*pi`.
 */
export const removeIdentity: Pass = {
  name: 'remove-identity',
  description: 'Removes gates that are exactly the identity operator.',
  justification:
    'id is the identity by definition. A Pauli rotation is the identity only at angles that are multiples of 4*pi (at 2*pi it equals -I, which differs by a global phase); p(theta) is the identity at multiples of 2*pi.',

  run(module: IrModule): PassResult {
    const notes: string[] = [];
    const kept = module.instructions.filter((instruction) => {
      const theta = instruction.params[0];
      switch (instruction.opcode) {
        case Opcode.Id:
          notes.push(`removed id at line ${instruction.loc.line}`);
          return false;
        case Opcode.Rx:
        case Opcode.Ry:
        case Opcode.Rz:
          if (theta !== undefined && isIdentityRotation(theta)) {
            notes.push(
              `removed ${instruction.opcode}(${theta}) at line ${instruction.loc.line}`,
            );
            return false;
          }
          return true;
        case Opcode.P:
          if (theta !== undefined && isIdentityPhase(theta)) {
            notes.push(`removed p(${theta}) at line ${instruction.loc.line}`);
            return false;
          }
          return true;
        default:
          return true;
      }
    });

    const changed = module.instructions.length - kept.length;
    return changed === 0
      ? { module, changed: 0, notes: [] }
      : { module: withInstructions(module, kept), changed, notes };
  },
};
