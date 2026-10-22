import { describe, expect, it } from 'vitest';
import { checkSource, CLI_LIMITS } from '@qforge/language';
import {
  circuitDepth,
  gateCount,
  hasMidCircuitMeasurement,
  isUnitary,
  Opcode,
  opcodeHistogram,
  resolveRegister,
  touchedQubits,
  withInstructions,
} from './ir.js';
import { lower } from './lower.js';
import { printIr } from './print.js';
import { compile } from '../index.js';

const irOf = (source: string) => {
  const frontend = checkSource(source, { limits: CLI_LIMITS });
  expect(frontend.diagnostics.map((d) => d.message)).toEqual([]);
  return lower(frontend.semantics);
};

describe('lowering', () => {
  it('produces one instruction per executable statement, in order', () => {
    const module = irOf('qubit[2] q; bit c; h q[0]; cx q[0], q[1]; measure q[0] -> c;');
    expect(module.instructions.map((i) => i.opcode)).toEqual(['h', 'cx', 'measure']);
  });

  it('replaces names with global indices', () => {
    const module = irOf('qubit alice; qubit[2] q; cx alice, q[1];');
    expect(module.instructions[0]!.qubits).toEqual([0, 2]);
  });

  it('preserves operand order, which distinguishes control from target', () => {
    const module = irOf('qubit[2] q; cx q[1], q[0];');
    expect(module.instructions[0]!.qubits).toEqual([1, 0]);
  });

  it('carries evaluated angles, not expressions', () => {
    const module = irOf('const k = 2; qubit q; rx(pi / k) q;');
    expect(module.instructions[0]!.params[0]).toBeCloseTo(Math.PI / 2, 15);
  });

  it('records the measurement destination', () => {
    const module = irOf('qubit q; bit[2] c; measure q -> c[1];');
    expect(module.instructions[0]!.clbit).toBe(1);
  });

  it('maps each instruction back to its source line', () => {
    const module = irOf('qubit q;\nh q;\nx q;\n');
    expect(module.instructions.map((i) => i.loc.line)).toEqual([2, 3]);
  });

  it('collects registers in declaration order with contiguous bases', () => {
    const module = irOf('qubit a; qubit[3] q; bit c; bit[2] d;');
    expect(module.qubitRegisters).toEqual([
      { name: 'a', baseIndex: 0, size: 1, isRegister: false },
      { name: 'q', baseIndex: 1, size: 3, isRegister: true },
    ]);
    expect(module.clbitRegisters).toEqual([
      { name: 'c', baseIndex: 0, size: 1, isRegister: false },
      { name: 'd', baseIndex: 1, size: 2, isRegister: true },
    ]);
  });

  it('resolves a global index back to its register and offset', () => {
    const module = irOf('qubit a; qubit[3] q;');
    expect(resolveRegister(module.qubitRegisters, 0)).toEqual({
      register: module.qubitRegisters[0],
      offset: 0,
    });
    expect(resolveRegister(module.qubitRegisters, 3)).toEqual({
      register: module.qubitRegisters[1],
      offset: 2,
    });
    expect(resolveRegister(module.qubitRegisters, 9)).toBeUndefined();
  });

  it('starts with no passes recorded', () => {
    expect(irOf('qubit q; h q;').metadata.passes).toEqual([]);
  });
});

describe('IR analysis helpers', () => {
  it('classifies unitary and non-unitary opcodes', () => {
    expect(isUnitary(Opcode.H)).toBe(true);
    expect(isUnitary(Opcode.Ccx)).toBe(true);
    expect(isUnitary(Opcode.Measure)).toBe(false);
    expect(isUnitary(Opcode.Reset)).toBe(false);
    expect(isUnitary(Opcode.Barrier)).toBe(false);
  });

  it('counts gates excluding measure, reset and barrier', () => {
    const module = irOf('qubit q; bit c; h q; x q; barrier; measure q -> c; reset q;');
    expect(module.instructions).toHaveLength(5);
    expect(gateCount(module)).toBe(2);
  });

  it('computes depth as the longest chain on any qubit', () => {
    // Gates on disjoint qubits are parallel, so depth stays 1.
    expect(circuitDepth(irOf('qubit[2] q; h q[0]; h q[1];'))).toBe(1);
    // Serial gates on one qubit stack up.
    expect(circuitDepth(irOf('qubit q; h q; x q; z q;'))).toBe(3);
    // A two-qubit gate joins the two chains.
    expect(circuitDepth(irOf('qubit[2] q; h q[0]; h q[1]; cx q[0], q[1];'))).toBe(2);
  });

  it('treats a bare barrier as spanning every qubit', () => {
    expect(circuitDepth(irOf('qubit[2] q; h q[0]; barrier; h q[1];'))).toBe(3);
  });

  it('builds an opcode histogram', () => {
    expect(opcodeHistogram(irOf('qubit[2] q; h q[0]; h q[1]; cx q[0], q[1];'))).toEqual({
      h: 2,
      cx: 1,
    });
  });
});

