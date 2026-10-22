import { Opcode, isUnitary, type IrInstruction, type IrModule } from '@qforge/compiler';
import { Statevector } from '../statevector/statevector.js';
import { complex, type Complex } from '../complex/complex.js';

/**
 * An intentionally slow, independently written reference simulator.
 *
 * ## Why this exists
 *
 * The production kernels in `Statevector` are in-place, allocation-free and
 * index-clever: they step over blocks, exploit the fact that controlled gates
 * are permutations, and never build an operator. That cleverness is exactly
 * where indexing bugs live, and a bug there would be invisible to any test that
 * used the same kernels to compute the expected answer.
 *
 * So this module computes the same thing a completely different way: it builds
 * the full `2^n x 2^n` matrix for each instruction straight from the
 * definition `M[j][i] = <j| Op |i>`, then multiplies it into the state as a
 * dense matrix-vector product. There is no shared index arithmetic with the
 * fast path — this file enumerates basis states, the fast path manipulates bit
 * masks — so agreement between them is real evidence.
 *
 * ## Independence, stated precisely
 *
 * An earlier version of this file imported `singleQubitMatrix` from the
 * production gate table. That made the oracle independent in *indexing and
 * gate application* -- the part most likely to harbour a bug -- but not in the
 * *matrices themselves*: a sign error in Y would have been invisible, because
 * both sides would have read it from the same constant.
 *
 * The matrices below are therefore written out again here, from their textbook
 * definitions, and a test asserts they agree with the production table. The
 * oracle now shares nothing with the code it checks except the `Complex` type
 * and the `Statevector` container.
 *
 * It is O(4^n) in time and O(4^n) in memory, which is fine for the circuits up
 * to about 7 qubits that the test suite uses, and useless for anything larger.
 * It is a test oracle, never the execution path.
 *
 * A third, out-of-language check lives in `scripts/numpy-reference.mjs`, which
 * validates the same circuits against NumPy.
 */

/**
 * Single-qubit gate matrices, defined here independently of
 * `../gates/matrices.js`. `reference.test.ts` checks the two agree; the point
 * of writing them twice is that the check has something to say.
 */
const SQRT1_2 = Math.SQRT1_2;
type Mat2 = readonly [Complex, Complex, Complex, Complex];

function referenceMatrix(opcode: Opcode, params: readonly number[]): Mat2 | undefined {
  const t = params[0] ?? 0;
  const half = t / 2;
  switch (opcode) {
    case Opcode.Id:
      return [complex(1), complex(0), complex(0), complex(1)];
    case Opcode.H:
      return [complex(SQRT1_2), complex(SQRT1_2), complex(SQRT1_2), complex(-SQRT1_2)];
    case Opcode.X:
      return [complex(0), complex(1), complex(1), complex(0)];
    case Opcode.Y:
      return [complex(0), complex(0, -1), complex(0, 1), complex(0)];
    case Opcode.Z:
      return [complex(1), complex(0), complex(0), complex(-1)];
    case Opcode.S:
      return [complex(1), complex(0), complex(0), complex(0, 1)];
    case Opcode.Sdg:
      return [complex(1), complex(0), complex(0), complex(0, -1)];
    case Opcode.T:
      return [
        complex(1),
        complex(0),
        complex(0),
        complex(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)),
      ];
    case Opcode.Tdg:
      return [
        complex(1),
        complex(0),
        complex(0),
        complex(Math.cos(-Math.PI / 4), Math.sin(-Math.PI / 4)),
      ];
    case Opcode.Rx:
      return [
        complex(Math.cos(half)),
        complex(0, -Math.sin(half)),
        complex(0, -Math.sin(half)),
        complex(Math.cos(half)),
      ];
    case Opcode.Ry:
      return [
        complex(Math.cos(half)),
        complex(-Math.sin(half)),
        complex(Math.sin(half)),
        complex(Math.cos(half)),
      ];
    case Opcode.Rz:
      return [
        complex(Math.cos(-half), Math.sin(-half)),
        complex(0),
        complex(0),
        complex(Math.cos(half), Math.sin(half)),
      ];
    case Opcode.P:
      return [complex(1), complex(0), complex(0), complex(Math.cos(t), Math.sin(t))];
    default:
      return undefined;
  }
}

/** Exposed so a test can compare it against the production gate table. */
export { referenceMatrix };

/** Dense `size x size` complex matrix, row-major. */
export interface DenseMatrix {
  readonly size: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
}

function zeros(size: number): DenseMatrix {
  return { size, re: new Float64Array(size * size), im: new Float64Array(size * size) };
}

