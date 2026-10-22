'use client';

import { useMemo } from 'react';
import { GATES } from '@qforge/language';
import {
  Opcode,
  circuitDepth,
  displayAngle,
  type IrInstruction,
  type IrModule,
} from '@qforge/compiler';

export interface CircuitDiagramProps {
  readonly module: IrModule;
  /** Instruction index to highlight, e.g. the debugger's current step. */
  readonly highlightIndex?: number;
  /** Fired when a gate is clicked, with its instruction index. */
  readonly onSelect?: (index: number) => void;
}

const WIRE_LABEL_WIDTH = 86;
const COLUMN_WIDTH = 46;
const ROW_HEIGHT = 40;
const TOP_PADDING = 26;
const BOTTOM_PADDING = 14;
const BOX = 26;

interface Placed {
  readonly instruction: IrInstruction;
  readonly index: number;
  readonly column: number;
}

/**
 * Pack instructions into columns.
 *
 * Greedy left-packing: each instruction takes the earliest column in which none
 * of its qubits are already busy. For a two-qubit gate the *span* between its
 * operands is reserved as well, otherwise an unrelated single-qubit gate could
 * be drawn underneath the vertical connector and read as part of it.
 *
 * The number of columns this produces is exactly the circuit depth, so the
 * drawing and the reported depth can never disagree.
 */
function layout(module: IrModule): { placed: Placed[]; columns: number } {
  const busyUntil = new Array<number>(module.qubitCount).fill(0);
  const placed: Placed[] = [];
  let columns = 0;

  module.instructions.forEach((instruction, index) => {
    const touched =
      instruction.opcode === Opcode.Barrier && instruction.qubits.length === 0
        ? Array.from({ length: module.qubitCount }, (_, i) => i)
        : [...instruction.qubits];
    if (touched.length === 0) return;

    const low = Math.min(...touched);
    const high = Math.max(...touched);
    // Reserve the whole span so vertical connectors stay unobstructed.
    let column = 0;
    for (let q = low; q <= high; q++) column = Math.max(column, busyUntil[q] ?? 0);
    for (let q = low; q <= high; q++) busyUntil[q] = column + 1;

    placed.push({ instruction, index, column });
    columns = Math.max(columns, column + 1);
  });

  return { placed, columns };
}

/** One-line human description of an instruction, for tooltips and the a11y list. */
function describe(instruction: IrInstruction, module: IrModule): string {
  const labels = instruction.qubits.map((q) => module.qubitLabels[q] ?? `q${q}`);
  const guard = instruction.condition ? `only when ${instruction.condition.text}: ` : '';

  if (instruction.opcode === Opcode.Measure) {
    const target = module.clbitLabels[instruction.clbit ?? 0] ?? `c${instruction.clbit}`;
    return `${guard}measure ${labels[0]} into ${target}: collapses the qubit and records the outcome`;
  }
  if (instruction.opcode === Opcode.Reset) {
    return `reset ${labels[0]}: measure, discard the result, and flip back to |0>`;
  }
  if (instruction.opcode === Opcode.Barrier) {
    return labels.length
      ? `barrier on ${labels.join(', ')}: the optimiser will not move gates across this`
      : 'barrier on all qubits: the optimiser will not move gates across this';
  }

  const signature = GATES.get(instruction.opcode);
  const params = instruction.params.length
    ? `(${instruction.params.map((p) => displayAngle(p)).join(', ')})`
    : '';
  const operands =
    instruction.qubits.length === 1
      ? labels[0]
      : instruction.opcode === Opcode.Cx || instruction.opcode === Opcode.Ccx
        ? `control ${labels.slice(0, -1).join(' and ')}, target ${labels[labels.length - 1]}`
        : labels.join(' and ');
  return `${guard}${instruction.opcode}${params} on ${operands} - ${signature?.description ?? ''}`;
}

