import { describe, expect, it } from 'vitest';
import { checkSource, CLI_LIMITS } from '@qforge/language';
import { lower } from '../ir/lower.js';
import { gateCount, type IrModule } from '../ir/ir.js';
import { removeIdentity } from './remove-identity.js';
import { cancelInversePair, cancelSelfInverse } from './cancel-inverses.js';
import { mergeRotations } from './merge-rotations.js';
import { DEFAULT_PASSES, formatOptimizationReport, optimize } from './manager.js';
import { isIdentityPhase, isIdentityRotation, isMultipleOf } from './numeric.js';

const irOf = (source: string): IrModule => {
  const frontend = checkSource(source, { limits: CLI_LIMITS });
  expect(frontend.diagnostics.map((d) => d.message)).toEqual([]);
  return lower(frontend.semantics);
};

const opcodes = (module: IrModule): string[] => module.instructions.map((i) => i.opcode);

describe('numeric predicates', () => {
  it('detects multiples within tolerance', () => {
    expect(isMultipleOf(0, Math.PI)).toBe(true);
    expect(isMultipleOf(Math.PI, Math.PI)).toBe(true);
    expect(isMultipleOf(2 * Math.PI, Math.PI)).toBe(true);
    expect(isMultipleOf(Math.PI / 2, Math.PI)).toBe(false);
  });

  it('a rotation is the identity at 4*pi but not at 2*pi', () => {
    expect(isIdentityRotation(0)).toBe(true);
    expect(isIdentityRotation(4 * Math.PI)).toBe(true);
    expect(isIdentityRotation(-8 * Math.PI)).toBe(true);
    expect(isIdentityRotation(2 * Math.PI)).toBe(false);
    expect(isIdentityRotation(Math.PI)).toBe(false);
  });

  it('a phase gate is the identity at 2*pi', () => {
    expect(isIdentityPhase(0)).toBe(true);
    expect(isIdentityPhase(2 * Math.PI)).toBe(true);
    expect(isIdentityPhase(Math.PI)).toBe(false);
  });
});

describe('remove-identity', () => {
  it('drops explicit id gates', () => {
    const result = removeIdentity.run(irOf('qubit q; id q; h q; id q;'));
    expect(opcodes(result.module)).toEqual(['h']);
    expect(result.changed).toBe(2);
  });

  it('drops a rotation by a multiple of 4*pi', () => {
    const result = removeIdentity.run(
      irOf('qubit q; rx(4 * pi) q; ry(0) q; rz(-8 * pi) q; h q;'),
    );
    expect(opcodes(result.module)).toEqual(['h']);
  });

  it('keeps a rotation by 2*pi, which is -I rather than I', () => {
    const result = removeIdentity.run(irOf('qubit q; rx(2 * pi) q;'));
    expect(opcodes(result.module)).toEqual(['rx']);
    expect(result.changed).toBe(0);
  });

  it('drops a phase gate at a multiple of 2*pi', () => {
    expect(
      opcodes(removeIdentity.run(irOf('qubit q; p(2 * pi) q; p(0) q; h q;')).module),
    ).toEqual(['h']);
  });

  it('reports no change when there is nothing to remove', () => {
    const module = irOf('qubit q; h q;');
    const result = removeIdentity.run(module);
    expect(result.changed).toBe(0);
    expect(result.module).toBe(module);
  });
});

describe('cancel-self-inverse', () => {
  it('cancels an adjacent pair', () => {
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; h q; h q;')).module)).toBe(0);
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; x q; x q;')).module)).toBe(0);
  });

  it('collapses a run of four in a single pass', () => {
    const result = cancelSelfInverse.run(irOf('qubit q; h q; h q; h q; h q;'));
    expect(gateCount(result.module)).toBe(0);
    expect(result.changed).toBe(4);
  });

  it('leaves an odd run with one gate', () => {
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; h q; h q; h q;')).module)).toBe(1);
  });

  it('cancels a nested pair once the inner one is gone', () => {
    // h x x h -> h h -> nothing, all within one scan.
    const result = cancelSelfInverse.run(irOf('qubit q; h q; x q; x q; h q;'));
    expect(gateCount(result.module)).toBe(0);
  });

  it('does not cancel different gates', () => {
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; h q; x q;')).module)).toBe(2);
  });

  it('does not cancel the same gate on different qubits', () => {
    expect(gateCount(cancelSelfInverse.run(irOf('qubit[2] q; h q[0]; h q[1];')).module)).toBe(
      2,
    );
  });

  it('cancels cx only when the operand order matches', () => {
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[2] q; cx q[0], q[1]; cx q[0], q[1];')).module,
      ),
    ).toBe(0);
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[2] q; cx q[0], q[1]; cx q[1], q[0];')).module,
      ),
    ).toBe(2);
  });

  it('cancels cz and swap regardless of operand order, since they are symmetric', () => {
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[2] q; cz q[0], q[1]; cz q[1], q[0];')).module,
      ),
    ).toBe(0);
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[2] q; swap q[0], q[1]; swap q[1], q[0];')).module,
      ),
    ).toBe(0);
  });

  it('cancels ccx when only the controls are permuted', () => {
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[3] q; ccx q[0], q[1], q[2]; ccx q[1], q[0], q[2];'))
          .module,
      ),
    ).toBe(0);
  });

  it('does not cancel ccx when the target moves', () => {
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[3] q; ccx q[0], q[1], q[2]; ccx q[0], q[2], q[1];'))
          .module,
      ),
    ).toBe(2);
  });

  it('does not cancel a two-qubit gate when one of its qubits was touched between', () => {
    expect(
      gateCount(
        cancelSelfInverse.run(irOf('qubit[2] q; cx q[0], q[1]; h q[1]; cx q[0], q[1];')).module,
      ),
    ).toBe(3);
  });

  it('does not cancel a non-self-inverse gate', () => {
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; s q; s q;')).module)).toBe(2);
    expect(gateCount(cancelSelfInverse.run(irOf('qubit q; t q; t q;')).module)).toBe(2);
  });
});

