import { describe, expect, it } from 'vitest';
import { formatSource, isFormatted } from './format.js';
import { checkSource } from '../index.js';
import { CLI_LIMITS } from '../semantic/limits.js';

const format = (source: string): string => {
  const result = formatSource(source);
  expect(result.ok).toBe(true);
  return result.text;
};

describe('formatter: canonical spacing', () => {
  it('puts one statement per line', () => {
    expect(format('qubit a;qubit b;h a;')).toBe('qubit a;\nqubit b;\nh a;\n');
  });

  it('normalises whitespace around operators', () => {
    expect(format('qubit q;rx(pi/2)q;')).toBe('qubit q;\nrx(pi / 2) q;\n');
    expect(format('qubit q;rx(  pi   /   2  ) q;')).toBe('qubit q;\nrx(pi / 2) q;\n');
  });

  it('puts a space after commas and none before', () => {
    expect(format('qubit[2] q;cx q[0] ,q[1];')).toBe('qubit[2] q;\ncx q[0], q[1];\n');
  });

  it('hugs brackets and index expressions', () => {
    expect(format('qubit [ 3 ] q;h q [ 1 ];')).toBe('qubit[3] q;\nh q[1];\n');
  });

  it('keeps a parameter list attached to its gate', () => {
    expect(format('qubit q;rx (pi) q;')).toBe('qubit q;\nrx(pi) q;\n');
  });

  it('distinguishes unary from binary minus', () => {
    expect(format('qubit q;rx(-pi/2)q;')).toBe('qubit q;\nrx(-pi / 2) q;\n');
    expect(format('qubit q;rx(pi-1)q;')).toBe('qubit q;\nrx(pi - 1) q;\n');
    expect(format('qubit q;rx(1 - -2)q;')).toBe('qubit q;\nrx(1 - -2) q;\n');
  });

  it('formats measure and reset', () => {
    expect(format('qubit q;bit c;measure q->c;reset q;')).toBe(
      'qubit q;\nbit c;\nmeasure q -> c;\nreset q;\n',
    );
  });

  it('formats a const declaration', () => {
    expect(format('const theta=pi/4;')).toBe('const theta = pi / 4;\n');
  });
});

describe('formatter: comments and blank lines', () => {
  it('keeps a comment on its own line', () => {
    expect(format('// header\nqubit q;')).toBe('// header\nqubit q;\n');
  });

  it('keeps a trailing comment trailing', () => {
    expect(format('qubit q; // the only qubit')).toBe('qubit q;  // the only qubit\n');
  });

  it('never deletes a comment', () => {
    const source = '// a\nqubit q; // b\n/* c */\nh q;\n';
    const output = format(source);
    expect(output).toContain('// a');
    expect(output).toContain('// b');
    expect(output).toContain('/* c */');
  });

  it('preserves the author’s grouping as single blank lines', () => {
    expect(format('qubit a;\n\n\n\nh a;')).toBe('qubit a;\n\nh a;\n');
  });

  it('strips leading and trailing blank lines', () => {
    expect(format('\n\nqubit q;\n\n\n')).toBe('qubit q;\n');
  });

  it('formats an empty program to an empty string', () => {
    expect(format('')).toBe('');
    expect(format('\n\n  \n')).toBe('');
  });
});

describe('formatter: properties', () => {
  const samples = [
    'qubit alice;\nqubit bob;\n\nbit resultA;\nbit resultB;\n\nh alice;\ncx alice, bob;\n\nmeasure alice -> resultA;\nmeasure bob -> resultB;\n',
    'const theta = pi / 8;\n\nqubit[3] q;\nbit[3] c;\n\nh q[0];\nrx(2 * theta) q[1];\nccx q[0], q[1], q[2];\nbarrier;\nmeasure q[2] -> c[2];\n',
    '// comment only\n',
  ];

  it.each(samples)('is idempotent', (source) => {
    const once = format(source);
    expect(format(once)).toBe(once);
  });

  it.each(samples)('output is already formatted', (source) => {
    expect(isFormatted(format(source))).toBe(true);
  });

  it.each(samples)('preserves program meaning', (source) => {
    const before = checkSource(source, { limits: CLI_LIMITS });
    const after = checkSource(format(source), { limits: CLI_LIMITS });
    expect(after.ok).toBe(before.ok);
    expect(after.semantics.operations.length).toBe(before.semantics.operations.length);
    expect(after.semantics.qubitLabels).toEqual(before.semantics.qubitLabels);
  });

  it('reformatting mangled input recovers the canonical form', () => {
    const mangled = 'qubit    alice;qubit bob;h   alice;cx alice,bob;';
    expect(format(mangled)).toBe('qubit alice;\nqubit bob;\nh alice;\ncx alice, bob;\n');
  });
});

describe('formatter: refusal', () => {
  it('refuses to format source with a lexical error', () => {
    const result = formatSource('qubit q$;');
    expect(result.ok).toBe(false);
    expect(result.text).toBe('qubit q$;');
    expect(result.diagnostics[0]!.code).toBe('QF001');
  });

  it('formats syntactically invalid but lexically fine source', () => {
    // The formatter only needs tokens, so it can still tidy a broken statement.
    expect(formatSource('h q').ok).toBe(true);
  });
});
