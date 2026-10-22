import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_LIMITS, checkSource } from '@qforge/language';

/**
 * The studio bundles the examples as strings, generated from `examples/*.qf` by
 * `scripts/generate-studio-examples.mjs`. The `.qf` files are the single source
 * of truth; this test fails if the generated copy has fallen behind, so the two
 * cannot drift apart unnoticed.
 */

const GENERATED = new URL('../../apps/studio/lib/examples.generated.ts', import.meta.url);
const EXAMPLES_DIR = new URL('../../examples/', import.meta.url).pathname;

describe('generated studio examples', () => {
  const generated = readFileSync(GENERATED, 'utf8');
  const files = readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith('.qf'))
    .sort();

  it('is marked as generated', () => {
    expect(generated.startsWith('// GENERATED FILE - DO NOT EDIT.')).toBe(true);
    expect(generated).toContain('scripts/generate-studio-examples.mjs');
  });

  it('includes every example file', () => {
    for (const file of files) {
      expect(
        generated,
        `${file} is missing; run scripts/generate-studio-examples.mjs`,
      ).toContain(JSON.stringify(file));
    }
  });

  it('contains no more entries than there are example files', () => {
    const entries = generated.match(/^ {4}file: /gm) ?? [];
    expect(entries).toHaveLength(files.length);
  });

  it('embeds each example verbatim', () => {
    for (const file of files) {
      const source = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
      expect(
        generated,
        `${file} has changed since the bundle was generated; run scripts/generate-studio-examples.mjs`,
      ).toContain(JSON.stringify(source));
    }
  });

  it('every embedded source still compiles', () => {
    // Belt and braces: the strings the browser actually loads, not the files.
    const sources = [...generated.matchAll(/^ {4}source: (".*"),$/gm)].map(
      (match) => JSON.parse(match[1]!) as string,
    );
    expect(sources).toHaveLength(files.length);
    for (const source of sources) {
      const result = checkSource(source, { limits: CLI_LIMITS });
      expect(result.diagnostics.map((d) => d.message)).toEqual([]);
    }
  });

  it('names a default example that exists', () => {
    const match = /export const DEFAULT_EXAMPLE_ID = "([^"]+)";/.exec(generated);
    expect(match).not.toBeNull();
    expect(generated).toContain(`id: ${JSON.stringify(match![1])}`);
  });
});
