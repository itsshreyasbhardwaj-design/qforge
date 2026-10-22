import { describe, expect, it } from 'vitest';
import { parse, parseExpressionOnly } from './parser.js';
import { evaluateConstExpression } from '../semantic/constants.js';
import type { Expression, GateApplication, Statement } from '../ast/nodes.js';

const statements = (src: string): readonly Statement[] => parse(src).program.statements;
const codes = (src: string): string[] => parse(src).diagnostics.map((d) => d.code);

/** Parse a bare expression and fold it, for precedence testing. */
const evalExpr = (src: string): number => {
  const { expression, diagnostics } = parseExpressionOnly(src);
  expect(diagnostics, `unexpected diagnostics for ${src}`).toHaveLength(0);
  const result = evaluateConstExpression(expression as Expression);
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
};

describe('parser: declarations', () => {
  it('parses a scalar qubit declaration', () => {
    const [stmt] = statements('qubit alice;');
    expect(stmt).toMatchObject({ kind: 'QubitDeclaration', name: 'alice' });
    expect((stmt as { size?: unknown }).size).toBeUndefined();
  });

  it('parses a qubit register with a constant size expression', () => {
    const [stmt] = statements('qubit[2 + 1] q;');
    expect(stmt!.kind).toBe('QubitDeclaration');
    expect((stmt as { size?: Expression }).size!.kind).toBe('BinaryExpr');
  });

  it('parses bit declarations and registers', () => {
    expect(statements('bit c;')[0]).toMatchObject({ kind: 'BitDeclaration', name: 'c' });
    expect(statements('bit[3] c;')[0]!.kind).toBe('BitDeclaration');
  });

  it('parses a const declaration', () => {
    expect(statements('const theta = pi / 4;')[0]).toMatchObject({
      kind: 'ConstDeclaration',
      name: 'theta',
    });
  });
});

describe('parser: gate applications', () => {
  it('parses a single-qubit gate', () => {
    expect(statements('h alice;')[0]).toMatchObject({
      kind: 'GateApplication',
      gate: 'h',
    });
  });

  it('parses a two-qubit gate with a comma-separated operand list', () => {
    const stmt = statements('cx alice, bob;')[0] as GateApplication;
    expect(stmt.operands.map((o) => o.name)).toEqual(['alice', 'bob']);
  });

  it('parses a parameterised gate', () => {
    const stmt = statements('rx(pi / 2) q;')[0] as GateApplication;
    expect(stmt.gate).toBe('rx');
    expect(stmt.params).toHaveLength(1);
    expect(stmt.operands).toHaveLength(1);
  });

  it('parses indexed operands', () => {
    const stmt = statements('cx q[0], q[1];')[0] as GateApplication;
    expect(stmt.operands[0]!.index).toBeDefined();
    expect(stmt.operands[1]!.name).toBe('q');
  });

  it('records a span for the gate mnemonic alone', () => {
    const src = 'rx(pi) q;';
    const stmt = statements(src)[0] as GateApplication;
    expect(src.slice(stmt.gateSpan.start, stmt.gateSpan.end)).toBe('rx');
  });
});

describe('parser: measure, reset, barrier', () => {
  it('parses measure with an arrow', () => {
    expect(statements('measure alice -> result;')[0]).toMatchObject({
      kind: 'MeasureStatement',
      qubit: { name: 'alice' },
      target: { name: 'result' },
    });
  });

  it('parses reset', () => {
    expect(statements('reset q;')[0]!.kind).toBe('ResetStatement');
  });

  it('parses a bare barrier as applying to all qubits', () => {
    const stmt = statements('barrier;')[0]!;
    expect(stmt.kind).toBe('BarrierStatement');
    expect((stmt as { qubits: unknown[] }).qubits).toHaveLength(0);
  });

  it('parses a barrier with an operand list', () => {
    const stmt = statements('barrier a, b;')[0]!;
    expect((stmt as { qubits: unknown[] }).qubits).toHaveLength(2);
  });
});