describe('IR printer', () => {
  it('prints a stable header and one line per instruction', () => {
    const text = printIr(irOf('qubit[2] q; bit c; h q[0]; cx q[0], q[1]; measure q[0] -> c;'));
    expect(text).toContain('; qforge ir');
    expect(text).toContain('; qubits 2 [q[0], q[1]]');
    expect(text).toContain('; clbits 1 [c]');
    expect(text).toContain('h %0');
    expect(text).toContain('cx %0, %1');
    expect(text).toContain('measure %0 -> $0');
  });

  it('shows indices rather than names, making syntax independence visible', () => {
    const text = printIr(irOf('qubit alice; qubit bob; cx alice, bob;'));
    expect(text).toContain('cx %0, %1');
    expect(text).not.toContain('cx alice');
  });

  it('can print labels on request', () => {
    const text = printIr(irOf('qubit alice; qubit bob; cx alice, bob;'), { useLabels: true });
    expect(text).toContain('cx alice, bob');
  });

  it('prints angles in their pretty form', () => {
    expect(printIr(irOf('qubit q; rx(pi / 2) q;'))).toContain('rx(pi/2) %0');
  });

  it('prints a bare barrier as a wildcard', () => {
    expect(printIr(irOf('qubit q; barrier;'))).toContain('barrier *');
  });

  it('is deterministic', () => {
    const module = irOf('qubit[2] q; h q[0]; cx q[0], q[1];');
    const first = printIr(module);
    for (let i = 0; i < 3; i++) expect(printIr(module)).toBe(first);
  });
});

describe('compile facade', () => {
  it('returns diagnostics and no module when the frontend fails', () => {
    const result = compile('qubit q; h nope;');
    expect(result.ok).toBe(false);
    expect(result.module).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toContain('QF202');
  });

  it('returns the unoptimised module when optimisation is off', () => {
    const result = compile('qubit q; h q; h q;', { limits: CLI_LIMITS });
    expect(result.ok).toBe(true);
    expect(result.module).toBe(result.unoptimized);
    expect(result.module!.instructions).toHaveLength(2);
    expect(result.report).toBeUndefined();
  });

  it('returns both modules when optimisation is on', () => {
    const result = compile('qubit q; h q; h q;', { optimize: true, limits: CLI_LIMITS });
    expect(result.unoptimized!.instructions).toHaveLength(2);
    expect(result.module!.instructions).toHaveLength(0);
    expect(result.report!.instructionsBefore).toBe(2);
    expect(result.report!.instructionsAfter).toBe(0);
  });
});

describe('IR helpers used by the simulator', () => {
  it('detects when a gate follows a measurement on the same qubit', () => {
    expect(hasMidCircuitMeasurement(irOf('qubit q; bit c; h q; measure q -> c;'))).toBe(false);
    expect(hasMidCircuitMeasurement(irOf('qubit q; bit c; measure q -> c; x q;'))).toBe(true);
  });

  it('ignores a gate on a different qubit after a measurement', () => {
    expect(
      hasMidCircuitMeasurement(irOf('qubit[2] q; bit c; measure q[0] -> c; x q[1];')),
    ).toBe(false);
  });

  it('ignores barriers when deciding', () => {
    expect(hasMidCircuitMeasurement(irOf('qubit q; bit c; measure q -> c; barrier;'))).toBe(
      false,
    );
  });

  it('expands a bare barrier to every qubit', () => {
    const module = irOf('qubit[3] q; barrier; barrier q[1];');
    expect(touchedQubits(module.instructions[0]!, 3)).toEqual([0, 1, 2]);
    expect(touchedQubits(module.instructions[1]!, 3)).toEqual([1]);
  });

  it('withInstructions keeps every other field', () => {
    const module = irOf('qubit alice; bit c; h alice;');
    const replaced = withInstructions(module, [], { passes: ['test'] });
    expect(replaced.instructions).toEqual([]);
    expect(replaced.qubitLabels).toEqual(['alice']);
    expect(replaced.clbitRegisters).toEqual(module.clbitRegisters);
    expect(replaced.metadata.passes).toEqual(['test']);
    expect(replaced.metadata.notes).toEqual([]);
  });

  it('reports depth 0 for an empty circuit', () => {
    expect(circuitDepth(irOf('qubit q;'))).toBe(0);
    expect(gateCount(irOf('qubit q;'))).toBe(0);
  });
});
