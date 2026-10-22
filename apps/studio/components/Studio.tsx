'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BROWSER_LIMITS,
  HARD_MAX_QUBITS,
  formatSource,
  statementAtOffset,
  type Diagnostic,
} from '@qforge/language';
import { statevectorBytes } from '@qforge/language';
import {
  executeCircuit,
  traceCircuit,
  probabilitiesAtStep,
  stateAtStep,
  type ExecutionResult,
  type Trace,
} from '@qforge/simulator';
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from '../lib/examples.generated';
import { useCompile } from '../lib/useCompile';
import { bytes } from '../lib/format';
import { Editor } from './Editor';
import { CircuitDiagram } from './CircuitDiagram';
import { ExecutionPanel } from './ExecutionPanel';
import { CountsTable, CircuitStats } from './ResultsPanel';
import { CompilerInspector } from './CompilerInspector';
import { DebuggerPanel } from './DebuggerPanel';
import { StateInspector } from './StateInspector';
import { ProbabilityChart } from './ProbabilityChart';
import { BlochPanel } from './BlochPanel';
import { DiagnosticsList } from './DiagnosticsList';
import { Tabs, TabPanel } from './Tabs';

const DEFAULT_SOURCE =
  EXAMPLES.find((example) => example.id === DEFAULT_EXAMPLE_ID)?.source ??
  EXAMPLES[0]?.source ??
  '';

