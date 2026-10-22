import { describe, expect, it } from 'vitest';
import { Opcode } from '@qforge/compiler';
import { GATES } from '@qforge/language';
import { referenceMatrix } from './dense.js';
import { singleQubitMatrix } from '../gates/matrices.js';
import { equalsApprox, isUnitary2 } from '../complex/complex.js';

/**
 * The dense oracle writes out its own gate matrices rather than importing the
 * production ones (audit finding A-2). That independence is only worth
 * anything if someone checks the two agree, which is what this file does.
 *
 * The distinction matters: if the oracle imported the production matrices, a
 * sign error in Y would be invisible to every oracle comparison, because both
 * sides would read it from the same constant. Written twice and compared, a
 * sign error shows up here.
 */

const ANGLES = [0, 0.1, Math.PI / 4, Math.PI / 2, Math.PI, -1.3, 2.7, 4 * Math.PI];

describe('reference matrices agree with the production gate table', () => {
  const singleQubitGates = [...GATES.values()].filter((g) => g.qubits === 1);

  it('covers every single-qubit gate the language defines', () => {
    for (const gate of singleQubitGates) {
      expect(
        referenceMatrix(gate.name as Opcode, [0.5]),
        `the oracle has no matrix for '${gate.name}'`,
      ).toBeDefined();
    }
    expect(singleQubitGates.length).toBeGreaterThanOrEqual(13);
  });

  it.each(
    [...GATES.values()]
      .filter((g) => g.qubits === 1 && g.params === 0)
      .map((g) => [g.name] as const),
  )('%s matches to machine precision', (name) => {
    const reference = referenceMatrix(name as Opcode, [])!;
    const production = singleQubitMatrix(name as Opcode, [])!;
    for (let i = 0; i < 4; i++) {
      expect(equalsApprox(reference[i]!, production[i]!, 1e-15)).toBe(true);
    }
  });

  it.each(
    [...GATES.values()]
      .filter((g) => g.qubits === 1 && g.params === 1)
      .map((g) => [g.name] as const),
  )('%s matches at every test angle', (name) => {
    for (const theta of ANGLES) {
      const reference = referenceMatrix(name as Opcode, [theta])!;
      const production = singleQubitMatrix(name as Opcode, [theta])!;
      for (let i = 0; i < 4; i++) {
        expect(
          equalsApprox(reference[i]!, production[i]!, 1e-15),
          `${name}(${theta}) entry ${i}`,
        ).toBe(true);
      }
    }
  });

  it('the oracle matrices are unitary in their own right', () => {
    for (const gate of [...GATES.values()].filter((g) => g.qubits === 1)) {
      for (const theta of gate.params === 1 ? ANGLES : [0]) {
        const m = referenceMatrix(gate.name as Opcode, [theta])!;
        expect(isUnitary2(m, 1e-12), `${gate.name}(${theta})`).toBe(true);
      }
    }
  });

  it('returns undefined for opcodes that are not single-qubit gates', () => {
    for (const opcode of [Opcode.Cx, Opcode.Cz, Opcode.Swap, Opcode.Ccx, Opcode.Measure]) {
      expect(referenceMatrix(opcode, [])).toBeUndefined();
    }
  });

  it('would notice a sign error: Y is not its own conjugate', () => {
    // A guard against the comparison being vacuous. If someone "simplified"
    // the oracle by importing the production matrix, this still passes -- but
    // the per-gate comparisons above would then be comparing a value to itself,
    // so this test documents the intent for the next reader.
    const y = referenceMatrix(Opcode.Y, [])!;
    expect(y[1]!.im).toBe(-1);
    expect(y[2]!.im).toBe(1);
  });
});