/**
 * Build the full operator for one instruction by evaluating `<j| Op |i>` for
 * every pair of basis states.
 *
 * Each column `i` is computed from the definition of the gate:
 *  - a single-qubit gate on `t` maps `|i>` to a superposition of the two states
 *    that agree with `i` everywhere except bit `t`;
 *  - `cx`, `ccx` and `swap` are permutations, so their columns are single 1s;
 *  - `cz` is diagonal with a -1 where the relevant bits are both set.
 */
export function denseOperator(instruction: IrInstruction, qubitCount: number): DenseMatrix {
  const size = 2 ** qubitCount;
  const m = zeros(size);
  const set = (row: number, col: number, value: Complex): void => {
    m.re[row * size + col] = value.re;
    m.im[row * size + col] = value.im;
  };

  const { opcode, qubits, params } = instruction;

  switch (opcode) {
    case Opcode.Barrier: {
      for (let i = 0; i < size; i++) set(i, i, complex(1));
      return m;
    }

    case Opcode.Cx: {
      const [control, target] = [qubits[0]!, qubits[1]!];
      for (let i = 0; i < size; i++) {
        const image = ((i >> control) & 1) === 1 ? i ^ (1 << target) : i;
        set(image, i, complex(1));
      }
      return m;
    }

    case Opcode.Ccx: {
      const [c1, c2, target] = [qubits[0]!, qubits[1]!, qubits[2]!];
      for (let i = 0; i < size; i++) {
        const both = ((i >> c1) & 1) === 1 && ((i >> c2) & 1) === 1;
        const image = both ? i ^ (1 << target) : i;
        set(image, i, complex(1));
      }
      return m;
    }

    case Opcode.Swap: {
      const [a, b] = [qubits[0]!, qubits[1]!];
      for (let i = 0; i < size; i++) {
        const bitA = (i >> a) & 1;
        const bitB = (i >> b) & 1;
        let image = i;
        if (bitA !== bitB) image = i ^ (1 << a) ^ (1 << b);
        set(image, i, complex(1));
      }
      return m;
    }

    case Opcode.Cz: {
      const [a, b] = [qubits[0]!, qubits[1]!];
      for (let i = 0; i < size; i++) {
        const both = ((i >> a) & 1) === 1 && ((i >> b) & 1) === 1;
        set(i, i, complex(both ? -1 : 1));
      }
      return m;
    }

    default: {
      const u = referenceMatrix(opcode, params);
      if (!u) throw new Error(`denseOperator: no definition for opcode '${opcode}'`);
      const target = qubits[0]!;
      const bit = 1 << target;
      for (let i = 0; i < size; i++) {
        const b = (i >> target) & 1;
        const zeroIndex = i & ~bit;
        const oneIndex = i | bit;
        // Column i gets U[0][b] in the row where bit t is 0 and U[1][b] where it is 1.
        set(zeroIndex, i, b === 0 ? u[0] : u[1]);
        set(oneIndex, i, b === 0 ? u[2] : u[3]);
      }
      return m;
    }
  }
}

/** Dense matrix-vector product, returning a new state. */
export function applyDense(m: DenseMatrix, state: Statevector): Statevector {
  const size = m.size;
  const out: Complex[] = new Array(size);
  for (let row = 0; row < size; row++) {
    let re = 0;
    let im = 0;
    for (let col = 0; col < size; col++) {
      const mr = m.re[row * size + col]!;
      const mi = m.im[row * size + col]!;
      if (mr === 0 && mi === 0) continue;
      const vr = state.re[col]!;
      const vi = state.im[col]!;
      re += mr * vr - mi * vi;
      im += mr * vi + mi * vr;
    }
    out[row] = complex(re, im);
  }
  return Statevector.fromAmplitudes(out);
}

/**
 * Simulate the unitary part of a circuit by dense matrix multiplication.
 *
 * @throws if the module contains a measurement or reset: this oracle covers
 * unitary evolution only, which is the part where an indexing bug could hide.
 * Measurement is validated separately, against its exact distribution.
 */
export function simulateDense(module: IrModule): Statevector {
  let state = Statevector.zeroState(module.qubitCount);
  for (const instruction of module.instructions) {
    if (!isUnitary(instruction.opcode) && instruction.opcode !== Opcode.Barrier) {
      throw new Error(
        `simulateDense cannot handle '${instruction.opcode}'; it covers unitary evolution only`,
      );
    }
    state = applyDense(denseOperator(instruction, module.qubitCount), state);
  }
  return state;
}
