import { describe, expect, it } from 'vitest';
import { parse } from '../parser/parser.js';
import { childrenOf, nodeAtOffset, statementAtOffset, walk, type AstNode } from './nodes.js';

/**
 * The traversal helpers are public API used by the studio to map an editor
 * caret to the statement and IR instruction under it. They are tested here
 * rather than only through the UI, since a browser test would not pin down the
 * innermost-node rule.
 */

const programOf = (source: string) => parse(source).program;

describe('childrenOf', () => {
  it('returns direct children in source order', () => {
    const program = programOf('qubit[2] q; cx q[0], q[1];');
    expect(childrenOf(program)).toHaveLength(2);

    const gate = program.statements[1]!;
    const children = childrenOf(gate);
    expect(children.map((c) => c.kind)).toEqual(['OperandRef', 'OperandRef']);
  });

  it('includes parameters before operands for a parameterised gate', () => {
    const gate = programOf('qubit q; rx(pi / 2) q;').statements[1]!;
    expect(childrenOf(gate).map((c) => c.kind)).toEqual(['BinaryExpr', 'OperandRef']);
  });

  it('includes a register size only when one was written', () => {
    expect(childrenOf(programOf('qubit q;').statements[0]!)).toHaveLength(0);
    expect(childrenOf(programOf('qubit[3] q;').statements[0]!)).toHaveLength(1);
  });

  it('includes an operand index only when one was written', () => {
    const scalar = childrenOf(programOf('qubit a; h a;').statements[1]!)[0]!;
    expect(childrenOf(scalar)).toHaveLength(0);
    const indexed = childrenOf(programOf('qubit[2] q; h q[1];').statements[1]!)[0]!;
    expect(childrenOf(indexed)).toHaveLength(1);
  });

  it('returns nothing for leaves', () => {
    const literal = programOf('qubit q; rx(1) q;').statements[1]!;
    const param = childrenOf(literal)[0]!;
    expect(param.kind).toBe('NumberLiteral');
    expect(childrenOf(param)).toEqual([]);
  });

  it('covers every statement kind', () => {
    const program = programOf(`
      const k = 1;
      qubit[2] q;
      bit c;
      h q[0];
      measure q[0] -> c;
      reset q[1];
      barrier q[0], q[1];
    `);
    for (const statement of program.statements) {
      expect(() => childrenOf(statement)).not.toThrow();
    }
    const kinds = program.statements.map((s) => s.kind);
    expect(kinds).toEqual([
      'ConstDeclaration',
      'QubitDeclaration',
      'BitDeclaration',
      'GateApplication',
      'MeasureStatement',
      'ResetStatement',
      'BarrierStatement',
    ]);
  });

  it('descends through grouped and unary expressions', () => {
    const gate = programOf('qubit q; rx(-(1 + 2)) q;').statements[1]!;
    const unary = childrenOf(gate)[0]!;
    expect(unary.kind).toBe('UnaryExpr');
    const group = childrenOf(unary)[0]!;
    expect(group.kind).toBe('GroupExpr');
    expect(childrenOf(group)[0]!.kind).toBe('BinaryExpr');
  });
});

describe('walk', () => {
  it('visits every node depth-first, parents before children', () => {
    const program = programOf('qubit q; rx(pi / 2) q;');
    const visited: string[] = [];
    walk(program, (node) => visited.push(node.kind));
    expect(visited[0]).toBe('Program');
    expect(visited).toContain('BinaryExpr');
    expect(visited).toContain('IdentifierExpr');
    expect(visited).toContain('NumberLiteral');
    expect(visited.indexOf('BinaryExpr')).toBeLessThan(visited.indexOf('NumberLiteral'));
  });

  it('visits each node exactly once', () => {
    const program = programOf('qubit[2] q; h q[0]; cx q[0], q[1];');
    const seen = new Set<AstNode>();
    let count = 0;
    walk(program, (node) => {
      expect(seen.has(node)).toBe(false);
      seen.add(node);
      count++;
    });
    expect(count).toBe(seen.size);
  });
});

describe('nodeAtOffset', () => {
  const source = 'qubit alice;\nqubit bob;\ncx alice, bob;\n';
  const program = programOf(source);

  it('finds the innermost node containing an offset', () => {
    const offset = source.indexOf('bob;\n', source.indexOf('cx'));
    const node = nodeAtOffset(program, offset);
    expect(node?.kind).toBe('OperandRef');
    expect((node as { name?: string }).name).toBe('bob');
  });

  it('prefers the smallest span when spans nest', () => {
    const inner = nodeAtOffset(programOf('qubit q; rx(pi) q;'), 'qubit q; rx('.length);
    expect(inner?.kind).toBe('IdentifierExpr');
  });

  it('returns undefined past the end of the program', () => {
    expect(nodeAtOffset(program, source.length + 10)).toBeUndefined();
  });

  it('treats spans as half-open, so the offset after a token is outside it', () => {
    const src = 'qubit a;';
    const tree = programOf(src);
    const atName = nodeAtOffset(tree, src.indexOf('a'));
    expect(atName?.kind).toBe('QubitDeclaration');
    // Offset 8 is one past the final `;`.
    expect(nodeAtOffset(tree, 8)).toBeUndefined();
  });
});

describe('statementAtOffset', () => {
  const source = 'qubit a;\nqubit b;\nh a;\n';
  const program = programOf(source);

  it('returns the top-level statement containing the offset', () => {
    expect(statementAtOffset(program, 0)?.kind).toBe('QubitDeclaration');
    expect(statementAtOffset(program, source.indexOf('h a;'))?.kind).toBe('GateApplication');
  });

  it('returns undefined between statements and past the end', () => {
    // The newline after the first `;` belongs to no statement.
    expect(statementAtOffset(program, source.indexOf('\n'))).toBeUndefined();
    expect(statementAtOffset(program, source.length)).toBeUndefined();
  });

  it('returns undefined for an empty program', () => {
    expect(statementAtOffset(programOf(''), 0)).toBeUndefined();
  });
});
