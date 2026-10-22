import type { SourceSpan } from '../diagnostics/span.js';
import { ErrorCode } from '../diagnostics/codes.js';
import {
  error,
  hasErrors,
  sortDiagnostics,
  type Diagnostic,
} from '../diagnostics/diagnostic.js';
import type {
  BarrierStatement,
  Expression,
  GateApplication,
  MeasureStatement,
  OperandRef,
  Program,
  ResetStatement,
} from '../ast/nodes.js';
import { SymbolTable, type SymbolEntry } from './symbols.js';
import { evaluateConstExpression, evaluateIntExpression } from './constants.js';
import { lookupGate, suggestFrom, suggestGate, type GateSignature } from './gates.js';
import { DEFAULT_LIMITS, HARD_MAX_QUBITS, type ResourceLimits } from './limits.js';

/** A single qubit or classical bit, resolved to its global index. */
export interface ResolvedOperand {
  /** Declared symbol name, e.g. `q`. */
  readonly symbol: string;
  /** Global index into the qubit or classical-bit space. */
  readonly index: number;
  /** Display label: `alice` for a scalar, `q[2]` for a register element. */
  readonly label: string;
  readonly span: SourceSpan;
}

/**
 * The validated, name-resolved form of one executable statement.
 *
 * Declarations do not appear here: they are folded into the symbol table and
 * the qubit/bit index space. What remains is exactly the sequence the compiler
 * lowers into IR.
 */
export type ResolvedOperation =
  | {
      readonly kind: 'gate';
      readonly gate: GateSignature;
      readonly qubits: readonly ResolvedOperand[];
      /** Angle parameters, already folded to doubles. */
      readonly params: readonly number[];
      readonly node: GateApplication;
    }
  | {
      readonly kind: 'measure';
      readonly qubit: ResolvedOperand;
      readonly clbit: ResolvedOperand;
      readonly node: MeasureStatement;
    }
  | { readonly kind: 'reset'; readonly qubit: ResolvedOperand; readonly node: ResetStatement }
  | {
      readonly kind: 'barrier';
      readonly qubits: readonly ResolvedOperand[];
      readonly node: BarrierStatement;
    };

export interface SemanticModel {
  readonly symbols: SymbolTable;
  readonly operations: readonly ResolvedOperation[];
  readonly qubitCount: number;
  readonly clbitCount: number;
  /** Flat display labels indexed by global qubit index. */
  readonly qubitLabels: readonly string[];
  /** Flat display labels indexed by global classical-bit index. */
  readonly clbitLabels: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  /** True when no error-severity diagnostic was produced. */
  readonly ok: boolean;
}

export interface AnalyzeOptions {
  readonly limits?: ResourceLimits;
}

/**
 * Semantic analysis: build the symbol table, resolve every operand to a global
 * index, fold angle expressions, and validate the static rules of the language.
 *
 * The analyser never throws and never stops at the first problem. Each
 * statement is checked independently so the editor can underline all of them;
 * a statement that fails validation is dropped from `operations` while the
 * rest of the program continues to be analysed.
 */