/** Short label drawn inside a gate box. */
function boxLabel(instruction: IrInstruction): string {
  if (instruction.opcode === Opcode.Measure) return 'M';
  if (instruction.opcode === Opcode.Reset) return '|0>';
  return instruction.opcode.toUpperCase();
}

export function CircuitDiagram({ module, highlightIndex, onSelect }: CircuitDiagramProps) {
  const { placed, columns } = useMemo(() => layout(module), [module]);
  const depth = useMemo(() => circuitDepth(module), [module]);

  if (module.qubitCount === 0) {
    return <div className="qf-empty">No qubits declared, so there is no circuit to draw.</div>;
  }

  // A classical bus row is drawn only when something is predicated, so an
  // ordinary circuit looks exactly as it did before.
  const hasConditions = module.instructions.some((i) => i.condition !== undefined);
  const classicalRowY =
    TOP_PADDING + module.qubitCount * ROW_HEIGHT + (hasConditions ? ROW_HEIGHT / 2 : 0);

  const width = WIRE_LABEL_WIDTH + Math.max(columns, 1) * COLUMN_WIDTH + 24;
  const height =
    TOP_PADDING +
    module.qubitCount * ROW_HEIGHT +
    (hasConditions ? ROW_HEIGHT : 0) +
    BOTTOM_PADDING;
  const wireY = (qubit: number) => TOP_PADDING + qubit * ROW_HEIGHT + ROW_HEIGHT / 2;
  const columnX = (column: number) =>
    WIRE_LABEL_WIDTH + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;

  const summary =
    `Circuit with ${module.qubitCount} qubit${module.qubitCount === 1 ? '' : 's'}, ` +
    `${module.instructions.length} instruction${module.instructions.length === 1 ? '' : 's'} ` +
    `and depth ${depth}.`;

  return (
    <div style={{ padding: '10px 12px' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        style={{ display: 'block', maxWidth: '100%', fontFamily: 'var(--font-mono)' }}
      >
        <title>{summary}</title>
        <desc>
          {placed.map((p) => describe(p.instruction, module)).join('. ') || 'Empty circuit.'}
        </desc>

        {/* Qubit wires and their labels. */}
        {Array.from({ length: module.qubitCount }, (_, qubit) => (
          <g key={`wire-${qubit}`}>
            <text
              x={WIRE_LABEL_WIDTH - 10}
              y={wireY(qubit) + 4}
              textAnchor="end"
              fontSize={11.5}
              fill="var(--color-text-muted)"
            >
              {module.qubitLabels[qubit] ?? `q${qubit}`}
            </text>
            <line
              x1={WIRE_LABEL_WIDTH}
              y1={wireY(qubit)}
              x2={width - 12}
              y2={wireY(qubit)}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* The classical control bus: drawn as a double line, the usual
            convention for a classical wire in a circuit diagram. */}
        {hasConditions ? (
          <g>
            <text
              x={WIRE_LABEL_WIDTH - 10}
              y={classicalRowY + 4}
              textAnchor="end"
              fontSize={11.5}
              fill="var(--color-warning)"
            >
              classical
            </text>
            <line
              x1={WIRE_LABEL_WIDTH}
              y1={classicalRowY - 1.5}
              x2={width - 12}
              y2={classicalRowY - 1.5}
              stroke="var(--color-warning)"
              strokeWidth={1}
              opacity={0.55}
            />
            <line
              x1={WIRE_LABEL_WIDTH}
              y1={classicalRowY + 1.5}
              x2={width - 12}
              y2={classicalRowY + 1.5}
              stroke="var(--color-warning)"
              strokeWidth={1}
              opacity={0.55}
            />
          </g>
        ) : null}

        {/* Column ruler, so depth is readable off the drawing. */}
        {Array.from({ length: columns }, (_, column) => (
          <text
            key={`ruler-${column}`}
            x={columnX(column)}
            y={14}
            textAnchor="middle"
            fontSize={9.5}
            fill="var(--color-text-faint)"
          >
            {column + 1}
          </text>
        ))}

        {/* Predicate links, drawn as one layer beneath the gates. A dashed
            line from the gate down to the classical bus, ending in a filled
            square, makes it visually obvious which gates fire conditionally
            and on what -- without changing how any gate itself is drawn. */}
        {placed
          .filter(({ instruction }) => instruction.condition !== undefined)
          .map(({ instruction, index, column }) => {
            const x = columnX(column);
            const lowest = instruction.qubits.length ? Math.max(...instruction.qubits) : 0;
            const colour =
              index === highlightIndex ? 'var(--color-accent)' : 'var(--color-warning)';
            return (
              <g key={`predicate-${index}`} pointerEvents="none">
                <line
                  x1={x}
                  y1={wireY(lowest)}
                  x2={x}
                  y2={classicalRowY}
                  stroke={colour}
                  strokeWidth={1.2}
                  strokeDasharray="2 2"
                  opacity={0.9}
                />
                <rect x={x - 3.5} y={classicalRowY - 3.5} width={7} height={7} fill={colour} />
                <text
                  x={x + 7}
                  y={classicalRowY + 4}
                  fontSize={8}
                  fill="var(--color-text-faint)"
                >
                  {instruction.condition!.text}
                </text>
              </g>
            );
          })}

        {placed.map(({ instruction, index, column }) => {
          const x = columnX(column);
          const highlighted = index === highlightIndex;
          const stroke = highlighted ? 'var(--color-accent)' : 'var(--color-border-strong)';
          const fill = highlighted ? 'var(--color-accent-dim)' : 'var(--color-surface-3)';
          const tooltip = describe(instruction, module);
          const interactive = Boolean(onSelect);

          const common = {
            style: interactive ? { cursor: 'pointer' } : undefined,
            onClick: onSelect ? () => onSelect(index) : undefined,
            ...(interactive
              ? {
                  tabIndex: 0,
                  role: 'button',
                  'aria-label': tooltip,
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect?.(index);
                    }
                  },
                }
              : {}),
          };

          // --- barrier: a dashed fence, drawn behind everything else ---
          if (instruction.opcode === Opcode.Barrier) {
            const span = instruction.qubits.length
              ? instruction.qubits
              : Array.from({ length: module.qubitCount }, (_, i) => i);
            const top = wireY(Math.min(...span)) - ROW_HEIGHT / 2 + 4;
            const bottom = wireY(Math.max(...span)) + ROW_HEIGHT / 2 - 4;
            return (
              <g key={index} {...common}>
                <title>{tooltip}</title>
                <line
                  x1={x}
                  y1={top}
                  x2={x}
                  y2={bottom}
                  stroke={highlighted ? 'var(--color-accent)' : 'var(--color-text-faint)'}
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                />
              </g>
            );
          }

          const qubits = instruction.qubits;
          const connector =
            qubits.length > 1 ? (
              <line
                x1={x}
                y1={wireY(Math.min(...qubits))}
                x2={x}
                y2={wireY(Math.max(...qubits))}
                stroke={highlighted ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                strokeWidth={1.5}
              />
            ) : null;

          // --- cx / ccx: control dots plus a target cross ---
          if (instruction.opcode === Opcode.Cx || instruction.opcode === Opcode.Ccx) {
            const target = qubits[qubits.length - 1]!;
            const controls = qubits.slice(0, -1);
            return (
              <g key={index} {...common}>
                <title>{tooltip}</title>
                {connector}
                {controls.map((control) => (
                  <circle
                    key={control}
                    cx={x}
                    cy={wireY(control)}
                    r={4.5}
                    fill={highlighted ? 'var(--color-accent)' : 'var(--color-text)'}
                  />
                ))}
                <circle
                  cx={x}
                  cy={wireY(target)}
                  r={10}
                  fill="var(--color-surface-1)"
                  stroke={highlighted ? 'var(--color-accent)' : 'var(--color-text)'}
                  strokeWidth={1.5}
                />
                <line
                  x1={x - 10}
                  y1={wireY(target)}
                  x2={x + 10}
                  y2={wireY(target)}
                  stroke={highlighted ? 'var(--color-accent)' : 'var(--color-text)'}
                  strokeWidth={1.5}
                />
                <line
                  x1={x}
                  y1={wireY(target) - 10}
                  x2={x}
                  y2={wireY(target) + 10}
                  stroke={highlighted ? 'var(--color-accent)' : 'var(--color-text)'}
                  strokeWidth={1.5}
                />
              </g>
            );
          }

          // --- cz: a dot at each end, because it is symmetric ---
          if (instruction.opcode === Opcode.Cz) {
            return (
              <g key={index} {...common}>
                <title>{tooltip}</title>
                {connector}
                {qubits.map((qubit) => (
                  <circle
                    key={qubit}
                    cx={x}
                    cy={wireY(qubit)}
                    r={4.5}
                    fill={highlighted ? 'var(--color-accent)' : 'var(--color-text)'}
                  />
                ))}
                <text
                  x={x + 9}
                  y={(wireY(qubits[0]!) + wireY(qubits[1]!)) / 2 + 4}
                  fontSize={10}
                  fill="var(--color-text-muted)"
                >
                  Z
                </text>
              </g>
            );
          }

          // --- swap: a cross at each end ---
          if (instruction.opcode === Opcode.Swap) {
            const colour = highlighted ? 'var(--color-accent)' : 'var(--color-text)';
            return (
              <g key={index} {...common}>
                <title>{tooltip}</title>
                {connector}
                {qubits.map((qubit) => (
                  <g key={qubit}>
                    <line
                      x1={x - 6}
                      y1={wireY(qubit) - 6}
                      x2={x + 6}
                      y2={wireY(qubit) + 6}
                      stroke={colour}
                      strokeWidth={1.8}
                    />
                    <line
                      x1={x - 6}
                      y1={wireY(qubit) + 6}
                      x2={x + 6}
                      y2={wireY(qubit) - 6}
                      stroke={colour}
                      strokeWidth={1.8}
                    />
                  </g>
                ))}
              </g>
            );
          }

          // --- everything else: a labelled box on one wire ---
          const qubit = qubits[0]!;
          const isMeasure = instruction.opcode === Opcode.Measure;
          const label = boxLabel(instruction);
          const param = instruction.params.length ? displayAngle(instruction.params[0]!) : '';

          return (
            <g key={index} {...common}>
              <title>{tooltip}</title>
              <rect
                x={x - BOX / 2}
                y={wireY(qubit) - BOX / 2}
                width={BOX}
                height={BOX}
                rx={4}
                fill={isMeasure && !highlighted ? 'var(--color-surface-2)' : fill}
                stroke={isMeasure && !highlighted ? 'var(--color-warning)' : stroke}
                strokeWidth={1.3}
              />
              <text
                x={x}
                y={wireY(qubit) + 4}
                textAnchor="middle"
                fontSize={label.length > 2 ? 8.5 : 11}
                fontWeight={600}
                fill={isMeasure && !highlighted ? 'var(--color-warning)' : 'var(--color-text)'}
              >
                {label}
              </text>
              {param ? (
                <text
                  x={x}
                  y={wireY(qubit) + BOX / 2 + 10}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill="var(--color-text-faint)"
                >
                  {param}
                </text>
              ) : null}
              {isMeasure ? (
                <text
                  x={x}
                  y={wireY(qubit) + BOX / 2 + 10}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill="var(--color-text-faint)"
                >
                  {module.clbitLabels[instruction.clbit ?? 0] ?? ''}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div
        style={{
          marginTop: 8,
          fontSize: 11.5,
          color: 'var(--color-text-faint)',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span>depth {depth}</span>
        <span>columns {columns}</span>
        <span>instructions {module.instructions.length}</span>
        {onSelect ? <span>click a gate to step to it</span> : null}
      </div>
    </div>
  );
}
