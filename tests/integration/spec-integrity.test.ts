import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErrorCode, GATE_NAMES, GATES, BUILTIN_CONSTANTS } from '@qforge/language';
import { Opcode, isUnitary } from '@qforge/compiler';
import { singleQubitMatrix, isUnitary2 } from '@qforge/simulator';

/**
 * Guards against documentation drifting away from the implementation.
 *
 * Specifications rot silently: someone adds a diagnostic code, ships it, and
 * the spec quietly becomes wrong. These tests make that a build failure instead
 * of something a reader discovers later.
 */

const read = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('language specification', () => {
  const spec = read('docs/language-spec.md');

  it('documents every diagnostic code the compiler can emit', () => {
    const undocumented = Object.values(ErrorCode).filter((code) => !spec.includes(code));
    expect(undocumented, 'add these to the diagnostic tables in docs/language-spec.md').toEqual(
      [],
    );
  });

  it('does not document codes that do not exist', () => {
    const known = new Set<string>(Object.values(ErrorCode));
    const mentioned = [...spec.matchAll(/\bQF(\d{3})\b/g)].map((m) => m[0]);
    const phantom = [...new Set(mentioned)].filter((code) => !known.has(code));
    expect(phantom, 'these codes appear in the spec but not in ErrorCode').toEqual([]);
  });

  it('documents every gate', () => {
    const missing = GATE_NAMES.filter(
      (name) => !new RegExp(`\\|\\s*\`${name}(\\(theta\\))?\`\\s*\\|`).test(spec),
    );
    expect(missing, 'add these to the gate table in docs/language-spec.md').toEqual([]);
  });

  it('documents every built-in constant', () => {
    for (const name of BUILTIN_CONSTANTS.keys()) {
      expect(spec, `constant '${name}' is missing from the spec`).toContain(`\`${name}\``);
    }
  });

  it('documents every reserved word', () => {
    for (const keyword of ['qubit', 'bit', 'const', 'measure', 'reset', 'barrier']) {
      expect(spec).toContain(keyword);
    }
  });
});

describe('gate table consistency', () => {
  it('every gate mnemonic is a valid IR opcode', () => {
    const opcodes = new Set<string>(Object.values(Opcode));
    for (const name of GATE_NAMES) {
      expect(opcodes.has(name), `gate '${name}' has no matching opcode`).toBe(true);
      expect(isUnitary(name as Opcode), `gate '${name}' should be unitary`).toBe(true);
    }
  });

  it('every unitary opcode is a declared gate', () => {
    for (const opcode of Object.values(Opcode)) {
      if (!isUnitary(opcode)) continue;
      expect(GATES.has(opcode), `opcode '${opcode}' is not in the gate table`).toBe(true);
    }
  });

  it('every single-qubit gate has a unitary matrix', () => {
    for (const signature of GATES.values()) {
      if (signature.qubits !== 1) continue;
      const matrix = singleQubitMatrix(signature.name as Opcode, [0.7]);
      expect(matrix, `gate '${signature.name}' has no matrix`).toBeDefined();
      expect(isUnitary2(matrix!), `gate '${signature.name}' is not unitary`).toBe(true);
    }
  });

  it('inverse relationships are symmetric', () => {
    for (const signature of GATES.values()) {
      if (!signature.inverseOf) continue;
      const partner = GATES.get(signature.inverseOf);
      expect(partner, `'${signature.name}' names a missing inverse`).toBeDefined();
      expect(
        partner!.inverseOf,
        `'${signature.inverseOf}' does not name '${signature.name}' back`,
      ).toBe(signature.name);
    }
  });

  it('a gate is never both self-inverse and the inverse of another', () => {
    for (const signature of GATES.values()) {
      expect(signature.selfInverse && Boolean(signature.inverseOf)).toBe(false);
    }
  });
});

describe('documentation cross-references', () => {
  const readme = read('README.md');

  it('every doc linked from the README exists', () => {
    const links = [...readme.matchAll(/\]\((docs\/[\w.-]+\.md)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(8);
    for (const link of new Set(links)) {
      expect(() => read(link), `README links to a missing file: ${link}`).not.toThrow();
    }
  });

  it('the README states the limits that the code enforces', () => {
    expect(readme).toContain('14 qubits in the browser');
    expect(readme).toContain('20 in the CLI');
    expect(readme).toContain('26 hard');
  });

  it('the README does not promise features that are documented as absent', () => {
    // Teleportation is the one most likely to creep back in.
    expect(read('docs/limitations.md')).toContain('teleportation cannot be written');
    expect(readme.replace(/\s+/g, ' ')).toContain('quantum teleportation cannot be expressed');
  });
});
