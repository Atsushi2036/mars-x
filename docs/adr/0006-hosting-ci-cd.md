# ADR-0006: Hosting, CI/CD and repository workflow

- Status: Accepted (2026-11-14, hosting and push policy chosen by the team lead)
- Deciders: devops-senior, security-senior, team lead

## Decision
- **Cloudflare Pages** for the static app and the processed dataset (files < 25 MiB each; immutable caching for hashed assets; `_headers` for security headers).
- Monorepo with pnpm workspaces (`apps/explorer`, `packages/*`) + `python/` (uv) + `justfile` automating data → training → build → deploy.
- GitHub Actions: parallel jobs (web, python, security), least-privilege tokens, actions pinned by SHA; preview deploys allowed; **production deploys only with explicit approval**.
- Repository policy for the hackathon: agents push directly to `main` with small commits, path ownership per agent and `pull --rebase` (no force pushes).
- Processed dataset is not committed; distributed as a versioned, SHA-256-checked artefact.

## Alternatives discarded
- Vercel Hobby (non-commercial clause, 100 MB CLI upload) — plan B.
- GitHub Pages (no custom headers), Netlify free (bandwidth cap).
- Git LFS for data (quota, slow clones).
