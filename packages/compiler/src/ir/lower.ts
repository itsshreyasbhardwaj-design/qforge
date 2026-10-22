import type { ResolvedOperation, SemanticModel, SymbolEntry } from '@qforge/language';
import { Opcode, type IrInstruction, type IrModule, type IrRegister } from './ir.js';

/**
 * Lower a validated semantic model into IR.
 *
 * This is a mechanical translation: name resolution, type checking, arity
 * checking and angle folding have all already happened, so lowering cannot
 * fail and produces no diagnostics. Keeping it trivial is the point — all the
 * judgement lives in the analyser, and everything downstream sees one simple,
 * already-correct data structure.
 */
export function lower(model: SemanticModel): IrModule {
  const instructions: IrInstruction[] = [];

  for (const operation of model.operations) {
    instructions.push(lowerOperation(operation));
  }

  return {
    qubitCount: model.qubitCount,
    clbitCount: model.clbitCount,
    qubitLabels: [...model.qubitLabels],
    clbitLabels: [...model.clbitLabels],
    qubitRegisters: registersOf(model, 'qubit'),
    clbitRegisters: registersOf(model, 'bit'),
    instructions,
    metadata: { passes: [], notes: [] },
  };
}

/**
 * Collect declared registers in declaration order.
 *
 * Index allocation is contiguous and follows declaration order, so sorting by
 * `baseIndex` reproduces the order the programmer wrote.
 */
function registersOf(model: SemanticModel, kind: 'qubit' | 'bit'): IrRegister[] {
  return model.symbols
    .ofKind(kind)
    .filter((entry: SymbolEntry) => entry.baseIndex !== undefined)
    .sort((a: SymbolEntry, b: SymbolEntry) => (a.baseIndex ?? 0) - (b.baseIndex ?? 0))
    .map((entry: SymbolEntry) => ({
      name: entry.name,
      baseIndex: entry.baseIndex ?? 0,
      size: entry.size ?? 1,
      isRegister: entry.isRegister ?? false,
    }));
}

function lowerOperation(operation: ResolvedOperation): IrInstruction {
  switch (operation.kind) {
    case 'gate':
      return {
        // The gate table's mnemonics and the IR opcodes are deliberately the
        // same strings, so this needs no translation table to drift out of sync.
        opcode: operation.gate.name as Opcode,
        qubits: operation.qubits.map((q) => q.index),
        params: [...operation.params],
        loc: operation.node.span,
      };

    case 'measure':
      return {
        opcode: Opcode.Measure,
        qubits: [operation.qubit.index],
        params: [],
        clbit: operation.clbit.index,
        loc: operation.node.span,
      };

    case 'reset':
      return {
        opcode: Opcode.Reset,
        qubits: [operation.qubit.index],
        params: [],
        loc: operation.node.span,
      };

    case 'barrier':
      return {
        opcode: Opcode.Barrier,
        qubits: operation.qubits.map((q) => q.index),
        params: [],
        loc: operation.node.span,
      };
  }
}
