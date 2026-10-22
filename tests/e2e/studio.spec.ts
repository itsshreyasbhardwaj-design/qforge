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

/**
 * The editor's current contents.
 *
 * `window.monaco` is published by the loader, which resolves separately from
 * the editor becoming visible, so both have to be waited for.
 */
async function readSource(page: Page): Promise<string> {
  await waitForEditor(page);
  await page.waitForFunction(() => Boolean((window as never as { monaco?: unknown }).monaco));
  return page.evaluate(() => {
    const monaco = (
      window as never as { monaco: { editor: { getModels(): Array<{ getValue(): string }> } } }
    ).monaco;
    return monaco.editor.getModels()[0]!.getValue();
  });
}

/**
 * Load a bundled example and wait for it to compile.
 *
 * Selecting an example replaces the source, and compilation is debounced by
 * 160 ms. Acting before that lands drives the *outgoing* module, and the
 * recompile then resets execution — so a `To end` click can silently become a
 * no-op.
 */
async function selectExample(page: Page, name: string) {
  await page.locator('#qf-example').selectOption(name);
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
  await page.goto('/studio');
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
  await selectExample(page, 'optimisable');
  await openSection(page, 'Compiler');

  await page.getByRole('tab', { name: 'Optimiser' }).click();
  const compiler = page.getByTestId('panel-compiler');
  await expect(compiler.getByText('Optimisation is off')).toBeVisible();

  // The explorer offers to turn it on rather than sending the user hunting
  // for the checkbox on another panel.
  await compiler.getByRole('button', { name: 'Turn on optimisation' }).click();
  await page.waitForTimeout(400);

  await expect(compiler.getByText(/removed,.*rewritten/)).toBeVisible();
  await expect(compiler.getByText('cancel-self-inverse').first()).toBeVisible();
});

test('the optimisation explorer shows what each pass removed, and why', async ({ page }) => {
  await selectExample(page, 'optimisable');
  await openSection(page, 'Compiler');
  await page.getByRole('tab', { name: 'Optimiser' }).click();
  const compiler = page.getByTestId('panel-compiler');
  await compiler.getByRole('button', { name: 'Turn on optimisation' }).click();
  await page.waitForTimeout(400);

  // Before and after counts, computed rather than asserted in prose.
  await expect(compiler.getByText('instructions', { exact: true })).toBeVisible();
  await expect(compiler.getByText('rounds to fixpoint')).toBeVisible();

  // The honest caveat about gate counts must be on screen, not buried in docs.
  await expect(compiler.getByText(/Fewer gates is not automatically faster/)).toBeVisible();

  // Each pass's mathematical justification is available on demand.
  await compiler.getByRole('button', { name: /why each rewrite is valid/ }).click();
  await expect(compiler.getByText(/one-parameter group/)).toBeVisible();
  await expect(compiler.getByText(/global phase/).first()).toBeVisible();
});

test('the gate inspector explains a step from computed numbers', async ({ page }) => {
  await openSection(page, 'Debug');
  // Step onto the Hadamard.
  await page.getByRole('button', { name: 'Step', exact: true }).click();

  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'Gate' }).click();
  const results = page.getByTestId('panel-results');

  await expect(results.getByText('h on alice')).toBeVisible();
  // The 2x2 matrix is shown for a single-qubit gate.
  await expect(results.getByText('Matrix', { exact: true })).toBeVisible();
  await expect(results.getByText('0.7071 + 0.0000i').first()).toBeVisible();
  // ...and the computed observation about what changed.
  await expect(results.getByText(/basis state.*now/)).toBeVisible();
  await expect(
    results.getByText(/Every statement above is computed from the amplitudes/),
  ).toBeVisible();
});

