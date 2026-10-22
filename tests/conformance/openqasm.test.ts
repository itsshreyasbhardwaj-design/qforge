import { describe, expect, it } from 'vitest';
import {
  Opcode,
  compile,
  emitOpenQasm3,
  formatAngle,
  optimize,
  type IrInstruction,
  type IrModule,
} from '@qforge/compiler';
import { Statevector, applyInstruction } from '@qforge/simulator';
import { CLI_LIMITS } from '@qforge/language';
import { makeModule, moduleFromSource, randomCircuit } from '@qforge/testing';
import { evaluateQasmExpression, parseQasm3, QasmParseError } from './qasm-parser.js';

/**
 * Conformance tests for the OpenQASM 3 backend.
 *
 * The important ones are the round trips: emit QASM, read it back with the
 * independent parser in `qasm-parser.ts`, simulate both and require identical
 * statevectors. A golden-file test alone would happily enshrine swapped
 * operands or an off-by-one register index.
 */

/** Turn a parsed QASM circuit back into QForge IR so it can be simulated. */
function qasmToModule(source: string): IrModule {
  const circuit = parseQasm3(source);
  const instructions = circuit.operations
    .filter((op) => op.gate !== 'barrier')
    .map((op) => ({
      opcode: (op.gate === 'measure' ? Opcode.Measure : op.gate) as Opcode,
      qubits: [...op.qubits],
      params: [...op.params],
      ...(op.clbit !== undefined ? { clbit: op.clbit } : {}),
    }));
  return makeModule(circuit.qubitCount, instructions, circuit.clbitCount);
}

function simulateUnitary(module: IrModule): Statevector {
  const state = Statevector.zeroState(module.qubitCount);
  for (const instruction of module.instructions) {
    if (instruction.opcode === Opcode.Measure || instruction.opcode === Opcode.Reset) continue;
    applyInstruction(state, instruction);
  }
  return state;
}

const emit = (source: string, optimizeFirst = false): string => {
  const module = moduleFromSource(source, optimizeFirst);
  return emitOpenQasm3(module).code;
};

describe('emitted structure', () => {
  it('declares the version and the standard gate include', () => {
    const code = emit('qubit q; h q;');
    expect(code).toContain('OPENQASM 3.0;');
    expect(code).toContain('include "stdgates.inc";');
    expect(code.indexOf('OPENQASM')).toBeLessThan(code.indexOf('include'));
  });

  it('keeps the programmer’s own register names', () => {
    const code = emit(
      'qubit alice; qubit bob; bit result; h alice; cx alice, bob; measure alice -> result;',
    );
    expect(code).toContain('qubit alice;');
    expect(code).toContain('qubit bob;');
    expect(code).toContain('bit result;');
    expect(code).toContain('cx alice, bob;');
    expect(code).toContain('result = measure alice;');
  });

  it('emits sized declarations for registers and indexes operands', () => {
    const code = emit('qubit[3] q; bit[2] c; h q[0]; cx q[0], q[2]; measure q[2] -> c[1];');
    expect(code).toContain('qubit[3] q;');
    expect(code).toContain('bit[2] c;');
    expect(code).toContain('cx q[0], q[2];');
    expect(code).toContain('c[1] = measure q[2];');
  });

  it('renames a register that collides with an OpenQASM keyword', () => {
    const module = moduleFromSource(
      'qubit angle; qubit[2] ctrl; h angle; cx ctrl[0], ctrl[1];',
    );
    const { code, renames } = emitOpenQasm3(module);
    expect(renames.get('angle')).toBe('_angle');
    expect(renames.get('ctrl')).toBe('_ctrl');
    expect(code).toContain('qubit _angle;');
    expect(code).toContain('cx _ctrl[0], _ctrl[1];');
    expect(code).toContain("renamed 'angle' to '_angle'");
    // The renamed program must still parse.
    expect(() => parseQasm3(code)).not.toThrow();
  });

  it('renames a register that shadows a gate name', () => {
    const { renames } = emitOpenQasm3(moduleFromSource('qubit h; x h;'));
    expect(renames.get('h')).toBe('_h');
  });

  it('emits reset and barrier', () => {
    const code = emit('qubit[2] q; h q[0]; barrier q[0], q[1]; reset q[0]; barrier;');
    expect(code).toContain('barrier q[0], q[1];');
    expect(code).toContain('reset q[0];');
    // A bare barrier expands to every declared register.
    expect(code).toContain('barrier q;');
  });

  it('is deterministic: the same module always produces the same bytes', () => {
    const module = moduleFromSource('qubit[2] q; rx(pi / 3) q[0]; cx q[0], q[1];');
    const first = emitOpenQasm3(module).code;
    for (let i = 0; i < 5; i++) expect(emitOpenQasm3(module).code).toBe(first);
  });

  it('can omit the header for embedding', () => {
    const code = emitOpenQasm3(moduleFromSource('qubit q; h q;'), { header: false }).code;
    expect(code.startsWith('OPENQASM 3.0;')).toBe(true);
  });

  it('refuses an unknown opcode instead of emitting nonsense', () => {
    const module = makeModule(1, [
      { opcode: 'not-a-gate' as Opcode, qubits: [0], params: [] } as Omit<IrInstruction, 'loc'>,
    ]);
    expect(() => emitOpenQasm3(module)).toThrow(/no OpenQASM mapping/);
  });
});

