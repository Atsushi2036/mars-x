// Versioned dataset as a GitHub Release asset (processed data is NOT in git).
//   node scripts/dataset.mjs pack  [region]  -> .dataset-cache/<region>.tar.gz + sha256 (prints the release command)
//   node scripts/dataset.mjs fetch [region]  -> downloads the asset listed in data/dataset.lock.json, verifies sha256, extracts to data/processed
// data/dataset.lock.json (committed): { "<region>": { "url": "https://github.com/.../<file>.tar.gz", "sha256": "<hex>" } }
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";

const [cmd, region = "jezero-v1"] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) {
  console.error("Invalid region");
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".dataset-cache");
const archive = join(cache, `${region}.tar.gz`);

const sha256 = (file) =>
  new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => res(h.digest("hex")))
      .on("error", rej);
  });
const tar = (args) => {
  const r = spawnSync("tar", args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("tar failed");
    process.exit(1);
  }
};

if (cmd === "pack") {
  const dir = join(root, "data", "processed", region);
  if (!existsSync(dir)) {
    console.error(`Missing data/processed/${region}`);
    process.exit(1);
  }
  mkdirSync(cache, { recursive: true });
  tar(["-czf", archive, "-C", join(root, "data", "processed"), region]);
  const hash = await sha256(archive);
  console.log(`\nArchive: ${archive}\nsha256 : ${hash}\n`);
  console.log("Publish it (needs the owner's explicit authorization; this script does NOT do it):");
  console.log(`  gh release create data-${region} "${archive}" --title "Dataset ${region}" --notes "sha256 ${hash}"`);
  console.log(`Then add to data/dataset.lock.json:\n  "${region}": { "url": "https://github.com/<owner>/mars-x/releases/download/data-${region}/${region}.tar.gz", "sha256": "${hash}" }`);
} else if (cmd === "fetch") {
  const lockPath = join(root, "data", "dataset.lock.json");
  if (!existsSync(lockPath)) {
    console.error("data/dataset.lock.json not found (no dataset release published yet).");
    process.exit(1);
  }
  const entry = JSON.parse(readFileSync(lockPath, "utf8"))[region];
  if (!entry?.url?.startsWith("https://github.com/") || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
    console.error(`No valid lock entry for ${region} (need an https://github.com/ url and sha256).`);
    process.exit(1);
  }
  mkdirSync(cache, { recursive: true });
  const res = await fetch(entry.url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) {
    console.error(`Download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const got = await sha256(archive);
  if (got !== entry.sha256) {
    console.error(`sha256 mismatch!\n expected ${entry.sha256}\n got      ${got}`);
    process.exit(1);
  }
  mkdirSync(join(root, "data", "processed"), { recursive: true });
  tar(["-xzf", archive, "-C", join(root, "data", "processed")]);
  console.log(`Dataset ${region} verified and extracted to data/processed/${region}`);
} else {
  console.error("Usage: node scripts/dataset.mjs <pack|fetch> [region]");
  process.exit(2);
}