test('clicking a gate in the circuit opens its explanation', async ({ page }) => {
  await openSection(page, 'Circuit');
  // The CX of the Bell example.
  await page
    .getByTestId('panel-circuit')
    .getByRole('button', { name: /cx on control alice, target bob/ })
    .click();

  await openSection(page, 'Results');
  const results = page.getByTestId('panel-results');
  await expect(results.getByText(/cx on alice, bob/)).toBeVisible();
  // After the CX both Bell qubits are maximally mixed, computed from their
  // reduced density matrices.
  await expect(results.getByText(/maximally mixed/).first()).toBeVisible();
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

test('teleportation renders a classical control bus', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Circuit');

  const diagram = page.getByRole('img', { name: /Circuit with 3 qubits/ });
  await expect(diagram).toBeVisible();
  // The classical wire only appears when something is predicated.
  await expect(
    page.getByTestId('panel-circuit').getByText('classical', { exact: true }),
  ).toBeVisible();
  // Each correction carries a visible label naming the predicate. `exact`
  // matters: the predicate also appears in the SVG's accessible description
  // and in each gate's tooltip, which is correct but matches loosely.
  await expect(
    page.getByTestId('panel-circuit').getByText('m1 == 1', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId('panel-circuit').getByText('m0 == 1', { exact: true }),
  ).toBeVisible();

  // ...and the accessible description names the predicate too, so a screen
  // reader is told which gates are conditional.
  await expect(diagram).toHaveAttribute('aria-label', /3 qubits/);
  const description = await page
    .getByTestId('panel-circuit')
    .locator('desc')
    .first()
    .textContent();
  expect(description).toContain('only when m1 == 1');
});

test('the debugger says whether each correction fired', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Debug');
  await page.getByRole('button', { name: 'To end' }).click();

  const debuggerPanel = page.getByTestId('panel-debugger');
  await expect(debuggerPanel.getByText('if m1 == 1')).toBeVisible();
  await expect(debuggerPanel.getByText('if m0 == 1')).toBeVisible();
  // Exactly one of the two outcomes is shown for each correction, spelled out
  // rather than only colour-coded.
  const ran = await debuggerPanel.getByText('held, so it ran').count();
  const skipped = await debuggerPanel.getByText('did not hold, so it was skipped').count();
  expect(ran + skipped).toBe(2);
});

test('teleportation delivers the input state to Bob', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Debug');
  await page.getByRole('button', { name: 'To end' }).click();

  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'Bloch' }).click();

  // The example prepares ry(2*pi/5) on msg, so Bob must end with
  // z = cos(2*pi/5) = 0.3090 and a pure state of his own.
  const bobRow = page.getByTestId('panel-results').getByRole('row').filter({ hasText: 'bob' });
  await expect(bobRow).toContainText('pure');
  await expect(bobRow).toContainText('0.3090');
});

test('a predicated circuit reports that it replays per shot', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Results');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await openSection(page, 'Results');
  await page.getByRole('tab', { name: 'Stats' }).click();
  await expect(
    page.getByTestId('panel-results').getByText('every shot is replayed'),
  ).toBeVisible();
});

test('generated OpenQASM contains the conditional corrections', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Compiler');
  await page.getByRole('tab', { name: 'OpenQASM 3' }).click();

  const compiler = page.getByTestId('panel-compiler');
  // `== true`, not `== 1`: OpenQASM 3 types a single `bit` as a bit, so
  // comparing it to an integer is a type error. See docs/validation-report.md.
  await expect(compiler.getByText('if (m1 == true) { x bob; }')).toBeVisible();
  await expect(compiler.getByText('if (m0 == true) { z bob; }')).toBeVisible();
});

test('simulation runs off the main thread', async ({ page }) => {
  await openSection(page, 'Results');
  await page.locator('#qf-shots').fill('1000000');

  // Block the main thread deliberately while the run is in flight. If the
  // simulation were running here too, it could make no progress at all.
  const progressed = await page.evaluate(async () => {
    const run = [...document.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === 'Run',
    ) as HTMLButtonElement;
    run.click();

    const start = performance.now();
    while (performance.now() - start < 150) {
      /* hold the main thread */
    }

    const bar = document.querySelector('[role="progressbar"]');
    const done = [...document.querySelectorAll('button')].some(
      (b) => b.textContent!.trim() === 'Run',
    );
    return { sawProgressOrFinished: Boolean(bar) || done };
  });

  expect(progressed.sawProgressOrFinished).toBe(true);
});

test('a long run can be cancelled', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Results');
  await page.locator('#qf-shots').fill('1000000');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const cancel = page.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await cancel.click();

  await expect(page.getByTestId('panel-execution').getByText(/Cancelled after/)).toBeVisible();
  // The controls come back, so the UI is usable again rather than stuck.
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
});

test('a superseded run does not overwrite a newer one', async ({ page }) => {
  await openSection(page, 'Results');

  // Start a large run, then immediately start a small one with a different
  // seed. The large one finishes later; its result must be discarded.
  await page.locator('#qf-shots').fill('1000000');
  await page.locator('#qf-seed').fill('1');
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await page.locator('#qf-shots').fill('64');
  await page.locator('#qf-seed').fill('2');
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await page.waitForTimeout(2500);
  // Whatever is displayed must be the *newest* request: 64 shots, seed 2.
  await expect(
    page.getByTestId('panel-execution').getByText(/64 shots · seed 2/),
  ).toBeVisible();
});