export function analyze(program: Program, options: AnalyzeOptions = {}): SemanticModel {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const diagnostics: Diagnostic[] = [];
  const symbols = new SymbolTable();
  const operations: ResolvedOperation[] = [];
  const qubitLabels: string[] = [];
  const clbitLabels: string[] = [];

  const report = (d: Diagnostic): void => {
    diagnostics.push(d);
  };

  const redeclaration = (name: string, span: SourceSpan, existing: SymbolEntry): void => {
    report(
      error(
        ErrorCode.DuplicateDeclaration,
        `'${name}' is already declared`,
        span,
        'Choose a different name; QForge has a single flat scope and no shadowing.',
        [{ span: existing.declSpan, message: `previous declaration of '${name}'` }],
      ),
    );
  };

  /** Evaluate a register size, defaulting to a scalar when absent. */
  const sizeOf = (
    sizeExpr: Expression | undefined,
    what: string,
  ): { size: number; isRegister: boolean } | undefined => {
    if (!sizeExpr) return { size: 1, isRegister: false };
    const result = evaluateIntExpression(sizeExpr, symbols.constScope(), what);
    if (!result.ok) {
      report(result.diagnostic);
      return undefined;
    }
    if (result.value < 1) {
      report(
        error(
          ErrorCode.InvalidRegisterSize,
          `${what} must be at least 1, got ${result.value}`,
          sizeExpr.span,
          'A register needs at least one element.',
        ),
      );
      return undefined;
    }
    return { size: result.value, isRegister: true };
  };

  // ------------------------------------------------------------- resolution
  //
  // Declared before the main loop so the single pass below can both declare
  // names and resolve operands against the names declared so far.

  /**
   * Resolve `ref` to a single global index, checking that it names a
   * declaration of the expected kind and that any index is in range.
   */
  const resolveOperand = (
    ref: OperandRef,
    expected: 'qubit' | 'bit',
  ): ResolvedOperand | undefined => {
    const entry = symbols.lookup(ref.name);
    if (!entry) {
      const candidates = symbols
        .all()
        .filter((e) => e.kind === expected)
        .map((e) => e.name);
      const suggestion = suggestFrom(ref.name, candidates);
      report(
        error(
          ErrorCode.UnknownIdentifier,
          `Unknown ${expected} '${ref.name}'`,
          ref.nameSpan,
          suggestion
            ? `Did you mean '${suggestion}'?`
            : `Declare it first, for example '${expected} ${ref.name};'.`,
        ),
      );
      return undefined;
    }

    if (entry.kind === 'const') {
      report(
        error(
          expected === 'qubit' ? ErrorCode.BitUsedAsQubit : ErrorCode.QubitUsedAsBit,
          `'${ref.name}' is a constant, not a ${expected}`,
          ref.nameSpan,
          'Constants may only appear inside angle expressions.',
        ),
      );
      return undefined;
    }

    if (entry.kind !== expected) {
      report(
        error(
          expected === 'qubit' ? ErrorCode.BitUsedAsQubit : ErrorCode.QubitUsedAsBit,
          expected === 'qubit'
            ? `'${ref.name}' is a classical bit and cannot be used as a qubit`
            : `'${ref.name}' is a qubit and cannot be used as classical storage`,
          ref.nameSpan,
          expected === 'qubit'
            ? 'Gates act on qubits; classical bits only receive measurement results.'
            : 'Measurement results must be stored in a bit declared with "bit".',
        ),
      );
      return undefined;
    }

    const base = entry.baseIndex ?? 0;
    const size = entry.size ?? 1;

    if (!ref.index) {
      // Keyed on how the name was *declared*, not on its size. A size-1
      // register is still a register, so `qubit[1] q; h q;` is an error just
      // as `qubit[2] q; h q;` is: whether a bare name is legal must not depend
      // on a number that could change.
      if (entry.isRegister) {
        report(
          error(
            ErrorCode.RegisterWhereSingleExpected,
            `'${ref.name}' is a register of ${size} ${expected}${size === 1 ? '' : 's'} and needs an index`,
            ref.span,
            `Write ${ref.name}[0] to select a single element.`,
          ),
        );
        return undefined;
      }
      return { symbol: entry.name, index: base, label: qLabel(entry, 0), span: ref.span };
    }

    if (!entry.isRegister) {
      report(
        error(
          ErrorCode.CannotIndexScalar,
          `'${ref.name}' is a single ${expected} and cannot be indexed`,
          ref.span,
          `Declare it as '${expected}[n] ${ref.name};' if you want a register.`,
        ),
      );
      return undefined;
    }

    const indexValue = evaluateIntExpression(ref.index, symbols.constScope(), 'An index');
    if (!indexValue.ok) {
      report(indexValue.diagnostic);
      return undefined;
    }
    if (indexValue.value >= size) {
      report(
        error(
          ErrorCode.IndexOutOfRange,
          `Index ${indexValue.value} is out of range for '${ref.name}', which has ${size} elements (0..${size - 1})`,
          ref.index.span,
        ),
      );
      return undefined;
    }

    return {
      symbol: entry.name,
      index: base + indexValue.value,
      label: qLabel(entry, indexValue.value),
      span: ref.span,
    };
  };

  const qLabel = (entry: SymbolEntry, offset: number): string =>
    entry.isRegister ? `${entry.name}[${offset}]` : entry.name;

  // --------------------------------------------------------------- main pass
  //
  // One ordered walk over the program. QForge is strictly declare-before-use:
  // there is no hoisting, so a name is visible only to the statements that
  // follow its declaration. That keeps the reading order of a circuit the same
  // as its execution order, and it is why declarations and operations are
  // handled in a single pass rather than two.
  for (const statement of program.statements) {
    if (operations.length >= limits.maxInstructions) {
      report(
        error(
          ErrorCode.TooManyInstructions,
          `Program exceeds the limit of ${limits.maxInstructions} operations`,
          statement.span,
        ),
      );
      break;
    }

    switch (statement.kind) {
      case 'ConstDeclaration': {
        const existing = symbols.lookup(statement.name);
        if (existing) {
          redeclaration(statement.name, statement.nameSpan, existing);
          break;
        }
        const value = evaluateConstExpression(statement.value, symbols.constScope());
        if (!value.ok) {
          report(value.diagnostic);
          break;
        }
        symbols.declare({
          name: statement.name,
          kind: 'const',
          declSpan: statement.nameSpan,
          value: value.value,
        });
        break;
      }

      case 'QubitDeclaration': {
        const existing = symbols.lookup(statement.name);
        if (existing) {
          redeclaration(statement.name, statement.nameSpan, existing);
          break;
        }
        const shape = sizeOf(statement.size, 'A qubit register size');
        if (!shape) break;
        if (qubitLabels.length + shape.size > limits.maxQubits) {
          report(
            error(
              ErrorCode.TooManyQubits,
              `Declaring '${statement.name}' would use ${qubitLabels.length + shape.size} qubits; the limit is ${limits.maxQubits}`,
              statement.span,
              `A statevector needs 2^n amplitudes, so memory doubles per qubit. The hard ceiling is ${HARD_MAX_QUBITS}.`,
            ),
          );
          break;
        }
        const baseIndex = qubitLabels.length;
        for (let i = 0; i < shape.size; i++) {
          qubitLabels.push(shape.isRegister ? `${statement.name}[${i}]` : statement.name);
        }
        symbols.declare({
          name: statement.name,
          kind: 'qubit',
          declSpan: statement.nameSpan,
          baseIndex,
          size: shape.size,
          isRegister: shape.isRegister,
        });
        break;
      }

      case 'BitDeclaration': {
        const existing = symbols.lookup(statement.name);
        if (existing) {
          redeclaration(statement.name, statement.nameSpan, existing);
          break;
        }
        const shape = sizeOf(statement.size, 'A bit register size');
        if (!shape) break;
        if (clbitLabels.length + shape.size > limits.maxClassicalBits) {
          report(
            error(
              ErrorCode.TooManyClassicalBits,
              `Declaring '${statement.name}' would use ${clbitLabels.length + shape.size} classical bits; the limit is ${limits.maxClassicalBits}`,
              statement.span,
            ),
          );
          break;
        }
        const baseIndex = clbitLabels.length;
        for (let i = 0; i < shape.size; i++) {
          clbitLabels.push(shape.isRegister ? `${statement.name}[${i}]` : statement.name);
        }
        symbols.declare({
          name: statement.name,
          kind: 'bit',
          declSpan: statement.nameSpan,
          baseIndex,
          size: shape.size,
          isRegister: shape.isRegister,
        });
        break;
      }

      case 'GateApplication': {
        const signature = lookupGate(statement.gate);
        if (!signature) {
          const suggestion = suggestGate(statement.gate);
          report(
            error(
              ErrorCode.UnknownGate,
              `Unknown gate '${statement.gate}'`,
              statement.gateSpan,
              suggestion
                ? `Did you mean '${suggestion}'?`
                : 'See docs/language-spec.md for the supported gate set.',
            ),
          );
          break;
        }

        let valid = true;

        if (statement.params.length !== signature.params) {
          report(
            error(
              ErrorCode.GateParameterMismatch,
              `Gate '${signature.name}' takes ${signature.params} parameter${signature.params === 1 ? '' : 's'}, got ${statement.params.length}`,
              statement.paramListSpan ?? statement.gateSpan,
              signature.params === 0
                ? `Write '${signature.name} q;' with no parentheses.`
                : `Write '${signature.name}(pi / 2) q;'.`,
            ),
          );
          valid = false;
        }

        if (statement.operands.length !== signature.qubits) {
          report(
            error(
              ErrorCode.GateArityMismatch,
              `Gate '${signature.name}' acts on ${signature.qubits} qubit${signature.qubits === 1 ? '' : 's'}, got ${statement.operands.length}`,
              statement.span,
              signature.qubits === 2
                ? `Write '${signature.name} control, target;'.`
                : `Write '${signature.name} ${'q, '.repeat(Math.max(0, signature.qubits - 1))}q;'.`,
            ),
          );
          valid = false;
        }

        const params: number[] = [];
        for (const expr of statement.params) {
          const value = evaluateConstExpression(expr, symbols.constScope());
          if (!value.ok) {
            report(value.diagnostic);
            valid = false;
            continue;
          }
          params.push(value.value);
        }

        const qubits: ResolvedOperand[] = [];
        for (const operand of statement.operands) {
          const resolved = resolveOperand(operand, 'qubit');
          if (!resolved) {
            valid = false;
            continue;
          }
          qubits.push(resolved);
        }

        // Distinct-operand rule: a multi-qubit gate must act on distinct
        // qubits. `cx a, a` is not a no-op, it is undefined — the gate's
        // matrix is only defined on a tensor product of distinct factors.
        if (valid && qubits.length > 1) {
          const seen = new Map<number, ResolvedOperand>();
          for (const q of qubits) {
            const previous = seen.get(q.index);
            if (previous) {
              report(
                error(
                  ErrorCode.DuplicateQubitOperand,
                  `Gate '${signature.name}' uses qubit '${q.label}' more than once`,
                  q.span,
                  'Control and target must be different qubits.',
                  [{ span: previous.span, message: 'first use' }],
                ),
              );
              valid = false;
              break;
            }
            seen.set(q.index, q);
          }
        }

        if (valid) {
          operations.push({ kind: 'gate', gate: signature, qubits, params, node: statement });
        }
        break;
      }

      case 'MeasureStatement': {
        const qubit = resolveOperand(statement.qubit, 'qubit');
        const clbit = resolveOperand(statement.target, 'bit');
        if (qubit && clbit) {
          operations.push({ kind: 'measure', qubit, clbit, node: statement });
        }
        break;
      }

      case 'ResetStatement': {
        const qubit = resolveOperand(statement.qubit, 'qubit');
        if (qubit) operations.push({ kind: 'reset', qubit, node: statement });
        break;
      }

      case 'BarrierStatement': {
        const qubits: ResolvedOperand[] = [];
        let valid = true;
        for (const operand of statement.qubits) {
          const resolved = resolveOperand(operand, 'qubit');
          if (!resolved) {
            valid = false;
            continue;
          }
          qubits.push(resolved);
        }
        if (valid) operations.push({ kind: 'barrier', qubits, node: statement });
        break;
      }
    }
  }

  const sorted = sortDiagnostics(diagnostics);
  return {
    symbols,
    operations,
    qubitCount: qubitLabels.length,
    clbitCount: clbitLabels.length,
    qubitLabels,
    clbitLabels,
    diagnostics: sorted,
    ok: !hasErrors(sorted),
  };
}