/** Breakpoint below which the workspace becomes a single tabbed column. */
const NARROW_BREAKPOINT = 1100;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function Studio() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE_ID);
  const [optimize, setOptimize] = useState(false);
  const [shots, setShots] = useState(1024);
  const [seedText, setSeedText] = useState('42');
  const [revealOffset, setRevealOffset] = useState<number | undefined>(undefined);
  const [caretOffset, setCaretOffset] = useState(0);
  const [lastRun, setLastRun] = useState<ExecutionResult | undefined>(undefined);
  const [trace, setTrace] = useState<Trace | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(-1);
  const [status, setStatus] = useState('Ready. Press Run, or Step to walk the circuit.');
  const [rightTab, setRightTab] = useState('state');
  const [narrowTab, setNarrowTab] = useState('editor');

  const narrow = useIsNarrow();
  const compileState = useCompile(source, optimize);
  const compiled = compileState.result;
  const module = compiled?.module;

  const errorCount = compileState.diagnostics.filter((d) => d.severity === 'error').length;

  /**
   * Rebuild the trace whenever the circuit or the seed changes.
   *
   * Tracing executes the whole circuit once and records every intermediate
   * state, so stepping is just indexing into it. That is what makes backward
   * stepping exact: a measurement's sampled branch is recorded, not re-rolled.
   */
  useEffect(() => {
    if (!module) {
      setTrace(undefined);
      setStepIndex(-1);
      return;
    }
    try {
      const seed = seedText === '' ? undefined : Number(seedText);
      const next = traceCircuit(module, {
        ...(seed !== undefined && Number.isFinite(seed) ? { seed } : {}),
        maxTraceBytes: 48 * 1024 * 1024,
      });
      setTrace(next);
      setStepIndex(-1);
    } catch (error) {
      setTrace(undefined);
      setStatus(
        `Could not trace the circuit: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [module, seedText]);

  const currentState = useMemo(
    () => (trace ? stateAtStep(trace, stepIndex) : undefined),
    [trace, stepIndex],
  );
  const currentProbabilities = useMemo(
    () => (trace ? probabilitiesAtStep(trace, stepIndex) : undefined),
    [trace, stepIndex],
  );
  const changedAmplitudes = useMemo(
    () => (stepIndex >= 0 ? trace?.steps[stepIndex]?.changedAmplitudes : undefined),
    [trace, stepIndex],
  );

  const handleRun = useCallback(() => {
    if (!module) return;
    try {
      const seed = seedText === '' ? undefined : Number(seedText);
      const result = executeCircuit(module, {
        shots,
        ...(seed !== undefined && Number.isFinite(seed) ? { seed } : {}),
      });
      setLastRun(result);
      // Showing the end of the trace after a run keeps the state panel
      // consistent with the counts the user is now looking at.
      setStepIndex((trace?.steps.length ?? 0) - 1);
      setStatus(
        `Ran ${result.shots.toLocaleString()} shot${result.shots === 1 ? '' : 's'} with seed ${result.seed}.`,
      );
      if (narrow) setNarrowTab('results');
      else setRightTab('counts');
    } catch (error) {
      setStatus(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [module, narrow, seedText, shots, trace]);

  const handleStepForward = useCallback(() => {
    if (!trace) return;
    setStepIndex((index) => Math.min(index + 1, trace.steps.length - 1));
    if (narrow) setNarrowTab('debug');
  }, [narrow, trace]);

  const handleStepBack = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, -1));
  }, []);

  const handleReset = useCallback(() => {
    setStepIndex(-1);
    setLastRun(undefined);
    setStatus('Reset to the initial state.');
  }, []);

  const handleRunToEnd = useCallback(() => {
    if (!trace) return;
    setStepIndex(trace.steps.length - 1);
  }, [trace]);

  const handleRevealDiagnostic = useCallback((diagnostic: Diagnostic) => {
    setRevealOffset(diagnostic.span.start);
    // Reset so the same diagnostic can be clicked twice in a row.
    setTimeout(() => setRevealOffset(undefined), 0);
  }, []);

  const handleReveal = useCallback((offset: number) => {
    setRevealOffset(offset);
    setTimeout(() => setRevealOffset(undefined), 0);
  }, []);

  const handleSelectGate = useCallback(
    (index: number) => {
      setStepIndex(index);
      const instruction = trace?.module.instructions[index];
      if (instruction) handleReveal(instruction.loc.start);
    },
    [handleReveal, trace],
  );

  const handleFormat = useCallback(() => {
    const result = formatSource(source);
    if (!result.ok) {
      setStatus('Cannot format: fix the lexical errors first.');
      return;
    }
    if (result.text === source) {
      setStatus('Already formatted.');
      return;
    }
    setSource(result.text);
    setStatus('Formatted.');
  }, [source]);

  const handleLoadExample = useCallback((id: string) => {
    const example = EXAMPLES.find((candidate) => candidate.id === id);
    if (!example) return;
    setExampleId(id);
    setSource(example.source);
    setLastRun(undefined);
    setStepIndex(-1);
    setStatus(`Loaded ${example.file}.`);
  }, []);

  /** Highlight the IR instruction the caret currently sits inside. */
  const caretInstructionIndex = useMemo(() => {
    if (!compiled || !module) return undefined;
    const statement = statementAtOffset(compiled.frontend.program, caretOffset);
    if (!statement) return undefined;
    const found = module.instructions.findIndex(
      (instruction) =>
        instruction.loc.start >= statement.span.start &&
        instruction.loc.end <= statement.span.end,
    );
    return found >= 0 ? found : undefined;
  }, [caretOffset, compiled, module]);

  const highlightIndex = stepIndex >= 0 ? stepIndex : caretInstructionIndex;

  // -------------------------------------------------------------- rendering

  const editorPanel = (
    <section
      className="qf-panel"
      data-testid="panel-source"
      style={{ flex: '1 1 0', minHeight: 0 }}
    >
      <header className="qf-panel-header">
        <span>Source</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {compileState.pending ? (
            <span style={{ color: 'var(--color-text-faint)', textTransform: 'none' }}>
              compiling
            </span>
          ) : errorCount > 0 ? (
            <span style={{ color: 'var(--color-danger)', textTransform: 'none' }}>
              {errorCount} error{errorCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span style={{ color: 'var(--color-success)', textTransform: 'none' }}>
              compiles
            </span>
          )}
          <button type="button" className="qf-button" onClick={handleFormat}>
            Format
          </button>
        </span>
      </header>
      <div className="qf-panel-body" style={{ overflow: 'hidden' }}>
        <Editor
          value={source}
          onChange={setSource}
          diagnostics={compileState.diagnostics}
          revealOffset={revealOffset}
          onCaretOffset={setCaretOffset}
          onRun={handleRun}
          onStep={handleStepForward}
        />
      </div>
    </section>
  );

  const circuitPanel = (
    <section className="qf-panel" data-testid="panel-circuit" style={{ flex: 'none' }}>
      <header className="qf-panel-header">
        <span>Circuit</span>
        {module && module.qubitCount > 0 ? (
          <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
            {bytes(statevectorBytes(module.qubitCount))} statevector
          </span>
        ) : null}
      </header>
      <div className="qf-panel-body" style={{ maxHeight: 280 }}>
        {module ? (
          <CircuitDiagram
            module={module}
            highlightIndex={highlightIndex}
            onSelect={handleSelectGate}
          />
        ) : (
          <div className="qf-empty">
            The circuit appears once the program compiles. Fix the diagnostics below.
          </div>
        )}
      </div>
    </section>
  );

  const diagnosticsPanel = (
    <section
      className="qf-panel"
      data-testid="panel-diagnostics"
      style={{ flex: 'none', maxHeight: 260 }}
    >
      <header className="qf-panel-header">
        <span>Diagnostics</span>
        <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
          {compileState.diagnostics.length === 0
            ? 'none'
            : `${compileState.diagnostics.length} total`}
        </span>
      </header>
      <div className="qf-panel-body">
        {compileState.crash ? (
          <div className="qf-empty" style={{ color: 'var(--color-danger)' }}>
            The compiler threw an exception, which is a bug in QForge rather than in your
            program:
            <pre className="qf-pre" style={{ whiteSpace: 'pre-wrap', paddingLeft: 0 }}>
              {compileState.crash}
            </pre>
          </div>
        ) : (
          <DiagnosticsList
            diagnostics={compileState.diagnostics}
            source={source}
            onSelect={handleRevealDiagnostic}
          />
        )}
      </div>
    </section>
  );

  const runPanel = (
    <section className="qf-panel" data-testid="panel-execution" style={{ flex: 'none' }}>
      <header className="qf-panel-header">
        <span>Execution</span>
      </header>
      <div className="qf-panel-body">
        <ExecutionPanel
          shots={shots}
          onShotsChange={setShots}
          seedText={seedText}
          onSeedChange={setSeedText}
          optimize={optimize}
          onOptimizeChange={setOptimize}
          canRun={Boolean(module)}
          onRun={handleRun}
          onStepForward={handleStepForward}
          onStepBack={handleStepBack}
          onReset={handleReset}
          onRunToEnd={handleRunToEnd}
          trace={trace}
          stepIndex={stepIndex}
          lastRun={lastRun}
          status={status}
        />
      </div>
    </section>
  );

  const resultsTabs = [
    { id: 'state', label: 'State' },
    { id: 'probabilities', label: 'Probabilities' },
    { id: 'counts', label: 'Counts' },
    { id: 'bloch', label: 'Bloch' },
    { id: 'stats', label: 'Stats' },
  ];

  const resultsPanel = (
    <section
      className="qf-panel"
      data-testid="panel-results"
      style={{ flex: '1 1 0', minHeight: 0 }}
    >
      <header className="qf-panel-header">
        <span>Results</span>
        {stepIndex >= 0 && trace ? (
          <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
            after step {stepIndex + 1}
          </span>
        ) : (
          <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
            initial state
          </span>
        )}
      </header>
      <Tabs
        tabs={resultsTabs}
        active={rightTab}
        onChange={setRightTab}
        ariaLabel="Result views"
      />
      <TabPanel id="state" active={rightTab}>
        <StateInspector
          state={currentState}
          probabilities={currentProbabilities}
          changed={changedAmplitudes}
        />
      </TabPanel>
      <TabPanel id="probabilities" active={rightTab}>
        <ProbabilityChart
          state={currentState}
          probabilities={currentProbabilities}
          caption={
            stepIndex >= 0
              ? `Born-rule probabilities of the state after step ${stepIndex + 1}.`
              : 'Born-rule probabilities of the initial state.'
          }
        />
      </TabPanel>
      <TabPanel id="counts" active={rightTab}>
        <CountsTable result={lastRun} clbitLabels={module?.clbitLabels ?? []} />
      </TabPanel>
      <TabPanel id="bloch" active={rightTab}>
        <BlochPanel state={currentState} labels={module?.qubitLabels ?? []} />
      </TabPanel>
      <TabPanel id="stats" active={rightTab}>
        {module ? (
          <CircuitStats
            module={module}
            optimizedFrom={optimize ? compiled?.unoptimized : undefined}
          />
        ) : (
          <div className="qf-empty">No circuit.</div>
        )}
      </TabPanel>
    </section>
  );

  const debuggerPanel = (
    <section
      className="qf-panel"
      data-testid="panel-debugger"
      style={{ flex: '1 1 0', minHeight: 0 }}
    >
      <header className="qf-panel-header">
        <span>Debugger</span>
        {trace ? (
          <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
            seed {trace.seed}
          </span>
        ) : null}
      </header>
      <div className="qf-panel-body">
        <DebuggerPanel
          trace={trace}
          stepIndex={stepIndex}
          onSelectStep={setStepIndex}
          onReveal={handleReveal}
        />
      </div>
    </section>
  );

  const inspectorPanel = (
    <section
      className="qf-panel"
      data-testid="panel-compiler"
      style={{ flex: '1 1 0', minHeight: 0 }}
    >
      <header className="qf-panel-header">
        <span>Compiler</span>
        <span style={{ textTransform: 'none', color: 'var(--color-text-faint)' }}>
          {optimize ? 'optimised' : 'unoptimised'}
        </span>
      </header>
      <div className="qf-panel-body" style={{ overflow: 'hidden', display: 'flex' }}>
        <CompilerInspector
          compiled={compiled}
          optimize={optimize}
          onReveal={handleReveal}
          caretOffset={caretOffset}
        />
      </div>
    </section>
  );

  const header = (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '9px 14px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface-1)',
        flexWrap: 'wrap',
        flex: 'none',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
        QForge <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>Studio</span>
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--color-text-faint)',
        }}
      >
        Write quantum programs. Understand what they do.
      </p>

      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          // `flex-basis` with `min-width: 0` lets this row shrink below the
          // select's intrinsic width instead of widening the page. Without it
          // the select's option text sets a floor and the whole layout
          // overflows horizontally on a phone.
          flex: '1 1 200px',
          minWidth: 0,
        }}
      >
        <label className="qf-label" htmlFor="qf-example" style={{ margin: 0, flex: 'none' }}>
          Example
        </label>
        <select
          id="qf-example"
          className="qf-input"
          style={{ flex: '1 1 auto', minWidth: 0 }}
          value={exampleId}
          onChange={(event) => handleLoadExample(event.target.value)}
        >
          {EXAMPLES.map((example) => (
            <option key={example.id} value={example.id}>
              {example.title}
            </option>
          ))}
        </select>
      </div>
    </header>
  );

  const limitsNote = (
    <div
      style={{
        padding: '5px 14px',
        fontSize: 11,
        color: 'var(--color-text-faint)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface-1)',
        flex: 'none',
      }}
    >
      Everything runs locally in this browser: nothing is uploaded. Limits here are{' '}
      {BROWSER_LIMITS.maxQubits} qubits ({bytes(statevectorBytes(BROWSER_LIMITS.maxQubits))}{' '}
      statevector), {BROWSER_LIMITS.maxInstructions.toLocaleString()} instructions and 1,000,000
      shots. The CLI goes to 20 qubits, and the hard ceiling is {HARD_MAX_QUBITS}.
    </div>
  );

  if (narrow) {
    const narrowTabs = [
      { id: 'editor', label: 'Code', badge: errorCount || undefined },
      { id: 'circuit', label: 'Circuit' },
      { id: 'results', label: 'Results' },
      { id: 'debug', label: 'Debug' },
      { id: 'compiler', label: 'Compiler' },
    ];
    return (
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          maxWidth: '100%',
          overflowX: 'hidden',
        }}
      >
        {header}
        {limitsNote}
        <Tabs
          tabs={narrowTabs}
          active={narrowTab}
          onChange={setNarrowTab}
          ariaLabel="Workspace sections"
        />
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {narrowTab === 'editor' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 8,
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              {editorPanel}
              {diagnosticsPanel}
            </div>
          ) : null}
          {narrowTab === 'circuit' ? (
            <div
              style={{
                padding: 8,
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {circuitPanel}
              {runPanel}
            </div>
          ) : null}
          {narrowTab === 'results' ? (
            <div
              style={{
                padding: 8,
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {runPanel}
              {resultsPanel}
            </div>
          ) : null}
          {narrowTab === 'debug' ? (
            <div
              style={{
                padding: 8,
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {runPanel}
              {debuggerPanel}
            </div>
          ) : null}
          {narrowTab === 'compiler' ? (
            <div style={{ padding: 8, flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
              {inspectorPanel}
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        maxWidth: '100%',
        overflowX: 'hidden',
      }}
    >
      {header}
      {limitsNote}
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1.15fr) minmax(320px, 1fr) minmax(300px, 0.95fr)',
          gap: 8,
          padding: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {editorPanel}
          {diagnosticsPanel}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {circuitPanel}
          {runPanel}
          {debuggerPanel}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {resultsPanel}
          {inspectorPanel}
        </div>
      </div>
    </main>
  );
}
