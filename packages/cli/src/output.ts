import { renderDiagnostics, type Diagnostic } from '@qforge/language';
import { circuitDepth, gateCount, opcodeHistogram, type IrModule } from '@qforge/compiler';
import { formatComplex, type Statevector } from '@qforge/simulator';

export interface Writer {
  out(text: string): void;
  err(text: string): void;
}

export const consoleWriter: Writer = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

/** Collects output instead of writing it, so the CLI is testable in-process. */
export class BufferWriter implements Writer {
  stdout = '';
  stderr = '';
  out(text: string): void {
    this.stdout += text;
  }
  err(text: string): void {
    this.stderr += text;
  }
}

export function reportDiagnostics(
  writer: Writer,
  diagnostics: readonly Diagnostic[],
  source: string,
  fileName: string,
  json: boolean,
): void {
  if (diagnostics.length === 0) return;

  if (json) {
    writer.err(
      `${JSON.stringify(
        {
          file: fileName,
          diagnostics: diagnostics.map((d) => ({
            code: d.code,
            severity: d.severity,
            message: d.message,
            hint: d.hint ?? null,
            line: d.span.line,
            column: d.span.column,
            endLine: d.span.endLine,
            endColumn: d.span.endColumn,
            offset: d.span.start,
            length: d.span.end - d.span.start,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  writer.err(`${renderDiagnostics(diagnostics, source, { fileName })}\n\n`);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  writer.err(`${parts.join(', ')} in ${fileName}\n`);
}

/** A sorted, aligned counts table. */
export function formatCounts(counts: ReadonlyMap<string, number>, shots: number): string {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keyWidth = Math.max(5, ...rows.map(([key]) => key.length || 1));
  const lines: string[] = [];
  lines.push(`${'state'.padEnd(keyWidth)}  ${'count'.padStart(8)}  ${'freq'.padStart(8)}`);
  lines.push(`${'-'.repeat(keyWidth)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}`);
  for (const [key, count] of rows) {
    const label = key.length ? key : '(none)';
    const frequency = (count / shots).toFixed(4);
    lines.push(
      `${label.padEnd(keyWidth)}  ${String(count).padStart(8)}  ${frequency.padStart(8)}`,
    );
  }
  return lines.join('\n');
}

/** Exact probabilities, same shape as the counts table. */
export function formatProbabilityTable(distribution: ReadonlyMap<string, number>): string {
  const rows = [...distribution.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const keyWidth = Math.max(5, ...rows.map(([key]) => key.length || 6));
  const lines: string[] = [];
  lines.push(`${'state'.padEnd(keyWidth)}  ${'probability'.padStart(12)}`);
  lines.push(`${'-'.repeat(keyWidth)}  ${'-'.repeat(12)}`);
  for (const [key, probability] of rows) {
    const label = key.length ? key : '(none)';
    lines.push(`${label.padEnd(keyWidth)}  ${probability.toFixed(10).padStart(12)}`);
  }
  return lines.join('\n');
}

/** Non-negligible amplitudes, in basis order. */
export function formatStatevector(state: Statevector, threshold = 1e-10): string {
  const lines: string[] = [];
  for (let i = 0; i < state.size; i++) {
    const amplitude = state.amplitude(i);
    if (Math.hypot(amplitude.re, amplitude.im) <= threshold) continue;
    lines.push(`${state.basisLabel(i)} : ${formatComplex(amplitude)}`);
  }
  if (lines.length === 0) lines.push('(all amplitudes below the display threshold)');
  return lines.join('\n');
}

/** ASCII bar chart of the basis-state probabilities. */
export function formatProbabilities(
  state: Statevector,
  probabilities: Float64Array,
  threshold = 1e-10,
  width = 32,
): string {
  const lines: string[] = [];
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i]!;
    if (p <= threshold) continue;
    const filled = Math.round(p * width);
    const bar = `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
    lines.push(`${state.basisLabel(i)} ${bar} ${(p * 100).toFixed(2)}%`);
  }
  if (lines.length === 0) lines.push('(no basis state above the display threshold)');
  return lines.join('\n');
}

export function formatCircuitStats(module: IrModule): string {
  const histogram = opcodeHistogram(module);
  const breakdown = Object.entries(histogram)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([opcode, count]) => `${opcode}=${count}`)
    .join(' ');
  return [
    `qubits ${module.qubitCount}  classical bits ${module.clbitCount}`,
    `gates ${gateCount(module)}  instructions ${module.instructions.length}  depth ${circuitDepth(module)}`,
    breakdown ? `opcodes ${breakdown}` : 'opcodes (none)',
  ].join('\n');
}
