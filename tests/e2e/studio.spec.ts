import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests for the studio.
 *
 * These check that the *real* compiler and simulator are wired into the UI, not
 * that some mock renders: every assertion here is about a number the engine
 * produced. A Bell state showing anything other than 00 and 11 would fail.
 */

/** Wait for Monaco to be interactive; it loads in its own chunk. */
async function waitForEditor(page: Page) {
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 60_000 });
}

/**
 * Replace the editor contents with `source`.
 *
 * Driving this through Monaco's model rather than simulated keystrokes is both
 * faster and more faithful: `setValue` fires the same change event a human
 * typing would, so React's state and the compiler still run for real, while
 * avoiding auto-closing brackets and auto-indent mangling the program on the
 * way in.
 */
async function setSource(page: Page, source: string) {
  await waitForEditor(page);
  await page.waitForFunction(() => Boolean((window as never as { monaco?: unknown }).monaco));
  await page.evaluate((text) => {
    const monaco = (
      window as never as {
        monaco: { editor: { getModels(): Array<{ setValue(v: string): void }> } };
      }
    ).monaco;
    monaco.editor.getModels()[0]!.setValue(text);
  }, source);
  // The studio debounces compilation by 160 ms.
  await page.waitForTimeout(400);
}

/** The results panel, so basis-state labels in the editor's comments do not match. */
const results = (page: Page) => page.getByTestId('panel-results');

/** True when the layout has collapsed to the tabbed single-column form. */
async function isNarrow(page: Page): Promise<boolean> {
  return page.getByRole('tab', { name: /^Code/ }).isVisible();
}

/**
 * Switch to a workspace section when the layout is narrow; a no-op when the
 * panels are all on screen at once.
 *
 * Matched by prefix rather than exactly: the Code tab grows an error-count
 * badge, so its accessible name becomes "Code 1" as soon as a program fails to
 * compile.
 */
async function openSection(page: Page, name: string) {
  if (await isNarrow(page)) {
    await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads with the Bell example and compiles it', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /QForge/ })).toBeVisible();
  await expect(page.locator('#qf-example')).toHaveValue('bell');
  await expect(
    page.getByTestId('panel-source').getByText('compiles', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No diagnostics. The program compiles.')).toBeVisible();
});

test('renders the circuit from the compiled IR', async ({ page }) => {
  await openSection(page, 'Circuit');
  const diagram = page.getByRole('img', { name: /Circuit with 2 qubits/ });
  await expect(diagram).toBeVisible();
  await expect(diagram).toHaveAttribute('aria-label', /4 instructions and depth 3/);
  // `exact` matters: the SVG's accessible <title> also contains "depth 3".
  await expect(
    page.getByTestId('panel-circuit').getByText('depth 3', { exact: true }),
  ).toBeVisible();
});

test('running a Bell state yields only the 00 and 11 outcomes', async ({ page }) => {
  await openSection(page, 'Results');
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'Counts' }).click();

  const table = page.getByRole('table').filter({ has: page.getByText('Register') });
  await expect(table.getByRole('row')).toHaveCount(3); // header + 00 + 11
  await expect(table.getByText('00', { exact: true })).toBeVisible();
  await expect(table.getByText('11', { exact: true })).toBeVisible();
  await expect(table.getByText('01', { exact: true })).toHaveCount(0);
  await expect(table.getByText('10', { exact: true })).toHaveCount(0);
});

test('a fixed seed makes the run reproducible', async ({ page }) => {
  await openSection(page, 'Results');
  const readCounts = async () => {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await openSection(page, 'Results');
    await page.getByRole('tab', { name: 'Counts' }).click();
    return page
      .getByRole('table')
      .filter({ has: page.getByText('Register') })
      .innerText();
  };

  const first = await readCounts();
  await page.getByRole('button', { name: 'Reset' }).click();
  const second = await readCounts();
  expect(second).toBe(first);
});

