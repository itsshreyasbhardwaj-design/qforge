import { GATE_NAMES, BUILTIN_CONSTANTS } from '@qforge/language';

export const QFORGE_LANGUAGE_ID = 'qforge';

const KEYWORDS = ['qubit', 'bit', 'const', 'measure', 'reset', 'barrier'];

/**
 * Monaco language registration for QForge.
 *
 * The gate and constant lists come from `@qforge/language` rather than being
 * retyped here, so the editor cannot highlight a gate the compiler rejects, or
 * fail to highlight one it accepts.
 */
export const QFORGE_MONARCH = {
  defaultToken: '',
  ignoreCase: false,
  keywords: KEYWORDS,
  gates: [...GATE_NAMES],
  constants: [...BUILTIN_CONSTANTS.keys()],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@blockComment'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@gates': 'type.identifier',
            '@constants': 'number.float',
            '@default': 'identifier',
          },
        },
      ],
      [/\d+\.\d*([eE][+-]?\d+)?/, 'number.float'],
      [/\.\d+([eE][+-]?\d+)?/, 'number.float'],
      [/\d+([eE][+-]?\d+)?/, 'number'],
      [/->/, 'operator'],
      [/[+\-*/^=]/, 'operator'],
      [/[;,]/, 'delimiter'],
      [/[()[\]]/, '@brackets'],
      [/[ \t\r\n]+/, 'white'],
    ],
    blockComment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
} as const;

export const QFORGE_LANGUAGE_CONFIGURATION = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] as [string, string] },
  brackets: [
    ['(', ')'],
    ['[', ']'],
  ] as [string, string][],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '/*', close: '*/' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
  ],
};

/** Dark theme matching the studio's surface colours. */
export const QFORGE_THEME = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7483', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c08cf0' },
    { token: 'type.identifier', foreground: '5eb0ef' },
    { token: 'number', foreground: '5fd4a0' },
    { token: 'number.float', foreground: '5fd4a0' },
    { token: 'operator', foreground: '9aa3b2' },
    { token: 'delimiter', foreground: '6b7483' },
    { token: 'identifier', foreground: 'e6e9ef' },
  ],
  colors: {
    'editor.background': '#0b0d10',
    'editor.foreground': '#e6e9ef',
    'editorLineNumber.foreground': '#3a4250',
    'editorLineNumber.activeForeground': '#9aa3b2',
    'editor.selectionBackground': '#2f6c9e66',
    'editor.lineHighlightBackground': '#121519',
    'editorCursor.foreground': '#5eb0ef',
    'editorIndentGuide.background1': '#1b2027',
    'editorGutter.background': '#0b0d10',
    'editorWidget.background': '#181c22',
    'editorWidget.border': '#2a303b',
    'editorHoverWidget.background': '#181c22',
    'editorError.foreground': '#f07878',
    'editorWarning.foreground': '#e8c56a',
  },
};

/** Completion items for gates, keywords and constants. */
export function completionItems(): Array<{
  label: string;
  detail: string;
  insertText: string;
  kind: 'keyword' | 'function' | 'constant';
}> {
  return [
    ...KEYWORDS.map((label) => ({
      label,
      detail: 'keyword',
      insertText: label,
      kind: 'keyword' as const,
    })),
    ...GATE_NAMES.map((label) => ({
      label,
      detail: 'gate',
      insertText: label,
      kind: 'function' as const,
    })),
    ...[...BUILTIN_CONSTANTS.keys()].map((label) => ({
      label,
      detail: 'constant',
      insertText: label,
      kind: 'constant' as const,
    })),
  ];
}