describe('angle serialisation', () => {
  it('prefers an exact pi form when one round-trips', () => {
    expect(formatAngle(Math.PI)).toBe('pi');
    expect(formatAngle(Math.PI / 2)).toBe('pi/2');
    expect(formatAngle(Math.PI / 4)).toBe('pi/4');
    expect(formatAngle(-Math.PI / 2)).toBe('-pi/2');
    expect(formatAngle((3 * Math.PI) / 4)).toBe('3*pi/4');
    expect(formatAngle(0)).toBe('0');
  });

  it('falls back to an exact decimal otherwise', () => {
    expect(formatAngle(0.1)).toBe('0.1');
    expect(formatAngle(1.2345678901234567)).toBe('1.2345678901234567');
  });

  it('never loses precision: every emitted angle reparses to the same double', () => {
    const values = [
      0,
      0.1,
      -0.1,
      1,
      Math.PI,
      Math.PI / 2,
      Math.PI / 3,
      Math.PI / 8,
      (5 * Math.PI) / 6,
      -Math.PI / 7,
      2 * Math.PI,
      1e-8,
      123.456,
      1 / 3,
      Math.SQRT2,
      4 * Math.PI,
    ];
    for (const value of values) {
      const text = formatAngle(value);
      expect(evaluateQasmExpression(text), `round trip of ${value} via '${text}'`).toBe(value);
    }
  });

  it('round-trips angles produced by the optimiser', () => {
    // Merged rotations give angles with no nice closed form.
    const module = moduleFromSource('qubit q; rx(0.3) q; rx(0.4) q; rx(pi / 5) q;', true);
    const code = emitOpenQasm3(module).code;
    const reparsed = parseQasm3(code);
    const original = module.instructions[0]!;
    expect(reparsed.operations[0]!.params[0]).toBe(original.params[0]);
  });

  it('refuses to format a non-finite angle', () => {
    expect(() => formatAngle(Number.NaN)).toThrow(RangeError);
    expect(() => formatAngle(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('can be forced to plain decimals', () => {
    expect(formatAngle(Math.PI, false)).toBe(String(Math.PI));
  });
});

describe('independent parser sanity checks', () => {
  it('evaluates expressions with correct precedence', () => {
    expect(evaluateQasmExpression('1 + 2 * 3')).toBe(7);
    expect(evaluateQasmExpression('(1 + 2) * 3')).toBe(9);
    expect(evaluateQasmExpression('pi/2')).toBeCloseTo(Math.PI / 2, 15);
    expect(evaluateQasmExpression('3*pi/4')).toBeCloseTo((3 * Math.PI) / 4, 15);
    expect(evaluateQasmExpression('-pi/2')).toBeCloseTo(-Math.PI / 2, 15);
    expect(evaluateQasmExpression('10 - 3 - 2')).toBe(5);
  });

  it('rejects what it does not understand rather than guessing', () => {
    expect(() => parseQasm3('qubit q; h q;')).toThrow(QasmParseError); // no version line
    expect(() => parseQasm3('OPENQASM 3.0; gate foo q { h q; }')).toThrow(QasmParseError);
    expect(() => parseQasm3('OPENQASM 3.0; h undeclared;')).toThrow(/Undeclared/);
    expect(() => evaluateQasmExpression('sin(1)')).toThrow(QasmParseError);
  });

  it('assigns register base indices in declaration order', () => {
    const circuit = parseQasm3(`
      OPENQASM 3.0;
      include "stdgates.inc";
      qubit a;
      qubit[2] b;
      x a;
      x b[1];
    `);
    expect(circuit.qubitCount).toBe(3);
    expect(circuit.operations[0]!.qubits).toEqual([0]);
    expect(circuit.operations[1]!.qubits).toEqual([2]);
  });
});

describe('round trip: QForge -> OpenQASM -> simulation', () => {
  const programs: Array<[string, string]> = [
    ['single gate', 'qubit q; h q;'],
    ['bell', 'qubit[2] q; h q[0]; cx q[0], q[1];'],
    ['ghz', 'qubit[3] q; h q[0]; cx q[0], q[1]; cx q[0], q[2];'],
    ['named qubits', 'qubit alice; qubit bob; h alice; cx alice, bob;'],
    ['mixed names and registers', 'qubit a; qubit[2] q; h a; cx a, q[1]; cz q[0], q[1];'],
    [
      'all rotations',
      'qubit[2] q; rx(pi / 3) q[0]; ry(-pi / 5) q[1]; rz(2 * pi / 7) q[0]; p(0.37) q[1];',
    ],
    ['phase gates', 'qubit q; s q; t q; sdg q; tdg q; z q; y q; x q;'],
    ['toffoli and swap', 'qubit[3] q; h q[0]; h q[1]; ccx q[0], q[1], q[2]; swap q[0], q[2];'],
    ['keyword names', 'qubit angle; qubit[2] gate_; h angle; cx gate_[0], gate_[1];'],
    ['asymmetric cx', 'qubit[2] q; x q[0]; cx q[0], q[1]; cx q[1], q[0];'],
    ['asymmetric ccx', 'qubit[3] q; x q[0]; x q[2]; ccx q[0], q[2], q[1];'],
  ];

  it.each(programs)('%s survives the round trip', (_name, source) => {
    const original = moduleFromSource(source);
    const code = emitOpenQasm3(original).code;
    const reparsed = qasmToModule(code);

    expect(reparsed.qubitCount).toBe(original.qubitCount);
    const before = simulateUnitary(original);
    const after = simulateUnitary(reparsed);
    expect(before.maxAmplitudeDifference(after)).toBeLessThan(1e-14);
  });

  it('preserves measurement targets', () => {
    const source = `
      qubit[3] q; bit[3] c;
      h q[0];
      cx q[0], q[1];
      measure q[2] -> c[0];
      measure q[0] -> c[2];
      measure q[1] -> c[1];
    `;
    const original = moduleFromSource(source);
    const reparsed = qasmToModule(emitOpenQasm3(original).code);

    const pairs = (module: IrModule) =>
      module.instructions
        .filter((i) => i.opcode === Opcode.Measure)
        .map((i) => [i.qubits[0], i.clbit]);
    expect(pairs(reparsed)).toEqual(pairs(original));
  });

  it('survives the round trip for 100 random circuits', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const qubitCount = 1 + (seed % 4);
      const original = randomCircuit({ qubitCount, gateCount: 15, seed });
      const code = emitOpenQasm3(original).code;
      let reparsed: IrModule;
      try {
        reparsed = qasmToModule(code);
      } catch (error) {
        throw new Error(`seed ${seed}: generated QASM did not parse\n${code}`, {
          cause: error,
        });
      }
      const before = simulateUnitary(original);
      const after = simulateUnitary(reparsed);
      expect(
        before.maxAmplitudeDifference(after),
        `seed ${seed}: round trip changed the state`,
      ).toBeLessThan(1e-13);
    }
  });

  it('survives the round trip after optimisation', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const original = randomCircuit({ qubitCount: 3, gateCount: 20, seed });
      const { module: optimized } = optimize(original);
      const reparsed = qasmToModule(emitOpenQasm3(optimized).code);
      expect(
        simulateUnitary(optimized).maxAmplitudeDifference(simulateUnitary(reparsed)),
      ).toBeLessThan(1e-13);
    }
  });
});

