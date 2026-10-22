import { describe, expect, it } from 'vitest';
import { tokenize, MAX_SOURCE_LENGTH } from './lexer.js';
import { TokenKind } from './token.js';

const kinds = (src: string) => tokenize(src).tokens.map((t) => t.kind);
const texts = (src: string) => tokenize(src).tokens.map((t) => t.text);

describe('lexer: structure', () => {
  it('always terminates with exactly one EndOfFile token', () => {
    for (const src of ['', 'qubit q;', '///', '@@@']) {
      const { tokens } = tokenize(src);
      expect(tokens.filter((t) => t.kind === TokenKind.EndOfFile)).toHaveLength(1);
      expect(tokens[tokens.length - 1]!.kind).toBe(TokenKind.EndOfFile);
    }
  });

  it('covers the entire input: concatenated token text reproduces the source', () => {
    const src = 'qubit q; // hi\n/* block */ rx(pi / 2) q;\n';
    const { allTokens } = tokenize(src);
    expect(allTokens.map((t) => t.text).join('')).toBe(src);
  });

  it('keeps trivia in allTokens and drops it from tokens', () => {
    const { tokens, allTokens } = tokenize('h  q; // trailing');
    expect(allTokens.some((t) => t.kind === TokenKind.Whitespace)).toBe(true);
    expect(allTokens.some((t) => t.kind === TokenKind.LineComment)).toBe(true);
    expect(tokens.some((t) => t.kind === TokenKind.Whitespace)).toBe(false);
    expect(tokens.some((t) => t.kind === TokenKind.LineComment)).toBe(false);
  });
});

describe('lexer: keywords and identifiers', () => {
  it('recognises every reserved word', () => {
    expect(kinds('qubit bit measure reset const barrier')).toEqual([
      TokenKind.Qubit,
      TokenKind.Bit,
      TokenKind.Measure,
      TokenKind.Reset,
      TokenKind.Const,
      TokenKind.Barrier,
      TokenKind.EndOfFile,
    ]);
  });

  it('is case sensitive: Qubit is an identifier, not a keyword', () => {
    expect(kinds('Qubit')[0]).toBe(TokenKind.Identifier);
  });

  it('accepts underscores and digits inside identifiers', () => {
    expect(texts('_a1 q_2 x9')).toEqual(['_a1', 'q_2', 'x9', '']);
  });
});

describe('lexer: numbers', () => {
  it.each([
    ['0', 0],
    ['42', 42],
    ['1.5', 1.5],
    ['.5', 0.5],
    ['1e3', 1000],
    ['2.5E+2', 250],
    ['1e-3', 0.001],
  ])('parses %s as %f', (src, value) => {
    const token = tokenize(src).tokens[0]!;
    expect(token.kind).toBe(TokenKind.Number);
    expect(token.value).toBeCloseTo(value, 12);
  });

  it('rejects an implicit product such as 2pi', () => {
    const { tokens, diagnostics } = tokenize('2pi');
    expect(tokens[0]!.kind).toBe(TokenKind.Invalid);
    expect(diagnostics[0]!.code).toBe('QF003');
  });

  it('rejects an exponent with no digits', () => {
    const { diagnostics } = tokenize('1e');
    expect(diagnostics[0]!.code).toBe('QF003');
  });

  it('does not treat a trailing dot method-style access as a number', () => {
    // `1.` is a valid double literal; what matters is that it is one token.
    const { tokens } = tokenize('1.');
    expect(tokens[0]!.text).toBe('1.');
    expect(tokens[0]!.kind).toBe(TokenKind.Number);
  });
});

describe('lexer: comments', () => {
  it('handles a line comment at end of file with no newline', () => {
    expect(tokenize('h q; // done').diagnostics).toHaveLength(0);
  });

  it('reports an unterminated block comment', () => {
    const { diagnostics } = tokenize('/* never closed');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('QF002');
  });

  it('allows a block comment spanning lines and keeps later line numbers right', () => {
    const { tokens } = tokenize('/* a\nb */\nh q;');
    const h = tokens[0]!;
    expect(h.text).toBe('h');
    expect(h.span.line).toBe(3);
  });
});

describe('lexer: positions', () => {
  it('reports 1-based line and column', () => {
    const { tokens } = tokenize('qubit a;\n  h a;');
    const h = tokens.find((t) => t.text === 'h')!;
    expect(h.span.line).toBe(2);
    expect(h.span.column).toBe(3);
  });

  it('spans are half-open and index back into the source', () => {
    const src = 'cx control, target;';
    const { tokens } = tokenize(src);
    const target = tokens.find((t) => t.text === 'target')!;
    expect(src.slice(target.span.start, target.span.end)).toBe('target');
  });
});

describe('lexer: invalid input', () => {
  it('never silently ignores an invalid character', () => {
    const { tokens, diagnostics } = tokenize('h q$;');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('QF001');
    expect(tokens.some((t) => t.kind === TokenKind.Invalid)).toBe(true);
  });

  it('reports every invalid character, not just the first', () => {
    expect(tokenize('$ % &').diagnostics).toHaveLength(3);
  });

  it('rejects source over the size limit', () => {
    const { diagnostics } = tokenize('a'.repeat(MAX_SOURCE_LENGTH + 1));
    expect(diagnostics[0]!.code).toBe('QF302');
  });
});
