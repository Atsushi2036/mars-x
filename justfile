# MARS-X task runner.
# Install just: `winget install Casey.Just` (Windows), `brew install just` (macOS), `cargo install just`.
# Every recipe wraps pnpm/uv/node, so `pnpm run <name>` also works without just.
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

region := "jezero-v1"

default:
    @just --list

# Install JS (pnpm, frozen lockfile) and Python (uv, locked) dependencies
setup:
    pnpm install --frozen-lockfile
    uv sync --project python --locked

# Build the processed dataset (DEM, ortho, layers) from public USGS data into data/processed
data:
    uv run --project python python -m marsx.pipeline build --region {{region}}

# Train/benchmark the reference RL agent (module owned by the AI engineer; adjust when it lands)
train:
    uv run --project python python -m marsx.intelligence.train --region {{region}}

# Python (pytest) + web (vitest) tests
test:
    uv run --project python pytest
    pnpm -r --if-present test

# Build the web app, then copy data/processed/<region> into dist/data/<region> (checks < 25 MiB per file)
build:
    pnpm --filter "./apps/*" --if-present build
    node scripts/copy-data.mjs {{region}}

# End-to-end tests (Playwright), if defined by the app
e2e:
    pnpm --filter "./apps/*" --if-present e2e

# Download the released dataset (GitHub Release asset, sha256 verified) into data/processed
fetch-data:
    node scripts/dataset.mjs fetch {{region}}

# Pack data/processed/<region> for a GitHub Release and print its sha256
pack-data:
    node scripts/dataset.mjs pack {{region}}

# Deploy dist to a Cloudflare Pages PREVIEW (branch "preview")
deploy-preview: build
    node scripts/deploy.mjs preview

# Deploy to PRODUCTION: typed confirmation, refuses in CI. Only with the owner's explicit approval.
deploy-prod: build
    node scripts/deploy.mjs prod

# Full local gate: lint, typecheck, tests, build
all:
    pnpm -r --if-present lint
    pnpm -r --if-present typecheck
    just test
    just build
