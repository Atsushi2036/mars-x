# ADR-0009: Keep Cloudflare Pages (Direct Upload), bypass wrangler's Workers delegation with `--force`

- Status: Accepted (2026-11-14, approved by the orchestrator within the hosting decision taken by the team lead)
- Modifies: [ADR-0006](0006-hosting-ci-cd.md) (hosting mechanics only; the hosting choice stays Cloudflare Pages)
- Deciders: devops-senior, team lead

## Context
With wrangler 4.158.0, `wrangler pages project create` / `pages deploy` first try to "delegate to the latest version of Cloudflare Pages, now part of Cloudflare Workers".
In a workspace this runs framework auto-configuration (creates a Worker, installs `@cloudflare/vite-plugin`, writes `wrangler.jsonc`, edits `package.json`, runs `npm install`),
which is unacceptable for this repo (pnpm lockfile, supply-chain policy). Run from the workspace root it aborts; run from `apps/explorer` it started rewriting the project.

## Findings (verified 2026-11-14)
- The delegation notice itself documents the escape hatch: `--force` creates the project directly on Cloudflare Pages. It is needed only for creation; once the project exists, `pages deploy` runs against Pages with no delegation.
- Verified: `wrangler pages project create mars-x --production-branch=main --force` created project `mars-x` (production URL `https://mars-x-7k9.pages.dev`);
  `wrangler pages deploy <dist> --project-name=mars-x --branch=preview` then uploaded a preview without delegation, run from the repo root. `_headers` was honored (see Evidence).
- Auto-configuration did not modify files, but a stray `npm install` touched `node_modules/.pnpm`; `corepack pnpm install --frozen-lockfile` was re-run and is healthy.

## Alternatives
| Option | Pros | Cons |
|---|---|---|
| A. Pages Direct Upload + `--force` once (chosen) | Zero repo changes; no config files; branch aliases give safe previews (`preview.<project>.pages.dev`) without touching production; `_headers` and 25 MiB/file already designed around; production = only the `main` branch deploy | Relies on a legacy-compat flag; Cloudflare is steering Pages users to Workers, so the flag may disappear in a future wrangler (pin wrangler 4.158.0) |
| B. Workers Static Assets (`wrangler.jsonc` with `assets.directory`) | Strategic Cloudflare direction; `_headers` supported; similar per-file limit (25 MiB) | New config file; the first `wrangler deploy` IS production on workers.dev (no branch-alias safety net); previews need `wrangler versions upload` + preview URLs setup; rewrites ADR-0006 mechanics and the CSP/cache rules need re-verification; more risk 24 h before the deadline |
| C. Pages Git integration (Cloudflare builds from GitHub) | No local wrangler | Cloudflare would need to build the Python-fed dataset (not in git); extra account/GitHub app permissions; slower iteration |

## Decision
Option A. Project creation is a one-time, user-authorized step. Production is still only `main` and only through `just deploy-prod` (typed confirmation, never in CI). If `--force` is ever removed, fall back to B in a new ADR.

## Consequences
- `scripts/deploy.mjs` never passes `--force` (project already exists); docs show `--force` for creation only.
- Do NOT run `wrangler pages ...` inside `apps/explorer` or without `--force` for creation; never accept the auto-configuration prompt.
- wrangler stays pinned at 4.158.0 (4.162.0 is newer than 7 days at decision time).

## Evidence
Preview deployed with a placeholder dist: `https://preview.mars-x-7k9.pages.dev` returned the CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP same-origin, no COEP;
`/assets/*` and `/data/x/h.bin` immutable 1 year; `/` and `/data/x/manifest.json` `no-cache`. Production URL `https://mars-x-7k9.pages.dev/` still 404 (nothing published). First TLS handshake on the preview alias took about 1 to 2 minutes after creation.
