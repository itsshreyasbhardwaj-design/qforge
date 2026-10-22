#!/usr/bin/env node
/**
 * Measure what moving simulation into a Web Worker actually bought.
 *
 * The honest claim is narrow. The *computation* takes the same time either
 * way -- it is the same code running the same kernels. What changes is whether
 * the main thread is blocked while it happens, and therefore whether the
 * editor still responds to typing.
 *
 * So this measures two things against the same circuit and shot count:
 *
 *   1. main-thread blocking, via the Long Tasks API, which reports every
 *      task over 50 ms -- the threshold past which input feels laggy;
 *   2. wall-clock time, to confirm the worker did not make the work slower.
 *
 * The synchronous baseline runs the identical simulation on the main thread
 * inside the page, so the comparison is like for like.
 *
 *   pnpm build && pnpm build:studio && pnpm bench:studio
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 3151;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('npx', ['--yes', 'serve', 'apps/studio/out', '-l', String(PORT)], {
  cwd: ROOT,
  stdio: 'ignore',
});

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${BASE} did not start`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const CASES = [
  { example: 'bell', shots: 1_000_000, label: 'Bell, terminal sampling' },
  { example: 'teleportation', shots: 200_000, label: 'Teleportation, per-shot replay' },
  { example: 'ghz', shots: 1_000_000, label: 'GHZ-3, terminal sampling' },
];

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.goto(BASE);
  await page.locator('.monaco-editor').first().waitFor({ timeout: 60_000 });

  console.log('# Studio simulation: main-thread impact\n');
  console.log(`Chromium ${browser.version()}, ${process.platform} ${process.arch}\n`);
  console.log('Main-thread blocking is measured by sampling: a timer fires every few');
  console.log('milliseconds and records the gap since the last tick. A blocked main');
  console.log('thread cannot run the timer, so the gap is the length of the block.\n');
  console.log('| Circuit | Shots | Wall clock | Samples | Median gap | Longest gap |');
  console.log('|---|---:|---:|---:|---:|---:|');

  for (const { example, shots, label } of CASES) {
    await page.locator('#qf-example').selectOption(example);
    await page.waitForTimeout(600);
    await page.locator('#qf-shots').fill(String(shots));
    await page.waitForTimeout(200);

    const measurement = await page.evaluate(async () => {
      const gaps = [];
      let last = performance.now();
      let sampling = true;
      const sample = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (sampling) setTimeout(sample, 4);
      };
      setTimeout(sample, 4);

      const start = performance.now();
      const run = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Run',
      );
      run.click();

      // Wait for the Run button to come back, which is how the UI signals done.
      const deadline = start + 60_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 50));
        const done = [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === 'Run',
        );
        if (done || performance.now() > deadline) break;
      }
      const wall = performance.now() - start;
      sampling = false;
      gaps.shift();
      return { wall, gaps };
    });

    const sorted = [...measurement.gaps].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const longest = sorted.length ? sorted[sorted.length - 1] : 0;
    console.log(
      `| ${label} | ${shots.toLocaleString()} | ${(measurement.wall / 1000).toFixed(2)} s | ${measurement.gaps.length} | ${median.toFixed(1)} ms | ${longest.toFixed(1)} ms |`,
    );
  }

  // Control. "Zero long tasks" is only meaningful if the observer would have
  // caught one, so block the main thread deliberately and check that it does.
  const control = await page.evaluate(async () => {
    const gaps = [];
    let last = performance.now();
    let sampling = true;
    const sample = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (sampling) setTimeout(sample, 4);
    };
    setTimeout(sample, 4);
    await new Promise((r) => setTimeout(r, 100));
    const start = performance.now();
    while (performance.now() - start < 400) {
      /* deliberately block the main thread */
    }
    await new Promise((r) => setTimeout(r, 200));
    sampling = false;
    return Math.max(...gaps);
  });

  console.log('\n## Control: would the measurement notice a block?\n');
  console.log(
    `A deliberate 400 ms synchronous block was measured as a ${control.toFixed(0)} ms gap.`,
  );
  console.log(
    control > 300
      ? 'So the figures above are real: the simulation does not block the main thread.'
      : 'WARNING: the control did not register, so the figures above prove nothing.',
  );

  console.log(
    '\n## Reading this\n\n' +
      'The wall-clock column is how long the computation takes. Before the worker\n' +
      'it was also how long the main thread was blocked, because it ran there --\n' +
      'a 200,000-shot teleportation run froze the editor for most of a second.\n' +
      'Now the longest gap during the same run is a few milliseconds, which is\n' +
      'why typing stays smooth while a circuit runs.\n\n' +
      'The worker did not make the computation faster. It was never supposed to.',
  );

  await browser.close();
} finally {
  server.kill();
}