describe('parser: expression precedence', () => {
  it('multiplication binds tighter than addition', () => {
    expect(evalExpr('1 + 2 * 3')).toBe(7);
  });

  it('subtraction and division are left associative', () => {
    expect(evalExpr('10 - 3 - 2')).toBe(5);
    expect(evalExpr('16 / 4 / 2')).toBe(2);
  });

  it('exponentiation is right associative', () => {
    expect(evalExpr('2 ^ 3 ^ 2')).toBe(512);
  });

  it('exponentiation binds tighter than unary minus', () => {
    expect(evalExpr('-2 ^ 2')).toBe(-4);
  });

  it('parentheses override precedence', () => {
    expect(evalExpr('(1 + 2) * 3')).toBe(9);
    expect(evalExpr('(-2) ^ 2')).toBe(4);
  });

  it('handles stacked unary operators', () => {
    expect(evalExpr('--3')).toBe(3);
    expect(evalExpr('-+-3')).toBe(3);
  });

  it('evaluates pi-relative angles the way the spec documents', () => {
    expect(evalExpr('pi / 2')).toBeCloseTo(Math.PI / 2, 15);
    expect(evalExpr('3 * pi / 4')).toBeCloseTo((3 * Math.PI) / 4, 15);
    expect(evalExpr('tau')).toBeCloseTo(2 * Math.PI, 15);
  });
});

describe('parser: diagnostics', () => {
  it('reports a missing semicolon', () => {
    expect(codes('h q')).toContain('QF102');
  });

  it('reports an unclosed parameter list', () => {
    expect(codes('rx(pi q;')).toContain('QF104');
  });

  it('reports a missing arrow in measure', () => {
    expect(codes('measure q result;')).toContain('QF105');
  });

  it('reports a missing expression where the grammar requires one', () => {
    expect(codes('h q[];')).toContain('QF106');
    expect(codes('rx(1,) q;')).toContain('QF106');
  });

  it('leaves parameter-count checking to the analyser, not the grammar', () => {
    // `rx()` is syntactically a gate application with an empty parameter list.
    // Arity is a static-semantics rule (QF205), so the parser stays silent.
    expect(codes('rx() q;')).toHaveLength(0);
  });

  it('reports an empty register size', () => {
    expect(codes('qubit[] q;')).toContain('QF109');
  });

  it('reports a missing close bracket', () => {
    expect(codes('h q[0;')).toContain('QF108');
  });

  it('reports a statement that cannot start', () => {
    expect(codes(';')).toContain('QF101');
  });

  it('reports unexpected end of input', () => {
    expect(codes('rx(')).toContain('QF107');
  });
});

describe('parser: error recovery', () => {
  it('recovers after a bad statement and parses the rest', () => {
    const { program, diagnostics } = parse('qubit a\nh a;\nx a;');
    expect(diagnostics.length).toBeGreaterThan(0);
    // The malformed declaration is dropped, but both gates still parse.
    const gates = program.statements.filter((s) => s.kind === 'GateApplication');
    expect(gates).toHaveLength(2);
  });

  it('reports multiple independent errors in one pass', () => {
    const { diagnostics } = parse('h q\nx r\ny s\n');
    expect(diagnostics.filter((d) => d.code === 'QF102').length).toBeGreaterThanOrEqual(2);
  });

  it('does not double-report a lexical error as a syntax error', () => {
    const { diagnostics } = parse('h q;\n$\nx q;');
    expect(diagnostics.filter((d) => d.code === 'QF001')).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
  });

  it('terminates on pathological input instead of looping', () => {
    const inputs = ['((((', '-----', ',,,,', 'measure measure measure', '[[[['];
    for (const src of inputs) {
      expect(() => parse(src)).not.toThrow();
    }
  });
});

describe('parser: spans', () => {
  it('statement spans cover the whole statement including the semicolon', () => {
    const src = 'cx alice, bob;';
    const [stmt] = statements(src);
    expect(src.slice(stmt!.span.start, stmt!.span.end)).toBe(src);
  });

  it('operand spans cover the index', () => {
    const src = 'h q[12];';
    const stmt = statements(src)[0] as GateApplication;
    expect(src.slice(stmt.operands[0]!.span.start, stmt.operands[0]!.span.end)).toBe('q[12]');
  });
});
