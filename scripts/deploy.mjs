// Deploys apps/explorer/dist to Cloudflare Pages (project "mars-x") with wrangler.
//   node scripts/deploy.mjs preview   -> branch "preview" (public preview URL)
//   node scripts/deploy.mjs prod      -> production branch "main"; asks for typed confirmation
// Production is refused in CI and in non-interactive shells.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const target = process.argv[2];
const PROJECT = process.env.CF_PAGES_PROJECT ?? "mars-x";
const root = resolve(import.meta.dirname, "..");
const dist = process.env.MARSX_DIST ? resolve(process.env.MARSX_DIST) : join(root, "apps", "explorer", "dist"); // MARSX_DIST: override for testing

if (!["preview", "prod"].includes(target)) {
  console.error("Usage: node scripts/deploy.mjs <preview|prod>");
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(PROJECT)) {
  console.error("Invalid CF_PAGES_PROJECT");
  process.exit(2);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("apps/explorer/dist/index.html not found. Run `just build` first.");
  process.exit(1);
}
if (!existsSync(join(dist, "data"))) {
  console.warn("WARNING: dist/data is missing; the app will have no terrain data. Run `just build` with data present.");
}

let branch = "preview";
if (target === "prod") {
  if (process.env.CI || !process.stdin.isTTY) {
    console.error("Refusing to deploy to PRODUCTION from CI or a non-interactive shell.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`You are about to deploy to PRODUCTION (project "${PROJECT}", branch main).\nType "deploy production" to continue: `);
  rl.close();
  if (answer.trim() !== "deploy production") {
    console.error("Aborted.");
    process.exit(1);
  }
  branch = "main";
}

const r = spawnSync(
  "pnpm",
  ["exec", "wrangler", "pages", "deploy", dist, `--project-name=${PROJECT}`, `--branch=${branch}`, "--commit-dirty=true"],
  // No --force here: the Pages project must already exist (see docs/devops/deploy.md and ADR-0009).
  { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
