'use client';

import { useMemo, useState } from 'react';
import { isTrivia, type Token } from '@qforge/language';
import {
  DEFAULT_PASSES,
  emitOpenQasm3,
  formatOptimizationReport,
  printIr,
  type CompileResult,
} from '@qforge/compiler';
import { Tabs, TabPanel } from './Tabs';

export interface CompilerInspectorProps {
  readonly compiled: CompileResult | undefined;
  readonly optimize: boolean;
  /** Jump the editor caret to a source offset. */
  readonly onReveal: (offset: number) => void;
  /** Caret offset in the editor, used to highlight the matching stage rows. */
  readonly caretOffset: number;
}

/**
 * Shows every compiler stage for the current program, side by side with the
 * source.
 *
 * This is the part of the studio that makes the compiler itself the subject
 * rather than a hidden implementation detail: the same program appears as
 * tokens, as a syntax tree, as IR before and after optimisation, and as
 * OpenQASM. Each view carries source positions, so clicking a row moves the
 * editor caret to the statement that produced it.
 */
export function CompilerInspector({
  compiled,
  optimize,
  onReveal,
  caretOffset,
}: CompilerInspectorProps) {
  const [active, setActive] = useState('tokens');

  const tokens = useMemo<Token[]>(
    () => (compiled?.frontend.allTokens ?? []).filter((t) => !isTrivia(t.kind)),
    [compiled],
  );

  if (!compiled) {
    return <div className="qf-empty">Nothing to inspect: the program did not compile.</div>;
  }

  const tabs = [
    { id: 'tokens', label: 'Tokens', badge: tokens.length },
    { id: 'ast', label: 'AST' },
    { id: 'ir', label: 'IR', badge: compiled.unoptimized?.instructions.length ?? 0 },
    { id: 'passes', label: 'Passes' },
    { id: 'qasm', label: 'OpenQASM 3' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Tabs tabs={tabs} active={active} onChange={setActive} ariaLabel="Compiler stages" />

      <TabPanel id="tokens" active={active}>
        <table className="qf-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Kind</th>
              <th scope="col">Text</th>
              <th scope="col">Position</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token, index) => {
              const current =
                caretOffset >= token.span.start &&
                caretOffset < Math.max(token.span.end, token.span.start + 1);
              return (
                <tr
                  key={`${index}-${token.span.start}`}
                  onClick={() => onReveal(token.span.start)}
                  style={{
                    cursor: 'pointer',
                    background: current
                      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                      : undefined,
                  }}
                >
                  <td data-numeric="" style={{ color: 'var(--color-text-faint)' }}>
                    {index}
                  </td>
                  <td style={{ color: 'var(--color-accent)' }}>{token.kind}</td>
                  <td>{token.text === '' ? '—' : JSON.stringify(token.text)}</td>
                  <td style={{ color: 'var(--color-text-faint)' }}>
                    {token.span.line}:{token.span.column}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TabPanel>

      <TabPanel id="ast" active={active}>
        <pre className="qf-pre" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(
            compiled.frontend.program,
            (key, value) =>
              key === 'span' ||
              key === 'nameSpan' ||
              key === 'gateSpan' ||
              key === 'paramListSpan'
                ? undefined
                : value,
            2,
          )}
        </pre>
        <div className="qf-empty" style={{ borderTop: '1px solid var(--color-border)' }}>
          Source spans are present on every node but hidden here for readability. Use{' '}
          <code className="qf-mono">qforge inspect file.qf --ast</code> for the full tree.
        </div>
      </TabPanel>

      <TabPanel id="ir" active={active}>
        {compiled.unoptimized ? (
          <>
            <div className="qf-empty" style={{ paddingBottom: 4 }}>
              Qubits print as <code className="qf-mono">%0</code> and classical bits as{' '}
              <code className="qf-mono">$0</code>: the IR has no idea what the program called
              them. Click a row to jump to its source line.
            </div>
            <table className="qf-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Opcode</th>
                  <th scope="col">Operands</th>
                  <th scope="col">Params</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {(optimize && compiled.module
                  ? compiled.module
                  : compiled.unoptimized
                ).instructions.map((instruction, index) => (
                  <tr
                    key={index}
                    onClick={() => onReveal(instruction.loc.start)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td data-numeric="" style={{ color: 'var(--color-text-faint)' }}>
                      {index}
                    </td>
                    <td style={{ color: 'var(--color-accent)' }}>{instruction.opcode}</td>
                    <td>
                      {instruction.qubits.map((q) => `%${q}`).join(', ')}
                      {instruction.clbit !== undefined ? ` -> $${instruction.clbit}` : ''}
                    </td>
                    <td>
                      {instruction.params.length
                        ? instruction.params.map((p) => p.toFixed(6)).join(', ')
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--color-text-faint)' }}>
                      {instruction.loc.line}:{instruction.loc.column}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre className="qf-pre" style={{ borderTop: '1px solid var(--color-border)' }}>
              {printIr(optimize && compiled.module ? compiled.module : compiled.unoptimized)}
            </pre>
          </>
        ) : (
          <div className="qf-empty">No IR.</div>
        )}
      </TabPanel>

      <TabPanel id="passes" active={active}>
        {!optimize ? (
          <div className="qf-empty">
            Optimisation is off, so the IR is a one-to-one lowering of the source. Turn on
            &ldquo;Optimise&rdquo; in the run panel to see the passes work.
            <div style={{ marginTop: 12 }}>
              <div className="qf-label">Available passes</div>
              {DEFAULT_PASSES.map((pass) => (
                <div key={pass.name} style={{ marginTop: 8 }}>
                  <div className="qf-mono" style={{ color: 'var(--color-accent)' }}>
                    {pass.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                    {pass.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : compiled.report ? (
          <>
            <pre className="qf-pre">{formatOptimizationReport(compiled.report)}</pre>
            <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 12px' }}>
              <div className="qf-label">Why each rewrite is valid</div>
              {DEFAULT_PASSES.map((pass) => (
                <div key={pass.name} style={{ marginTop: 10 }}>
                  <div
                    className="qf-mono"
                    style={{ color: 'var(--color-accent)', fontSize: 12 }}
                  >
                    {pass.name}
                  </div>
                  <div
                    style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}
                  >
                    {pass.justification}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="qf-empty">No pass report.</div>
        )}
      </TabPanel>

      <TabPanel id="qasm" active={active}>
        {compiled.module ? (
          <>
            <pre className="qf-pre">{emitOpenQasm3(compiled.module).code}</pre>
            <div className="qf-empty" style={{ borderTop: '1px solid var(--color-border)' }}>
              This is the subset of OpenQASM 3 that QForge programs can express: declarations,
              the seventeen <code className="qf-mono">stdgates.inc</code> gates QForge exposes,{' '}
              <code className="qf-mono">measure</code>, <code className="qf-mono">reset</code>{' '}
              and <code className="qf-mono">barrier</code>. There is no classical control flow,
              no <code className="qf-mono">gate</code> definition and no timing. The generator
              is not an OpenQASM 3 implementation.
            </div>
          </>
        ) : (
          <div className="qf-empty">No code generated.</div>
        )}
      </TabPanel>
    </div>
  );
}
