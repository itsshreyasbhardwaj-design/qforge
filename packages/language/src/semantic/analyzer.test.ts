import { describe, expect, it } from 'vitest';
import { parse } from '../parser/parser.js';
import { analyze } from './analyzer.js';
import { BROWSER_LIMITS } from './limits.js';

const check = (src: string) => analyze(parse(src).program);
const codes = (src: string): string[] => check(src).diagnostics.map((d) => d.code);
const ok = (src: string) => {
  const result = check(src);
  expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  return result;
};

describe('analyzer: index allocation', () => {
  it('assigns contiguous global indices in declaration order', () => {
    const model = ok('qubit a; qubit b; qubit[2] q;');
    expect(model.qubitCount).toBe(4);
    expect(model.qubitLabels).toEqual(['a', 'b', 'q[0]', 'q[1]']);
  });

  it('keeps qubit and classical index spaces separate', () => {
    const model = ok('qubit a; bit c; bit[2] d;');
    expect(model.qubitCount).toBe(1);
    expect(model.clbitCount).toBe(3);
    expect(model.clbitLabels).toEqual(['c', 'd[0]', 'd[1]']);
  });

  it('resolves an indexed operand to base + offset', () => {
    const model = ok('qubit a; qubit[3] q; h q[2];');
    const op = model.operations[0]!;
    expect(op.kind).toBe('gate');
    expect(op.kind === 'gate' && op.qubits[0]!.index).toBe(3);
    expect(op.kind === 'gate' && op.qubits[0]!.label).toBe('q[2]');
  });

  it('drops declarations from the operation list', () => {
    const model = ok('qubit a; bit c; const k = 1; h a; measure a -> c;');
    expect(model.operations.map((o) => o.kind)).toEqual(['gate', 'measure']);
  });
});

describe('analyzer: angle folding', () => {
  it('folds a constant expression to a double', () => {
    const model = ok('qubit q; rx(pi / 2) q;');
    const op = model.operations[0]!;
    expect(op.kind === 'gate' && op.params[0]).toBeCloseTo(Math.PI / 2, 15);
  });

  it('resolves user constants declared earlier', () => {
    const model = ok('const theta = pi / 8; qubit q; rz(2 * theta) q;');
    const op = model.operations[0]!;
    expect(op.kind === 'gate' && op.params[0]).toBeCloseTo(Math.PI / 4, 15);
  });

  it('rejects a constant used before declaration', () => {
    expect(codes('qubit q; rx(theta) q; const theta = 1;')).toContain('QF202');
  });

  it('rejects division by zero', () => {
    expect(codes('qubit q; rx(1 / 0) q;')).toContain('QF214');
  });

  it('rejects a qubit name used as an angle', () => {
    expect(codes('qubit q; rx(q) q;')).toContain('QF202');
  });
});

describe('analyzer: declaration errors', () => {
  it('reports a duplicate declaration and points at the first one', () => {
    const result = check('qubit a; qubit a;');
    const dup = result.diagnostics.find((d) => d.code === 'QF201')!;
    expect(dup).toBeDefined();
    expect(dup.related?.[0]!.span.line).toBe(1);
  });

  it('reports a name reused across kinds', () => {
    expect(codes('qubit a; bit a;')).toContain('QF201');
    expect(codes('const a = 1; qubit a;')).toContain('QF201');
  });

  it('rejects a zero-length or fractional register', () => {
    expect(codes('qubit[0] q;')).toContain('QF215');
    expect(codes('qubit[1.5] q;')).toContain('QF215');
    expect(codes('qubit[-1] q;')).toContain('QF215');
  });
});

describe('analyzer: gate validation', () => {
  it('reports an unknown gate with a suggestion', () => {
    const diag = check('qubit q; hadamard q;').diagnostics.find((d) => d.code === 'QF203')!;
    expect(diag).toBeDefined();
    const near = check('qubit q; hh q;').diagnostics.find((d) => d.code === 'QF203')!;
    expect(near.hint).toContain("'h'");
  });

  it('reports wrong qubit arity', () => {
    expect(codes('qubit a; cx a;')).toContain('QF204');
    expect(codes('qubit a; qubit b; h a, b;')).toContain('QF204');
    expect(codes('qubit a; qubit b; qubit c; ccx a, b;')).toContain('QF204');
  });

  it('reports wrong parameter count', () => {
    expect(codes('qubit q; rx q;')).toContain('QF205');
    expect(codes('qubit q; h(pi) q;')).toContain('QF205');
    expect(codes('qubit q; rx(1, 2) q;')).toContain('QF205');
  });

  it('rejects identical control and target', () => {
    expect(codes('qubit a; cx a, a;')).toContain('QF208');
    expect(codes('qubit[2] q; cz q[1], q[1];')).toContain('QF208');
    expect(codes('qubit[3] q; ccx q[0], q[1], q[0];')).toContain('QF208');
  });

  it('accepts distinct operands that alias the same register', () => {
    ok('qubit[2] q; cx q[0], q[1];');
  });
});

describe('analyzer: type rules', () => {
  it('rejects a classical bit used as a qubit', () => {
    expect(codes('bit c; h c;')).toContain('QF206');
  });

  it('rejects a qubit used as a measurement target', () => {
    expect(codes('qubit a; qubit b; measure a -> b;')).toContain('QF207');
  });

  it('rejects a constant used as an operand', () => {
    expect(codes('const k = 1; h k;')).toContain('QF206');
  });

  it('reports an unknown qubit', () => {
    const diag = check('qubit control; cx control, target;').diagnostics.find(
      (d) => d.code === 'QF202',
    )!;
    expect(diag.message).toContain("Unknown qubit 'target'");
    expect(diag.span.line).toBe(1);
  });

  it('suggests a near-miss operand name', () => {
    const diag = check('qubit alice; h alise;').diagnostics.find((d) => d.code === 'QF202')!;
    expect(diag.hint).toContain('alice');
  });
});