test('the progress bar is announced to assistive technology', async ({ page }) => {
  await selectExample(page, 'teleportation');
  await openSection(page, 'Results');
  await page.locator('#qf-shots').fill('1000000');
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  const bar = page.getByRole('progressbar', { name: 'Simulation progress' });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuemax', '1000000');
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('no console errors on load or after a run', async ({ page }) => {
  // `beforeEach` has already loaded the studio. Park on a blank page before
  // attaching the listeners, so that this test's own navigation does not abort
  // that load's in-flight chunk requests: Firefox reports such an abort as
  // NS_BINDING_ABORTED and WebKit as "Load failed", both on the console, while
  // Chromium stays silent. Those are artefacts of navigating twice, not of the
  // application — a single clean load logs nothing on any of the three.
  await page.goto('about:blank');

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/studio');
  await waitForEditor(page);
  await openSection(page, 'Results');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.waitForTimeout(800);

  expect(errors).toEqual([]);
});

/** The guided-walkthrough panel. */
const lessons = (page: Page) => page.getByTestId('panel-lessons');

/**
 * Open the walkthrough panel and start the named lesson.
 *
 * The panel is pinned outside the tab strip, so it stays on screen while a
 * lesson step switches to the panel it is talking about.
 */
async function startLesson(page: Page, title: string) {
  await waitForEditor(page);
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await lessons(page)
    .getByRole('button', { name: new RegExp(`^${title}`) })
    .click();
}

/** Advance the open walkthrough by `times` steps. */
async function lessonNext(page: Page, times = 1) {
  for (let i = 0; i < times; i++) {
    await lessons(page).getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(300);
  }
}

test('a walkthrough loads its program and drives the debugger', async ({ page }) => {
  await startLesson(page, 'Entanglement');

  // The lesson's first action replaces the editor contents for real. Its step
  // has also just opened the Results tab, which on a narrow layout unmounts the
  // editor, so bring it back before reading it.
  await openSection(page, 'Code');
  expect(await readSource(page)).toContain('cx alice, bob');

  // Step 1 claims both qubits are pure. Check it against the panel.
  await openSection(page, 'Results');
  await expect(results(page).getByText('pure', { exact: true })).toHaveCount(2);

  // Steps 2 and 3: after cx, the lesson claims both Bloch vectors collapse.
  await lessonNext(page, 2);
  await expect(lessons(page).getByText('Entangle them')).toBeVisible();

  await openSection(page, 'Results');
  await expect(results(page).getByText('maximally mixed (entangled)')).toHaveCount(2);
});

test('the entanglement walkthrough ends with only two measured outcomes', async ({ page }) => {
  await startLesson(page, 'Entanglement');
  await lessonNext(page, 4);

  await openSection(page, 'Results');
  const keys = results(page).locator('tbody tr td:first-child');
  await expect(keys).toHaveCount(2, { timeout: 20_000 });
  expect((await keys.allInnerTexts()).sort()).toEqual(['00', '11']);
});

test('the teleportation walkthrough leaves Bob holding the prepared state', async ({
  page,
}) => {
  await startLesson(page, 'Teleportation');
  // Through the Bell pair, Alice's measurement and the classical corrections.
  await lessonNext(page, 4);

  await expect(lessons(page).getByText('Bob has the state')).toBeVisible();

  // ry(2*pi/5) prepares z = cos(2*pi/5) = 0.3090. If a correction had been
  // skipped or misapplied, bob would be somewhere else entirely.
  await openSection(page, 'Results');
  const bob = results(page).locator('tbody tr').filter({ hasText: 'bob' });
  await expect(bob).toContainText('0.3090');
  await expect(bob).toContainText('pure');
});

test('the walkthrough panel can be opened and closed', async ({ page }) => {
  await waitForEditor(page);
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(lessons(page).getByText('Guided walkthroughs')).toBeVisible();

  await lessons(page).getByRole('button', { name: 'Back to the editor' }).click();
  await expect(page.getByTestId('panel-lessons')).toHaveCount(0);
  await expect(page.getByTestId('panel-diagnostics')).toBeVisible();
});

test('the landing page describes the project and links to the studio', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'QForge', exact: true })).toBeVisible();

  // The limitations are on the page itself, not only behind a link: a reader
  // who never clicks through should still learn what it cannot do.
  await expect(page.getByText('It does not', { exact: true })).toBeVisible();
  await expect(page.getByText(/No noise model/)).toBeVisible();

  // The AI-assistance disclosure is on the landing page, not buried in a doc.
  await expect(page.getByText(/Built with AI assistance/)).toBeVisible();

  await page.getByRole('link', { name: 'Open the studio' }).click();
  await waitForEditor(page);
  await expect(page.locator('#qf-example')).toHaveValue('bell');
});
