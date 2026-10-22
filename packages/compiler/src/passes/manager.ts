import { gateCount, type IrModule } from '../ir/ir.js';
import type { Pass } from './pass.js';
import { removeIdentity } from './remove-identity.js';
import { cancelInversePair, cancelSelfInverse } from './cancel-inverses.js';
import { mergeRotations } from './merge-rotations.js';

/**
 * The default optimisation pipeline, in dependency order.
 *
 * `merge-rotations` can produce a zero-angle rotation, which `remove-identity`
 * then deletes; `remove-identity` can bring two self-inverse gates together,
 * which `cancel-self-inverse` then cancels. Rather than hand-order every
 * interaction, the manager simply runs the list until nothing changes.
 */
export const DEFAULT_PASSES: readonly Pass[] = [
  removeIdentity,
  cancelSelfInverse,
  cancelInversePair,
  mergeRotations,
];

export interface PassRunRecord {
  readonly pass: string;
  readonly round: number;
  readonly changed: number;
  readonly notes: readonly string[];
}

export interface OptimizationReport {
  readonly rounds: number;
  readonly runs: readonly PassRunRecord[];
  readonly instructionsBefore: number;
  readonly instructionsAfter: number;
  readonly gatesBefore: number;
  readonly gatesAfter: number;
  /** True when the pipeline stopped because it hit the round cap. */
  readonly hitRoundLimit: boolean;
}

export interface OptimizeOptions {
  readonly passes?: readonly Pass[];
  /**
   * Safety cap on fixpoint iterations. Each round must strictly shrink the
   * circuit or the loop ends, so the cap only guards against a future pass
   * that oscillates.
   */
  readonly maxRounds?: number;
}

export interface OptimizeResult {
  readonly module: IrModule;
  readonly report: OptimizationReport;
}

/** Run the pass pipeline to a fixpoint. */
export function optimize(module: IrModule, options: OptimizeOptions = {}): OptimizeResult {
  const passes = options.passes ?? DEFAULT_PASSES;
  const maxRounds = options.maxRounds ?? 8;

  const instructionsBefore = module.instructions.length;
  const gatesBefore = gateCount(module);
  const runs: PassRunRecord[] = [];
  const allNotes: string[] = [];

  let current = module;
  let round = 0;
  let hitRoundLimit = false;

  for (; round < maxRounds; round++) {
    let changedThisRound = 0;
    for (const pass of passes) {
      const result = pass.run(current);
      if (result.changed > 0) {
        current = result.module;
        changedThisRound += result.changed;
        runs.push({
          pass: pass.name,
          round: round + 1,
          changed: result.changed,
          notes: result.notes,
        });
        allNotes.push(...result.notes);
      }
    }
    if (changedThisRound === 0) break;
    if (round === maxRounds - 1) hitRoundLimit = true;
  }

  const optimized: IrModule = {
    ...current,
    metadata: {
      passes: passes.map((p) => p.name),
      notes: allNotes,
    },
  };

  return {
    module: optimized,
    report: {
      rounds: round,
      runs,
      instructionsBefore,
      instructionsAfter: optimized.instructions.length,
      gatesBefore,
      gatesAfter: gateCount(optimized),
      hitRoundLimit,
    },
  };
}

export function formatOptimizationReport(report: OptimizationReport): string {
  const lines: string[] = [];
  lines.push(
    `instructions ${report.instructionsBefore} -> ${report.instructionsAfter}, gates ${report.gatesBefore} -> ${report.gatesAfter} in ${report.rounds} round(s)`,
  );
  for (const run of report.runs) {
    lines.push(`  [round ${run.round}] ${run.pass}: ${run.changed} instruction(s)`);
    for (const note of run.notes) lines.push(`      - ${note}`);
  }
  if (report.hitRoundLimit) lines.push('  warning: stopped at the round limit');
  return lines.join('\n');
}