describe('cancel-inverse-pair', () => {
  it('cancels s then sdg, in either order', () => {
    expect(gateCount(cancelInversePair.run(irOf('qubit q; s q; sdg q;')).module)).toBe(0);
    expect(gateCount(cancelInversePair.run(irOf('qubit q; sdg q; s q;')).module)).toBe(0);
  });

  it('cancels t then tdg', () => {
    expect(gateCount(cancelInversePair.run(irOf('qubit q; t q; tdg q;')).module)).toBe(0);
  });

  it('does not cancel s then tdg', () => {
    expect(gateCount(cancelInversePair.run(irOf('qubit q; s q; tdg q;')).module)).toBe(2);
  });

  it('does not cancel across another gate', () => {
    expect(gateCount(cancelInversePair.run(irOf('qubit q; s q; h q; sdg q;')).module)).toBe(3);
  });
});

describe('merge-rotations', () => {
  it('fuses two same-axis rotations', () => {
    const result = mergeRotations.run(irOf('qubit q; rx(0.3) q; rx(0.4) q;'));
    expect(opcodes(result.module)).toEqual(['rx']);
    expect(result.module.instructions[0]!.params[0]).toBeCloseTo(0.7, 15);
  });

  it('fuses a run of three in one pass', () => {
    const result = mergeRotations.run(irOf('qubit q; rz(1) q; rz(2) q; rz(3) q;'));
    expect(opcodes(result.module)).toEqual(['rz']);
    expect(result.module.instructions[0]!.params[0]).toBeCloseTo(6, 14);
  });

  it('fuses phase gates too', () => {
    const result = mergeRotations.run(irOf('qubit q; p(0.25) q; p(0.75) q;'));
    expect(result.module.instructions[0]!.params[0]).toBeCloseTo(1, 15);
  });

  it('does not fuse different axes', () => {
    expect(opcodes(mergeRotations.run(irOf('qubit q; rx(1) q; ry(1) q;')).module)).toEqual([
      'rx',
      'ry',
    ]);
  });

  it('does not fuse across a gate on the same qubit', () => {
    expect(
      opcodes(mergeRotations.run(irOf('qubit q; rx(1) q; h q; rx(1) q;')).module),
    ).toHaveLength(3);
  });

  it('does not fuse rotations on different qubits', () => {
    expect(
      opcodes(mergeRotations.run(irOf('qubit[2] q; rx(1) q[0]; rx(1) q[1];')).module),
    ).toHaveLength(2);
  });
});

describe('pass manager', () => {
  it('runs to a fixpoint across interacting passes', () => {
    // rx(1) rx(-1) merges to rx(0), which remove-identity then deletes,
    // bringing the two h gates together so they cancel as well.
    const { module, report } = optimize(irOf('qubit q; h q; rx(1) q; rx(-1) q; h q;'));
    expect(module.instructions).toHaveLength(0);
    expect(report.rounds).toBeGreaterThan(1);
    expect(report.instructionsBefore).toBe(4);
    expect(report.instructionsAfter).toBe(0);
  });

  it('records which passes ran and why', () => {
    const { module, report } = optimize(irOf('qubit q; h q; h q;'));
    expect(module.metadata.passes).toEqual(DEFAULT_PASSES.map((p) => p.name));
    expect(report.runs[0]!.pass).toBe('cancel-self-inverse');
    expect(report.runs[0]!.notes[0]).toContain('cancelled h pair');
  });

  it('leaves an already-minimal circuit alone', () => {
    const module = irOf('qubit[2] q; h q[0]; cx q[0], q[1];');
    const { module: optimized, report } = optimize(module);
    expect(optimized.instructions).toHaveLength(2);
    expect(report.runs).toHaveLength(0);
    expect(report.rounds).toBe(0);
  });

  it('honours a custom pass list', () => {
    const { module } = optimize(irOf('qubit q; id q; h q; h q;'), { passes: [removeIdentity] });
    expect(opcodes(module)).toEqual(['h', 'h']);
  });

  it('reports hitting the round limit', () => {
    const { report } = optimize(irOf('qubit q; h q; rx(1) q; rx(-1) q; h q;'), {
      maxRounds: 1,
    });
    expect(report.hitRoundLimit).toBe(true);
  });

  it('formats a human-readable report', () => {
    const { report } = optimize(irOf('qubit q; h q; h q;'));
    const text = formatOptimizationReport(report);
    expect(text).toContain('instructions 2 -> 0');
    expect(text).toContain('cancel-self-inverse');
  });

  it('never removes measure, reset or barrier', () => {
    const module = irOf('qubit q; bit c; h q; h q; measure q -> c; barrier; reset q;');
    const { module: optimized } = optimize(module);
    expect(opcodes(optimized)).toEqual(['measure', 'barrier', 'reset']);
  });

  it('preserves the register and label metadata', () => {
    const module = irOf('qubit alice; bit c; h alice; h alice;');
    const { module: optimized } = optimize(module);
    expect(optimized.qubitLabels).toEqual(['alice']);
    expect(optimized.qubitRegisters).toEqual(module.qubitRegisters);
    expect(optimized.clbitCount).toBe(1);
  });
});
