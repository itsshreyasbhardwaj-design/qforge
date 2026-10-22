import type { IrModule } from '../ir/ir.js';

export interface PassResult {
  readonly module: IrModule;
  /** Number of instructions removed or rewritten. Zero means "no change". */
  readonly changed: number;
  readonly notes: readonly string[];
}

/**
 * A single IR-to-IR transformation.
 *
 * Every pass in QForge must be *semantics preserving up to nothing at all*:
 * the output circuit has to implement the same operator as the input, not
 * merely the same measurement statistics. That stricter contract is what lets
 * the step debugger show optimised and unoptimised runs side by side and get
 * identical statevectors, and it is checked by a property test that compares
 * full statevectors of random circuits before and after optimisation
 * (`tests/property/pass-equivalence.test.ts`).
 */
export interface Pass {
  readonly name: string;
  readonly description: string;
  /**
   * Why this rewrite is mathematically valid. Surfaced in the studio's
   * compiler inspector so the user can check the reasoning, not just the result.
   */
  readonly justification: string;
  run(module: IrModule): PassResult;
}

export const unchanged = (module: IrModule): PassResult => ({
  module,
  changed: 0,
  notes: [],
});
