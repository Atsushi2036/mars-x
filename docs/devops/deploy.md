# MARS-X deployment (Cloudflare Pages)

Static site, no backend, no database. Decision approved by the user: Cloudflare Pages, direct pushes to `main`.
Production deploys always need the user's explicit confirmation each time.

## Toolchain (versions pinned, all >= 7 days old on 2026-11-14)

| Tool | Version | Where pinned |
|---|---|---|
| Node | 24.22.2 (LTS "Krypton") | `.nvmrc`, CI uses `node-version-file` |
| pnpm | 10.34.9 | `package.json#packageManager` (corepack) |
| wrangler | 4.158.0 | root devDependency |
| just | any recent (optional) | see below |

`pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days) and an allowlist for install scripts.
Local PC note: the globally installed pnpm is 10.15.1 (older than `minimumReleaseAge` support). Use
`corepack pnpm ...` (no admin needed) or run `corepack enable` once in an admin shell.

## One-time setup by the user

```
! corepack pnpm exec wrangler login
```

This opens a browser to authorize Cloudflare (OAuth; no token is stored in the repo).
Create the Pages project once (needs `--force`, otherwise wrangler 4.158 delegates to Workers and tries to auto-configure and rewrite the repo; see ADR-0009).
Run it from any folder OUTSIDE the repo or from the root, never from `apps/explorer`:

```
corepack pnpm exec wrangler pages project create mars-x --production-branch=main --force
```

Done on 2026-11-14: project `mars-x`, production URL `https://mars-x-7k9.pages.dev`, previews at `https://preview.mars-x-7k9.pages.dev`.
Never accept wrangler's auto-configuration prompts. Override the name with env var `CF_PAGES_PROJECT` if needed.

Install `just` (optional; `pnpm run <script>` has an equivalent for every recipe):
`winget install Casey.Just` (Windows PowerShell), then reopen the terminal.

## Local flow

```
just setup            # pnpm install + uv sync (locked)
just data             # builds data/processed/jezero-v1 (long; needs network for USGS windows)
just test             # pytest + vitest
just build            # web build + copies data into dist/data/jezero-v1, fails if any file >= 25 MiB
just deploy-preview   # wrangler pages deploy -> branch "preview" (URL printed by wrangler)
just deploy-prod      # typed confirmation "deploy production"; refuses in CI/non-TTY. ONLY with user approval
```

Equivalent scripts: `pnpm run setup|data|test|build|e2e|deploy:preview|deploy:prod|all`.

## Data strategy

Processed data (~60-80 MB) is not in git (`data/raw/`, `data/processed/` ignored).

1. Local (hackathon path): `just deploy-preview` uploads `dist/` including `data/processed/jezero-v1` from this PC.
2. CI path: the dataset is a GitHub Release asset with a pinned sha256.
   - `just pack-data` creates `.dataset-cache/jezero-v1.tar.gz` and prints its sha256 plus the `gh release create` command.
     The release is created by the owner (not by agents).
   - Commit `data/dataset.lock.json`: `{"jezero-v1": {"url": "https://github.com/<owner>/mars-x/releases/download/data-jezero-v1/jezero-v1.tar.gz", "sha256": "<hex>"}}`.
   - `just fetch-data` (used by the manual preview workflow) downloads, verifies sha256 and extracts.

Cloudflare Pages limits enforced by `scripts/copy-data.mjs`: < 25 MiB per file, <= 20,000 files.

## CI (`.github/workflows/ci.yml`)

Jobs in parallel: `web` (lint, typecheck, vitest, build), `python` (ruff, pytest), `security` (pnpm audit high, pip-audit from `uv.lock`, gitleaks).
Steps are conditional on the app/python folder existing. `permissions: contents: read`, actions pinned by SHA, `persist-credentials: false`,
no `pull_request_target`. No production deploy in CI. `zizmor` reports no findings.
gitleaks runs as a pinned, checksum-verified binary (the official action requires a commercial license for organizations).

Optional `.github/workflows/deploy-preview.yml` (manual `workflow_dispatch`, preview branch only). The owner must create:
- secrets `CLOUDFLARE_API_TOKEN` (permission Account > Cloudflare Pages > Edit only) and `CLOUDFLARE_ACCOUNT_ID`;
- a GitHub environment named `preview`.
It also needs the dataset release above. Do not enable it before that.

## Headers

`apps/explorer/public/_headers`: CSP (enforced), HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP same-origin, no COEP.
Cache: `/assets/*` and `/data/*` immutable 1 year; `index.html`, `manifest.json`, `version.json` and `data/*/manifest.json` `no-cache`.
Changing a dataset in place requires a new folder name (`jezero-v2`). Verify after each deploy: `curl -sI <url>/ | grep -i -E "content-security|strict-transport|cross-origin"`.

## Rollback

Cloudflare Pages keeps every deployment: dashboard > Workers & Pages > mars-x > Deployments > "Rollback to this deployment".
