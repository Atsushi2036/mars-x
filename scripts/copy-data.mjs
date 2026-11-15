// Copies data/processed/<region> into apps/explorer/dist/data/<region> and enforces
// Cloudflare Pages limits (25 MiB per file, 20,000 files per deployment).
// Usage: node scripts/copy-data.mjs [region]   (default: jezero-v1)
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const region = process.argv[2] ?? "jezero-v1";
if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) {
  console.error(`Invalid region name: ${region}`);
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const src = join(root, "data", "processed", region);
const distDir = join(root, "apps", "explorer", "dist");
const dest = join(distDir, "data", region);
const MAX_FILE = 25 * 1024 * 1024; // 25 MiB
const MAX_FILES = 20000;

if (!existsSync(src)) {
  console.error(`Missing ${relative(root, src)}.\nRun "just data" (build it) or "just fetch-data" (download the released dataset).`);
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error("Missing apps/explorer/dist. Build the web app first (pnpm run build:web).");
  process.exit(1);
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

// Sources: processed dataset (includes export/*.zip), versioned reference models (models/<region>) and baseline
// scorecards (bench/<region>/baselines). MARSX_SKIP_EXPORT=1 leaves out data/<region>/export/ (large ZIPs).
const skipExport = process.env.MARSX_SKIP_EXPORT === "1";
const excludeExport = (p) => skipExport && relative(src, p).split(sep)[0] === "export";
const sources = [{ src, dest, filter: (p) => !excludeExport(p) }];
for (const [from, to, label] of [
  [join(root, "models", region), join(dest, "models"), "policy model files"],
  [join(root, "bench", region, "baselines"), join(dest, "baselines"), "baseline scorecards"],
]) {
  if (existsSync(from)) sources.push({ src: from, dest: to, filter: () => true });
  else console.warn(`WARNING: ${relative(root, from)} not found; ${label} will be missing from dist.`);
}
if (skipExport) console.warn("MARSX_SKIP_EXPORT=1: data/<region>/export/ is NOT copied.");

let total = 0;
let count = 0;
const tooBig = [];
for (const s of sources) {
  for (const f of walk(s.src)) {
    if (!s.filter(f)) continue;
    const size = statSync(f).size;
    total += size;
    count += 1;
    if (size >= MAX_FILE) tooBig.push(`${relative(root, f)} (${(size / 1048576).toFixed(1)} MiB)`);
  }
}
if (tooBig.length) {
  console.error(`Files over the 25 MiB Cloudflare Pages limit:\n  ${tooBig.join("\n  ")}\nSplit them into tiles in the pipeline.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const s of sources) cpSync(s.src, s.dest, { recursive: true, filter: s.filter });

let distFiles = 0;
for (const _ of walk(distDir)) distFiles += 1;
if (distFiles > MAX_FILES) {
  console.error(`dist has ${distFiles} files (limit ${MAX_FILES}).`);
  process.exit(1);
}
console.log(`Copied ${count} data files (${(total / 1048576).toFixed(1)} MiB) to ${relative(root, dest)}; dist total ${distFiles} files. All < 25 MiB.`);