test('stepping shows the state evolving gate by gate', async ({ page }) => {
  await openSection(page, 'Debug');
  const step = page.getByRole('button', { name: 'Step', exact: true });

  // Before anything runs: all probability on |00>.
  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'State' }).click();
  await expect(results(page).getByText('|00>')).toBeVisible();
  await expect(results(page).getByText('100.00%')).toBeVisible();

  // After H: an equal superposition of |00> and |01>.
  await openSection(page, 'Debug');
  await step.click();
  await openSection(page, 'Results');
  await expect(results(page).getByText('|01>')).toBeVisible();
  await expect(results(page).getByText('50.00%').first()).toBeVisible();

  // After CX: the Bell state, so |01> is gone and |11> has appeared.
  await openSection(page, 'Debug');
  await step.click();
  await openSection(page, 'Results');
  await expect(results(page).getByText('|11>')).toBeVisible();
  // |01> has zero amplitude after the CX, so the row disappears entirely.
  await expect(results(page).getByText('|01>')).toHaveCount(0);
});

test('stepping backwards restores the earlier state', async ({ page }) => {
  await openSection(page, 'Debug');
  const step = page.getByRole('button', { name: 'Step', exact: true });
  const back = page.getByRole('button', { name: 'Step back' });

  await expect(back).toBeDisabled();
  await step.click();
  await step.click();
  await expect(page.getByText('step 2 of 4')).toBeVisible();

  await back.click();
  await expect(page.getByText('step 1 of 4')).toBeVisible();
  await openSection(page, 'Results');
  // Back at the post-Hadamard state, which has |01> in it.
  await expect(results(page).getByText('|01>')).toBeVisible();
});

test('a measurement step reports probabilities and the sampled outcome separately', async ({
  page,
}) => {
  await openSection(page, 'Debug');
  await page.getByRole('button', { name: 'To end' }).click();

  const debuggerPanel = page.getByTestId('panel-debugger');
  await expect(debuggerPanel.getByText('measure alice -> resultA')).toBeVisible();
  await expect(debuggerPanel.getByText('before: P(0) = 50.00%, P(1) = 50.00%')).toBeVisible();
  await expect(debuggerPanel.getByText('state collapsed').first()).toBeVisible();
});

test('compiler inspector exposes every stage', async ({ page }) => {
  await openSection(page, 'Compiler');

  const panel = page.getByTestId('panel-compiler');

  await page.getByRole('tab', { name: /Tokens/ }).click();
  await expect(panel.getByText('"alice"').first()).toBeVisible();

  await page.getByRole('tab', { name: 'AST' }).click();
  await expect(panel.getByText('"kind": "GateApplication"').first()).toBeVisible();

  await page.getByRole('tab', { name: /^IR/ }).click();
  await expect(panel.getByText('%0, %1').first()).toBeVisible();

  await page.getByRole('tab', { name: 'OpenQASM 3' }).click();
  const compiler = page.getByTestId('panel-compiler');
  await expect(compiler.getByText('OPENQASM 3.0;')).toBeVisible();
  await expect(compiler.getByText('cx alice, bob;')).toBeVisible();
});

test('optimisation is off by default and reports its work when enabled', async ({ page }) => {
  await page.locator('#qf-example').selectOption('optimisable');
  await openSection(page, 'Compiler');

  await page.getByRole('tab', { name: 'Passes' }).click();
  await expect(page.getByText('Optimisation is off')).toBeVisible();

  await openSection(page, 'Circuit');
  await page.getByRole('checkbox', { name: 'Optimise' }).check();

  await openSection(page, 'Compiler');
  await page.getByRole('tab', { name: 'Passes' }).click();
  const compiler = page.getByTestId('panel-compiler');
  await expect(compiler.getByText(/instructions 14 -> 6/)).toBeVisible();
  await expect(compiler.getByText(/cancel-self-inverse/).first()).toBeVisible();
});

