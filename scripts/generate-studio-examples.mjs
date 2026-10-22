#!/usr/bin/env node
/**
 * Generate `apps/studio/lib/examples.generated.ts` from `examples/*.qf`.
 *
 * The examples have to exist as real `.qf` files (the CLI runs them, and the
 * test suite checks their documented behaviour) *and* be available as strings
 * inside a static browser bundle. Rather than keep two copies in sync by hand,
 * the `.qf` files are the single source of truth and this script derives the
 * bundle from them.
 *
 * `tests/integration/studio-examples.test.ts` fails if the generated file is
 * stale, so the two can never drift apart unnoticed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXAMPLES_DIR = join(ROOT, 'examples');
const OUTPUT = join(ROOT, 'apps/studio/lib/examples.generated.ts');

/** Display order: simplest concept first, so the picker reads as a curriculum. */
const ORDER = [
  'declare.qf',
  'pauli-x.qf',
  'superposition.qf',
  'interference.qf',
  'rotations.qf',
  'bell.qf',
  'ghz.qf',
  'phase-kickback.qf',
  'deutsch-jozsa.qf',
  'deutsch-jozsa-constant.qf',
  'mid-circuit-measure.qf',
  'optimisable.qf',
];

/** Human title and one-line summary, taken from the file's first comment line. */
function describe(file, source) {
  const firstComment = source
    .split('\n')
    .find((line) => line.trim().startsWith('//') && line.trim().length > 3);
  const text = (firstComment ?? '').replace(/^\s*\/\/\s*/, '').trim();
  const [titlePart, ...rest] = text.split(':');
  const title = (titlePart ?? file).trim();
  const summary = rest.join(':').trim() || title;
  return { title, summary };
}

export function generate() {
  const files = readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith('.qf'))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

  const entries = files.map((file) => {
    const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const { title, summary } = describe(file, source);
    return { id: file.replace(/\.qf$/, ''), file, title, summary, source };
  });

  const body = entries
    .map(
      (entry) =>
        `  {
    id: ${JSON.stringify(entry.id)},
    file: ${JSON.stringify(entry.file)},
    title: ${JSON.stringify(entry.title)},
    summary: ${JSON.stringify(entry.summary)},
    source: ${JSON.stringify(entry.source)},
  },`,
    )
    .join('\n');

  return `// GENERATED FILE - DO NOT EDIT.
// Produced by scripts/generate-studio-examples.mjs from examples/*.qf.
// Run \`node scripts/generate-studio-examples.mjs\` after changing an example.

export interface StudioExample {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly summary: string;
  readonly source: string;
}

export const EXAMPLES: readonly StudioExample[] = [
${body}
];

export const DEFAULT_EXAMPLE_ID = ${JSON.stringify(entries.find((e) => e.id === 'bell')?.id ?? entries[0]?.id ?? '')};
`;
}

const content = generate();
writeFileSync(OUTPUT, content, 'utf8');
console.log(
  `generated ${OUTPUT.replace(ROOT, '')} with ${(content.match(/^\s{4}id:/gm) ?? []).length} examples`,
);
