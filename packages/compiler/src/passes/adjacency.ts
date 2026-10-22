import { touchedQubits, type IrInstruction } from '../ir/ir.js';

export interface AdjacentPair {
  /** Index of the earlier instruction. */
  readonly first: number;
  /** Index of the later instruction. */
  readonly second: number;
}

/**
 * Walk the instruction list and report pairs that are *adjacent on their shared
 * qubit set*: two instructions acting on exactly the same set of qubits with no
 * instruction between them touching any of those qubits.
 *
 * This is the only legality test the cancellation and merge passes need. The
 * argument is short enough to check by hand:
 *
 *   - `lastOn[q]` holds the index of the most recent instruction acting on `q`.
 *   - For instruction `i` on qubit set `S`, if every `q` in `S` has
 *     `lastOn[q] === j` and instruction `j` acts on exactly `S`, then nothing
 *     between `j` and `i` touches any qubit of `S`.
 *   - Therefore the operators of `j` and `i` are adjacent factors in the
 *     circuit's tensor decomposition and may be combined or cancelled.
 *
 * A barrier blocks everything it covers (a bare `barrier` covers all qubits),
 * and `measure`/`reset` block because their opcodes never match a gate's, so
 * no rewrite can cross them.
 *
 * The verdict a pass returns tells the walker how to keep bookkeeping correct
 * so that *runs* of more than two gates resolve in a single scan:
 *
 *   - `'none'`      no rewrite; `i` becomes the new last instruction on `S`.
 *   - `'both-gone'` the pass removed both; `lastOn` rolls back past `first`,
 *                   so `h h h h` collapses entirely in one pass.
 *   - `'kept-first'` the pass folded `second` into `first` and removed only
 *                   `second`; `lastOn` keeps pointing at `first`, so a third
 *                   gate folds into the same accumulator. Without this,
 *                   `rx(1) rx(2) rx(3)` would fold against a stale instruction.
 */
export type PairVerdict = 'none' | 'both-gone' | 'kept-first';
export function scanAdjacentPairs(
  instructions: readonly IrInstruction[],
  qubitCount: number,
  consider: (pair: AdjacentPair) => PairVerdict,
): void {
  const lastOn = new Array<number>(qubitCount).fill(-1);
  /** For each processed instruction, the `lastOn` values it overwrote. */
  const overwritten = new Map<number, Map<number, number>>();

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i]!;
    const touched = touchedQubits(instruction, qubitCount);
    if (touched.length === 0) continue;

    const firstCandidate = lastOn[touched[0]!]!;
    const sharedPredecessor =
      firstCandidate !== -1 && touched.every((q) => lastOn[q] === firstCandidate);

    if (sharedPredecessor) {
      const previous = instructions[firstCandidate]!;
      const previousTouched = touchedQubits(previous, qubitCount);
      const sameSet =
        previousTouched.length === touched.length &&
        previousTouched.every((q) => touched.includes(q));

      if (sameSet) {
        const verdict = consider({ first: firstCandidate, second: i });
        if (verdict === 'both-gone') {
          // Roll `lastOn` back past `first` so the next instruction on this
          // qubit set sees `first`'s predecessor.
          const saved = overwritten.get(firstCandidate);
          for (const q of touched) lastOn[q] = saved?.get(q) ?? -1;
          continue;
        }
        if (verdict === 'kept-first') {
          // `first` absorbed `second`; leave `lastOn` pointing at `first`.
          continue;
        }
      }
    }

    const saved = new Map<number, number>();
    for (const q of touched) {
      saved.set(q, lastOn[q]!);
      lastOn[q] = i;
    }
    overwritten.set(i, saved);
  }
}

/** Remove the instructions at the given indices, preserving order. */
export function removeIndices(
  instructions: readonly IrInstruction[],
  remove: ReadonlySet<number>,
): IrInstruction[] {
  return instructions.filter((_, index) => !remove.has(index));
}
