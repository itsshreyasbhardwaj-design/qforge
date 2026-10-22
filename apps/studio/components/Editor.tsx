'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import type { Diagnostic } from '@qforge/language';
import {
  QFORGE_LANGUAGE_CONFIGURATION,
  QFORGE_LANGUAGE_ID,
  QFORGE_MONARCH,
  QFORGE_THEME,
  completionItems,
} from '../lib/monaco-language';

/**
 * Monaco is loaded dynamically because it is far larger than the rest of the
 * app and is useless during server rendering.
 *
 * The `loading` component is not optional decoration: `next/dynamic` without a
 * `loading` fallback suspends, and a suspended boundary this high in the tree
 * blanks the whole page until the chunk arrives. With a fallback, the panels
 * around the editor stay interactive while it loads.
 */
const MonacoEditor = dynamic(
  async () => {
    // `monaco-setup` points the loader at the locally bundled Monaco. It has to
    // be imported before the editor mounts, which importing it here guarantees.
    const [reactMonaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('../lib/monaco-setup'),
    ]);
    return reactMonaco.Editor;
  },
  {
    ssr: false,
    loading: () => (
      <div
        className="qf-mono"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-faint)',
        }}
      >
        loading editor...
      </div>
    ),
  },
);

export interface EditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly diagnostics: readonly Diagnostic[];
  /** Caret target requested from elsewhere, e.g. clicking a diagnostic. */
  readonly revealOffset?: number;
  /** Fired when the caret moves, so other panels can follow the selection. */
  readonly onCaretOffset?: (offset: number) => void;
  readonly onRun?: () => void;
  readonly onStep?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Monaco's types are only available once its chunk loads, so the editor and
// monaco namespace are typed loosely at this boundary and narrowed by use.

export function Editor({
  value,
  onChange,
  diagnostics,
  revealOffset,
  onCaretOffset,
  onRun,
  onStep,
}: EditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  /** Mirror QForge diagnostics into Monaco's marker model. */
  const syncMarkers = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    monaco.editor.setModelMarkers(
      model,
      'qforge',
      diagnostics.map((diagnostic) => ({
        severity:
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: diagnostic.hint
          ? `${diagnostic.code}: ${diagnostic.message}\n${diagnostic.hint}`
          : `${diagnostic.code}: ${diagnostic.message}`,
        startLineNumber: diagnostic.span.line,
        startColumn: diagnostic.span.column,
        endLineNumber: diagnostic.span.endLine,
        endColumn: Math.max(diagnostic.span.endColumn, diagnostic.span.column + 1),
        code: diagnostic.code,
        source: 'qforge',
      })),
    );
  }, [diagnostics]);

  useEffect(syncMarkers, [syncMarkers]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || revealOffset === undefined) return;
    const model = editor.getModel();
    if (!model) return;
    const position = model.getPositionAt(revealOffset);
    editor.setPosition(position);
    editor.revealPositionInCenterIfOutsideViewport(position);
    editor.focus();
  }, [revealOffset]);

  const handleBeforeMount = useCallback((monaco: any) => {
    monacoRef.current = monaco;

    // Registering twice is harmless but wasteful on fast refresh.
    const known = monaco.languages.getLanguages().some((l: any) => l.id === QFORGE_LANGUAGE_ID);
    if (!known) {
      monaco.languages.register({ id: QFORGE_LANGUAGE_ID, extensions: ['.qf'] });
      monaco.languages.setMonarchTokensProvider(QFORGE_LANGUAGE_ID, QFORGE_MONARCH as any);
      monaco.languages.setLanguageConfiguration(
        QFORGE_LANGUAGE_ID,
        QFORGE_LANGUAGE_CONFIGURATION as any,
      );
      monaco.languages.registerCompletionItemProvider(QFORGE_LANGUAGE_ID, {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: completionItems().map((item) => ({
              label: item.label,
              detail: item.detail,
              insertText: item.insertText,
              range,
              kind:
                item.kind === 'keyword'
                  ? monaco.languages.CompletionItemKind.Keyword
                  : item.kind === 'function'
                    ? monaco.languages.CompletionItemKind.Function
                    : monaco.languages.CompletionItemKind.Constant,
            })),
          };
        },
      });
    }
    monaco.editor.defineTheme('qforge-dark', QFORGE_THEME as any);
  }, []);

  const handleMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      syncMarkers();

      if (onCaretOffset) {
        editor.onDidChangeCursorPosition(() => {
          const model = editor.getModel();
          if (model) onCaretOffset(model.getOffsetAt(editor.getPosition()));
        });
      }

      // Keyboard shortcuts. Ctrl/Cmd+Enter runs; Ctrl/Cmd+' steps.
      if (onRun) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRun());
      }
      if (onStep) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, () => onStep());
      }
    },
    [onCaretOffset, onRun, onStep, syncMarkers],
  );

  return (
    <MonacoEditor
      height="100%"
      language={QFORGE_LANGUAGE_ID}
      theme="qforge-dark"
      value={value}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={(next) => onChange(next ?? '')}
      options={{
        fontFamily:
          "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        autoIndent: 'full',
        wordWrap: 'off',
        padding: { top: 10, bottom: 10 },
        smoothScrolling: false,
        cursorBlinking: 'solid',
        bracketPairColorization: { enabled: false },
        occurrencesHighlight: 'off',
        // Accessibility: keep the editor reachable and announce diagnostics.
        accessibilitySupport: 'auto',
        ariaLabel: 'QForge program source',
      }}
    />
  );
}
