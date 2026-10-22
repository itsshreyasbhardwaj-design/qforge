import { describe, expect, it } from 'vitest';
import { checkSource } from '../index.js';
import { CLI_LIMITS, MAX_EXPRESSION_DEPTH } from '../semantic/limits.js';
import { evaluateConstExpression } from '../semantic/constants.js';
import { walk } from '../ast/nodes.js';
import { parse } from './parser.js';
import type { Expression } from '../ast/nodes.js';

/**
 * Regression tests for audit finding A-1.
 *
 * Deeply nested expressions used to overflow the JavaScript call stack, which
 * surfaced as an uncaught `RangeError` rather than a diagnostic: the CLI exited
 * 3 printing "Maximum call stack size exceeded" with no source location, and
 * the studio showed "the compiler threw an exception" for what is ordinary bad
 * input. Both contradicted the documented promise that malformed input always
 * produces a reportable diagnostic.
 *
 * There were two distinct overflow sites, and both are covered here:
 *   - parser recursion, reached by nested parentheses or unary operators;
 *   - the constant evaluator's recursion down a left-associative chain, which
 *     the parser builds with *constant* recursion, so a parser-only depth guard
 *     would not have caught it.
 */

const check = (source: string) => checkSource(source, { limits: CLI_LIMITS });
const codes = (source: string) => check(source).diagnostics.map((d) => d.code);

const nestedParens = (n: number) => `qubit q; rx(${'('.repeat(n)}1${')'.repeat(n)}) q;`;
const nestedUnary = (n: number) => `qubit q; rx(${'-'.repeat(n)}1) q;`;
const leftChain = (n: number) => `qubit q; rx(${'1+'.repeat(n)}1) q;`;
const rightChain = (n: number) => `qubit q; rx(${'2^'.repeat(n)}2) q;`;

describe('expression depth limit', () => {
  it('accepts everything a person would plausibly write', () => {
    expect(codes('qubit q; rx(((pi / 2) + (pi / 4)) * 2) q;')).toEqual([]);
    expect(codes(nestedParens(10))).toEqual([]);
    expect(codes(leftChain(50))).toEqual([]);
  });

  it('accepts nesting right up to the limit', () => {
    // A chain of n additions is a tree of depth n + 1.
    expect(codes(leftChain(MAX_EXPRESSION_DEPTH - 1))).toEqual([]);
  });

  it('rejects nesting past the limit instead of crashing', () => {
    expect(codes(leftChain(MAX_EXPRESSION_DEPTH + 5))).toContain('QF111');
  });

  it.each([
    ['nested parentheses', nestedParens(5_000)],
    ['nested unary minus', nestedUnary(5_000)],
    ['left-associative chain', leftChain(50_000)],
    ['right-associative chain', rightChain(5_000)],
    ['nested register size', `qubit[${'('.repeat(5_000)}1${')'.repeat(5_000)}] q;`],
    ['nested index', `qubit[2] q; h q[${'('.repeat(5_000)}0${')'.repeat(5_000)}];`],
    ['unclosed parentheses', `qubit q; rx(${'('.repeat(50_000)}`],
  ])('%s produces a diagnostic rather than throwing', (_name, source) => {
    let result;
    expect(() => {
      result = check(source);
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    expect(result!.diagnostics.length).toBeGreaterThan(0);
  });

  it('reports the depth limit with a source position and a hint', () => {
    const diagnostic = check(leftChain(1_000)).diagnostics.find((d) => d.code === 'QF111')!;
    expect(diagnostic).toBeDefined();
    expect(diagnostic.message).toContain(String(MAX_EXPRESSION_DEPTH));
    expect(diagnostic.span.line).toBe(1);
    expect(diagnostic.span.column).toBeGreaterThan(0);
    expect(diagnostic.hint).toContain('const');
  });

  it('keeps analysing the rest of the file after an over-deep expression', () => {
    const source = `qubit q;\nrx(${'1+'.repeat(1_000)}1) q;\nh nope;\n`;
    const found = codes(source);
    expect(found).toContain('QF111');
    expect(found).toContain('QF202');
  });

  it('bounds the depth of every tree the parser produces', () => {
    const depthOf = (expr: Expression): number => {
      switch (expr.kind) {
        case 'BinaryExpr':
          return Math.max(depthOf(expr.left), depthOf(expr.right)) + 1;
        case 'UnaryExpr':
          return depthOf(expr.operand) + 1;
        case 'GroupExpr':
          return depthOf(expr.inner) + 1;
        default:
          return 1;
      }
    };
    for (const source of [leftChain(500), nestedParens(500), nestedUnary(500)]) {
      for (const statement of parse(source).program.statements) {
        if (statement.kind !== 'GateApplication') continue;
        for (const param of statement.params) {
          expect(depthOf(param)).toBeLessThanOrEqual(MAX_EXPRESSION_DEPTH);
        }
      }
    }
  });
});

describe('recursive AST consumers survive a hand-built deep tree', () => {
  /** Build a left-nested `1+1+...` tree directly, bypassing the parser. */
  function deepTree(depth: number): Expression {
    const span = { start: 0, end: 1, line: 1, column: 1, endLine: 1, endColumn: 2 };
    let node: Expression = { kind: 'NumberLiteral', value: 1, span };
    for (let i = 0; i < depth; i++) {
      node = {
        kind: 'BinaryExpr',
        operator: '+',
        left: node,
        right: { kind: 'NumberLiteral', value: 1, span },
        span,
      };
    }
    return node;
  }

  it('the constant evaluator reports a diagnostic instead of overflowing', () => {
    const result = evaluateConstExpression(deepTree(100_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe('QF111');
  });

  it('the evaluator still folds a tree within the limit', () => {
    const result = evaluateConstExpression(deepTree(MAX_EXPRESSION_DEPTH - 2));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(MAX_EXPRESSION_DEPTH - 1);
  });

  it('walk is iterative, so it handles a tree far past the limit', () => {
    let count = 0;
    expect(() => walk(deepTree(200_000), () => count++)).not.toThrow();
    expect(count).toBe(400_001);
  });
});

describe('malformed numbers report one problem, not two', () => {
  it('a number that overflows to infinity yields a single lexical diagnostic', () => {
    // Regression for audit finding A-4: the lexer reported QF004 and the parser
    // then added QF106 for the same character run.
    expect(codes('qubit q; rx(1e400) q;')).toEqual(['QF004']);
  });

  it('an implicit product reports only the malformed literal', () => {
    expect(codes('qubit q; rx(2pi) q;')).toEqual(['QF003']);
  });

  it('a stray character inside an expression is reported once', () => {
    expect(codes('qubit q; rx(1 $ 2) q;')).toEqual(['QF001']);
  });
});
