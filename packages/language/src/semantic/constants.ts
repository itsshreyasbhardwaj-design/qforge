import { ErrorCode } from '../diagnostics/codes.js';
import { error, type Diagnostic } from '../diagnostics/diagnostic.js';
import type { Expression } from '../ast/nodes.js';
import { MAX_EXPRESSION_DEPTH } from './limits.js';

/**
 * Built-in named constants available in angle expressions.
 *
 * `pi` is JavaScript's `Math.PI`, the IEEE-754 double nearest to pi. All angle
 * arithmetic is double precision; docs/quantum-math.md records the resulting
 * error bounds.
 */
export const BUILTIN_CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['tau', Math.PI * 2],
  ['euler', Math.E],
]);

export interface ConstScope {
  /** User constants declared with `const`, by name. */
  readonly get: (name: string) => number | undefined;
}

export const EMPTY_SCOPE: ConstScope = { get: () => undefined };

export type EvalResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Evaluate a constant angle expression over the AST.
 *
 * QForge angles are compile-time constants: there is no runtime expression
 * evaluation and, critically, no `eval` of user source anywhere in the system.
 * The whole language of expressions is numbers, named constants and five
 * operators, so this tree walk is the entire evaluator.
 */
export function evaluateConstExpression(
  expr: Expression,
  scope: ConstScope = EMPTY_SCOPE,
  depth = 0,
): EvalResult {
  // The parser already bounds the depth of any tree it produces, so this guard
  // only fires for an AST built programmatically. It is here because the
  // package is a public API: a caller that hands us a 100,000-deep tree should
  // get a diagnostic, not an uncatchable stack overflow.
  if (depth > MAX_EXPRESSION_DEPTH) {
    return {
      ok: false,
      diagnostic: error(
        ErrorCode.ExpressionTooDeep,
        `Expression nests deeper than ${MAX_EXPRESSION_DEPTH} levels`,
        expr.span,
        'Split it into named constants with "const".',
      ),
    };
  }

  switch (expr.kind) {
    case 'NumberLiteral':
      return { ok: true, value: expr.value };

    case 'IdentifierExpr': {
      const user = scope.get(expr.name);
      if (user !== undefined) return { ok: true, value: user };
      const builtin = BUILTIN_CONSTANTS.get(expr.name);
      if (builtin !== undefined) return { ok: true, value: builtin };
      return {
        ok: false,
        diagnostic: error(
          ErrorCode.UnknownIdentifier,
          `Unknown constant '${expr.name}' in expression`,
          expr.span,
          `Known constants are ${[...BUILTIN_CONSTANTS.keys()].join(', ')}, plus any name declared with 'const'.`,
        ),
      };
    }

    case 'GroupExpr':
      return evaluateConstExpression(expr.inner, scope, depth + 1);

    case 'UnaryExpr': {
      const operand = evaluateConstExpression(expr.operand, scope, depth + 1);
      if (!operand.ok) return operand;
      return { ok: true, value: expr.operator === '-' ? -operand.value : operand.value };
    }

    case 'BinaryExpr': {
      const left = evaluateConstExpression(expr.left, scope, depth + 1);
      if (!left.ok) return left;
      const right = evaluateConstExpression(expr.right, scope, depth + 1);
      if (!right.ok) return right;

      let value: number;
      switch (expr.operator) {
        case '+':
          value = left.value + right.value;
          break;
        case '-':
          value = left.value - right.value;
          break;
        case '*':
          value = left.value * right.value;
          break;
        case '/':
          if (right.value === 0) {
            return {
              ok: false,
              diagnostic: error(
                ErrorCode.DivisionByZero,
                'Division by zero in a constant expression',
                expr.span,
                'Angles must evaluate to a finite number.',
              ),
            };
          }
          value = left.value / right.value;
          break;
        case '^':
          value = Math.pow(left.value, right.value);
          break;
      }

      if (!Number.isFinite(value)) {
        return {
          ok: false,
          diagnostic: error(
            ErrorCode.NonConstantExpression,
            `Expression does not evaluate to a finite number (got ${value})`,
            expr.span,
            'Check for overflow or an undefined operation such as 0^-1.',
          ),
        };
      }
      return { ok: true, value };
    }
  }
}

/** Evaluate an expression that must be a non-negative integer (register size, index). */
export function evaluateIntExpression(
  expr: Expression,
  scope: ConstScope,
  what: string,
): EvalResult {
  const result = evaluateConstExpression(expr, scope);
  if (!result.ok) return result;
  if (!Number.isInteger(result.value) || result.value < 0) {
    return {
      ok: false,
      diagnostic: error(
        ErrorCode.InvalidRegisterSize,
        `${what} must be a non-negative integer, got ${result.value}`,
        expr.span,
        'Use a whole number such as 0, 1 or 3.',
      ),
    };
  }
  return result;
}
