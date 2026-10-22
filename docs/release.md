# Release engineering

How a QForge release is cut, what must be true before one is, and the state of
deployment.

---

## 1. Pre-release verification

Every one of these must pass on a clean checkout. No step is optional, and
"it passed last time" is not a result.

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install --frozen-lockfile
pnpm build

pnpm typecheck        # tsc -b over the four core packages
pnpm lint             # eslint, zero warnings
pnpm format:check     # prettier, no drift
pnpm test             # vitest, all green
pnpm examples         # every examples/*.qf compiles, runs and matches @expect
pnpm test:e2e         # playwright, desktop + Pixel 7
pnpm bench            # benchmarks still run; update docs/benchmarks.md if the numbers moved
pnpm verify:numpy     # out-of-language cross-check
```

Then the Qiskit cross-validation, which needs its environment once:

```bash
pnpm --filter @qforge/validation setup
pnpm --filter @qforge/validation validate
```

If any figure quoted in `README.md`, `docs/benchmarks.md`,
`docs/validation-report.md`, `docs/technical-report.md` or
`docs/claim-verification.md` no longer matches what these commands print, the
document is wrong. Fix the document before tagging; a release that ships a
stale number has shipped a false claim.

## 2. Version and changelog

- All workspace packages share one version. Bump them together.
- `CHANGELOG.md` gets a dated entry under the new version before the tag, not
  after.
- The entry's **Fixed** section names what found each bug. A bug found by an
  independent tool is worth more to a reader than one found by a unit test, and
  the difference should be visible.

## 3. Tagging

```bash
git tag -a v0.2.0 -m "QForge 0.2.0"
git push origin main
git push origin v0.2.0
```

CI runs three jobs on push — build/lint/test, the NumPy cross-check, and
Playwright. A tag is not a release until all three are green on that commit.

The Qiskit cross-validation is a fourth job and does **not** run on every push,
because it needs a Python toolchain and about 90 MB of wheels. Trigger it for a
release either by dispatching the workflow manually or by putting `[validate]`
in the commit message.

The gate is `contains()`, which matches **anywhere** in the message — so
writing the token while merely describing it fires the job. The 0.2.0 release
commit did exactly that, which is how the Qiskit job came to run on the tag
without anyone dispatching it. Harmless, and left as it is: the failure mode
is a free 30-second job running when it did not need to.

**Pushing is a published action.** It is done when the repository owner asks
for it, not automatically at the end of a piece of work.

## 4. Deployment

**Status: not deployed. No hosting account has been connected, and no
deployment has been performed.**

The studio is a static export (`output: 'export'` in
`apps/studio/next.config.ts`), so it needs no server, no runtime, no
environment variables and no secrets. `pnpm --filter @qforge/studio build`
writes a directory of files that any static host can serve.

Two routes are produced:

| Route     | What it is                                   |
| --------- | -------------------------------------------- |
| `/`       | Landing page. Static, no client JavaScript   |
| `/studio` | The editor, compiler, simulator and debugger |

### Serving it locally

```bash
pnpm --filter @qforge/studio build
npx serve apps/studio/out -l 3147
```

This is exactly what the Playwright suite does, so a local serve is a faithful
preview of a deployed one.

### If it is deployed to Vercel

The settings, recorded so the decision does not have to be re-derived. **These
have not been applied.**

| Setting               | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Framework preset      | Next.js                                                   |
| Root directory        | `apps/studio`                                             |
| Install command       | `pnpm install --frozen-lockfile` (run from the repo root) |
| Build command         | `pnpm --filter @qforge/studio build`                      |
| Output directory      | `out`                                                     |
| Node version          | 24.x                                                      |
| Environment variables | none                                                      |

Things to check on a first deployment:

- `/studio` loads and Monaco appears. Monaco is bundled rather than fetched
  from a CDN, so a deployment behind a restrictive network should still work —
  worth confirming, because the opposite was true before it was bundled.
- The browser's network panel shows requests to the deployment's own origin
  only. No analytics, no telemetry, no CDN. This is a claim the README makes
  and a deployment is where it could silently stop being true.
- The 1,000,000-shot run still cancels, which exercises the worker.

### Free-hosting alternatives

Because the output is static, GitHub Pages, Cloudflare Pages and Netlify all
serve it with no change to the build. GitHub Pages needs a `basePath` in
`next.config.ts` if the site is served from a subpath rather than a domain
root; the others do not.

## 5. After a release

- Check the three push jobs on the tagged commit, and the Qiskit job, which
  has to be triggered (see §3).
- Re-read `docs/claim-verification.md` top to bottom against the released
  artefact. It is a list of claims; a release is the moment they become public.
- If a deployment exists, open it and run through §1 of
  [portfolio.md](portfolio.md) — the five-minute demo — against the deployed
  site rather than a local build.

## 6. Not published

- **npm.** Nothing is published. The package names are unverified and the
  `package.json` files are marked accordingly.
- **No release binaries.** The CLI runs from source via the workspace.
