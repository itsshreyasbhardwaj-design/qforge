import { Opcode, circuitDepth, gateCount, type IrModule } from './ir.js';
import { formatAngle } from '../backends/angle.js';

export interface PrintIrOptions {
  /** Prefix each instruction with its index. Default true. */
  readonly showIndices?: boolean;
  /** Append the originating source line/column. Default true. */
  readonly showSourceMap?: boolean;
  /** Use qubit labels (`alice`) instead of indices (`%0`). Default false. */
  readonly useLabels?: boolean;
}

/**
 * Render the IR as a stable, line-oriented text form.
 *
 * Qubits print as `%0`, `%1` (global indices) and classical bits as `$0`, so
 * the dump makes the syntax-independence of the IR visible at a glance. The
 * format is designed for reading and for diffing in tests, not for parsing
 * back in.
 */
export function printIr(module: IrModule, options: PrintIrOptions = {}): string {
  const { showIndices = true, showSourceMap = true, useLabels = false } = options;
  const lines: string[] = [];

  lines.push(`; qforge ir`);
  lines.push(`; qubits ${module.qubitCount} [${module.qubitLabels.join(', ')}]`);
  lines.push(`; clbits ${module.clbitCount} [${module.clbitLabels.join(', ')}]`);
  lines.push(
    `; instructions ${module.instructions.length}  gates ${gateCount(module)}  depth ${circuitDepth(module)}`,
  );
  lines.push(
    `; passes ${module.metadata.passes.length ? module.metadata.passes.join(' -> ') : '(none)'}`,
  );

  const q = (index: number): string =>
    useLabels ? (module.qubitLabels[index] ?? `%${index}`) : `%${index}`;
  const c = (index: number): string =>
    useLabels ? (module.clbitLabels[index] ?? `$${index}`) : `$${index}`;

  module.instructions.forEach((instruction, i) => {
    const parts: string[] = [];
    if (showIndices) parts.push(`${String(i).padStart(4, ' ')}:`);

    const params = instruction.params.length
      ? `(${instruction.params.map((p) => formatAngle(p)).join(', ')})`
      : '';
    const operands = instruction.qubits.map(q).join(', ');

    if (instruction.opcode === Opcode.Measure) {
      parts.push(`measure ${operands} -> ${c(instruction.clbit ?? 0)}`);
    } else if (instruction.opcode === Opcode.Barrier && instruction.qubits.length === 0) {
      parts.push('barrier *');
    } else {
      parts.push(`${instruction.opcode}${params} ${operands}`.trim());
    }

    if (showSourceMap) {
      parts.push(`; line ${instruction.loc.line}:${instruction.loc.column}`);
    }
    lines.push(parts.join(' '));
  });

  return lines.join('\n');
}