describe('classical control round-trips', () => {
  const programs: Array<[string, string]> = [
    ['single correction', 'qubit q; bit c; h q; measure q -> c; if (c == 1) x q;'],
    ['not equal', 'qubit q; bit c; measure q -> c; if (c != 0) z q;'],
    ['indexed bit', 'qubit[2] q; bit[2] c; measure q[0] -> c[1]; if (c[1] == 1) x q[1];'],
    [
      'whole register',
      'qubit[2] q; bit[2] c; measure q[0] -> c[0]; measure q[1] -> c[1]; if (c == 3) z q[0];',
    ],
    [
      'teleportation',
      `qubit msg; qubit alice; qubit bob; bit m0; bit m1;
       ry(2 * pi / 5) msg; h alice; cx alice, bob;
       cx msg, alice; h msg;
       measure msg -> m0; measure alice -> m1;
       if (m1 == 1) x bob; if (m0 == 1) z bob;`,
    ],
  ];

  it.each(programs)('%s emits a parseable if statement', (_name, source) => {
    const code = emitOpenQasm3(moduleFromSource(source)).code;
    expect(code).toMatch(/if \(.+\) \{ .+ \}/);
    expect(() => parseQasm3(code)).not.toThrow();
  });

  it.each(programs)('%s preserves its predicates through the round trip', (_name, source) => {
    const original = moduleFromSource(source);
    const reparsed = parseQasm3(emitOpenQasm3(original).code);

    const expected = original.instructions
      .filter((i) => i.condition)
      .map((i) => ({
        clbits: [...i.condition!.clbits],
        value: i.condition!.value,
        negate: i.condition!.negate,
      }));
    const actual = reparsed.operations
      .filter((o) => o.condition)
      .map((o) => ({
        clbits: [...o.condition!.clbits],
        value: o.condition!.value,
        negate: o.condition!.negate,
      }));

    expect(actual).toEqual(expected);
  });

  it('a whole-register comparison keeps the register form, not an indexed bit', () => {
    const code = emitOpenQasm3(
      moduleFromSource('qubit[2] q; bit[2] c; measure q[0] -> c[0]; if (c == 3) z q[0];'),
    ).code;
    expect(code).toContain('if (c == 3)');
    expect(code).not.toContain('if (c[0] == 3)');
  });

  it('a single-bit comparison emits a boolean, not an integer', () => {
    // OpenQASM 3 types a single `bit` as a bit, so `c == 1` is a type error.
    // Qiskit's importer rejects it outright ("conditions must be
    // 'bit == const bool' or 'bitarray == const int'"), which is how this was
    // found -- see docs/validation-report.md.
    const code = emitOpenQasm3(
      moduleFromSource('qubit q; bit c; measure q -> c; if (c == 1) x q;'),
    ).code;
    expect(code).toContain('if (c == true) { x q; }');

    const zero = emitOpenQasm3(
      moduleFromSource('qubit q; bit c; measure q -> c; if (c == 0) x q;'),
    ).code;
    expect(zero).toContain('if (c == false) { x q; }');
  });

  it('an indexed bit also compares against a boolean', () => {
    const code = emitOpenQasm3(
      moduleFromSource('qubit q; bit[2] c; measure q -> c[1]; if (c[1] != 1) x q;'),
    ).code;
    expect(code).toContain('if (c[1] != true) { x q; }');
  });
});

describe('every documented gate maps to a stdgates.inc name', () => {
  it('emits a parseable call for each gate at its declared arity', () => {
    const source = `
      qubit[3] q;
      id q[0]; h q[0]; x q[0]; y q[0]; z q[0];
      s q[0]; sdg q[0]; t q[0]; tdg q[0];
      p(pi / 8) q[0]; rx(pi / 2) q[0]; ry(pi / 3) q[0]; rz(pi / 4) q[0];
      cx q[0], q[1]; cz q[0], q[1]; swap q[0], q[1];
      ccx q[0], q[1], q[2];
    `;
    const result = compile(source, { limits: CLI_LIMITS });
    expect(result.ok).toBe(true);
    const code = emitOpenQasm3(result.module!).code;
    const circuit = parseQasm3(code);
    expect(circuit.operations).toHaveLength(17);
    expect(new Set(circuit.operations.map((o) => o.gate)).size).toBe(17);
  });
});