describe('analyzer: register indexing rules', () => {
  it('requires an index on a register', () => {
    expect(codes('qubit[2] q; h q;')).toContain('QF213');
  });

  it('rejects indexing a scalar', () => {
    expect(codes('qubit a; h a[0];')).toContain('QF212');
  });

  it('rejects an out-of-range index', () => {
    const diag = check('qubit[2] q; h q[2];').diagnostics.find((d) => d.code === 'QF211')!;
    expect(diag.message).toContain('0..1');
  });

  it('accepts an index computed from a constant', () => {
    ok('const i = 1; qubit[3] q; h q[i + 1];');
  });

  it('allows a single-element register to be indexed at 0', () => {
    ok('qubit[1] q; h q[0];');
  });

  it('still requires an index on a single-element register', () => {
    // Audit finding A-3: this used to be accepted, because the check keyed on
    // the register's size rather than on how it was declared. Whether a bare
    // name is legal must not depend on a number that could change.
    expect(codes('qubit[1] q; h q;')).toContain('QF213');
    expect(codes('bit[1] c; qubit q; measure q -> c;')).toContain('QF213');
  });

  it('reports the register size in the message, singular or plural', () => {
    const one = check('qubit[1] q; h q;').diagnostics.find((d) => d.code === 'QF213')!;
    expect(one.message).toContain('register of 1 qubit ');
    const many = check('qubit[3] q; h q;').diagnostics.find((d) => d.code === 'QF213')!;
    expect(many.message).toContain('register of 3 qubits ');
  });
});

describe('analyzer: resource limits', () => {
  it('rejects a program over the qubit limit', () => {
    const src = `qubit[${BROWSER_LIMITS.maxQubits + 1}] q;`;
    expect(analyze(parse(src).program).diagnostics.map((d) => d.code)).toContain('QF301');
  });

  it('counts qubits cumulatively across declarations', () => {
    const half = Math.floor(BROWSER_LIMITS.maxQubits / 2) + 1;
    const src = `qubit[${half}] a; qubit[${half}] b; qubit[${half}] c;`;
    expect(analyze(parse(src).program).diagnostics.map((d) => d.code)).toContain('QF301');
  });

  it('honours a custom limit', () => {
    const limits = { maxQubits: 2, maxClassicalBits: 2, maxInstructions: 10 };
    expect(
      analyze(parse('qubit[3] q;').program, { limits }).diagnostics.map((d) => d.code),
    ).toContain('QF301');
    expect(analyze(parse('qubit[2] q;').program, { limits }).ok).toBe(true);
  });

  it('rejects too many classical bits', () => {
    const limits = { maxQubits: 4, maxClassicalBits: 2, maxInstructions: 10 };
    expect(
      analyze(parse('bit[3] c;').program, { limits }).diagnostics.map((d) => d.code),
    ).toContain('QF305');
  });
});

describe('analyzer: error accumulation', () => {
  it('reports every independent error rather than stopping at the first', () => {
    const result = check('qubit a; h b; cx a, a; rx a; measure a -> a;');
    const found = new Set(result.diagnostics.map((d) => d.code));
    expect(found).toContain('QF202'); // unknown b
    expect(found).toContain('QF208'); // cx a, a
    expect(found).toContain('QF205'); // rx missing parameter
    expect(found).toContain('QF207'); // measuring into a qubit
  });

  it('returns diagnostics sorted by source position', () => {
    const result = check('qubit a;\nh zz;\nh yy;');
    const positions = result.diagnostics.map((d) => d.span.start);
    expect([...positions]).toEqual([...positions].sort((x, y) => x - y));
  });

  it('keeps analysing after a bad statement', () => {
    const result = check('qubit a; h nope; x a;');
    expect(result.operations).toHaveLength(1);
    expect(result.ok).toBe(false);
  });
});

describe('analyzer: accepted programs', () => {
  it('accepts the Bell-state program from the README', () => {
    const model = ok(`
      qubit alice;
      qubit bob;

      bit resultA;
      bit resultB;

      h alice;
      cx alice, bob;

      measure alice -> resultA;
      measure bob -> resultB;
    `);
    expect(model.qubitCount).toBe(2);
    expect(model.clbitCount).toBe(2);
    expect(model.operations.map((o) => o.kind)).toEqual(['gate', 'gate', 'measure', 'measure']);
  });

  it('accepts reset and barrier', () => {
    const model = ok('qubit[2] q; h q[0]; barrier q[0], q[1]; reset q[0]; barrier;');
    expect(model.operations.map((o) => o.kind)).toEqual([
      'gate',
      'barrier',
      'reset',
      'barrier',
    ]);
  });

  it('accepts every gate in the table at its declared arity', () => {
    ok(`
      qubit[3] q;
      id q[0]; h q[0]; x q[0]; y q[0]; z q[0];
      s q[0]; sdg q[0]; t q[0]; tdg q[0];
      p(pi / 8) q[0]; rx(pi / 2) q[0]; ry(pi / 3) q[0]; rz(pi / 4) q[0];
      cx q[0], q[1]; cz q[0], q[1]; swap q[0], q[1];
      ccx q[0], q[1], q[2];
    `);
  });
});