test('a program with errors shows diagnostics and hides the circuit', async ({ page }) => {
  await setSource(page, 'qubit control;\nbit c;\n\ncx control, target;\n');

  await openSection(page, 'Code');
  const diagnostics = page.getByTestId('panel-diagnostics');
  await expect(diagnostics.getByText('QF202')).toBeVisible();
  await expect(diagnostics.getByText("Unknown qubit 'target'")).toBeVisible();
  await expect(
    page.getByTestId('panel-source').getByText('1 error', { exact: true }),
  ).toBeVisible();

  await openSection(page, 'Circuit');
  await expect(
    page
      .getByTestId('panel-circuit')
      .getByText('The circuit appears once the program compiles.'),
  ).toBeVisible();
});

test('clicking a diagnostic moves the editor caret to it', async ({ page }) => {
  await setSource(page, 'qubit a;\n\n\n\n\nh nope;\n');
  await openSection(page, 'Code');

  await page.getByTestId('panel-diagnostics').getByText("Unknown qubit 'nope'").click();

  // The observable behaviour is that the caret lands on the offending token,
  // which is on line 6, column 3 ("nope" in "h nope;").
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (
          window as never as {
            monaco: {
              editor: {
                getEditors(): Array<{
                  getPosition(): { lineNumber: number; column: number } | null;
                }>;
              };
            };
          }
        ).monaco;
        const position = monaco.editor.getEditors()[0]?.getPosition();
        return position ? `${position.lineNumber}:${position.column}` : 'none';
      }),
    )
    .toBe('6:3');
});

test('every example loads and compiles', async ({ page }) => {
  const options = await page
    .locator('#qf-example option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  expect(options.length).toBeGreaterThanOrEqual(12);

  for (const value of options) {
    await page.locator('#qf-example').selectOption(value);
    await openSection(page, 'Code');
    await expect(
      page.getByTestId('panel-source').getByText('compiles', { exact: true }),
      `example ${value} should compile`,
    ).toBeVisible();
  }
});

test('the format button rewrites messy source', async ({ page }) => {
  await setSource(page, 'qubit    a;qubit b;h   a;cx a,b;');
  await openSection(page, 'Code');
  await page.getByRole('button', { name: 'Format' }).click();
  const formatted = await page.evaluate(() => {
    const monaco = (
      window as never as {
        monaco: { editor: { getModels(): Array<{ getValue(): string }> } };
      }
    ).monaco;
    return monaco.editor.getModels()[0]!.getValue();
  });
  // Normalise the line ending: Monaco picks the model's EOL per platform, and
  // the formatter's contract is about spacing and statement breaks, not CRLF.
  expect(formatted.replace(/\r\n/g, '\n')).toBe('qubit a;\nqubit b;\nh a;\ncx a, b;\n');

  // The status line lives in the execution panel, which the narrow layout puts
  // on a different tab from the editor.
  await openSection(page, 'Circuit');
  await expect(page.getByTestId('panel-execution').getByText('Formatted.')).toBeVisible();
});

test('the page has no horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('tabs are operable with the keyboard', async ({ page }) => {
  await openSection(page, 'Results');
  await openSection(page, 'Results');

  const state = page.getByRole('tab', { name: 'State' });
  await state.focus();
  await expect(state).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Probabilities' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Stats' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Bloch panel reports both Bell qubits as maximally mixed', async ({ page }) => {
  await openSection(page, 'Debug');
  await page.getByRole('button', { name: 'To end' }).click();
  await page.getByRole('button', { name: 'Step back' }).click();
  await page.getByRole('button', { name: 'Step back' }).click();

  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'Bloch' }).click();
  await expect(results(page).getByText('maximally mixed (entangled)').first()).toBeVisible();
});

test('no console errors on load or after a run', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await waitForEditor(page);
  await openSection(page, 'Results');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForTimeout(800);

  expect(errors).toEqual([]);
});
