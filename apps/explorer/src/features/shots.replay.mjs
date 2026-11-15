import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Screenshot scenarios for the replay scorecard and the export panel (frontend #4).
 * Default run: the real L1 A* fixture of the repo. Set MARSX_RUNS_DIR to a folder with <L1|L2|L3>.run.json files
 * (e.g. real PPO runs with failures) to capture richer states.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = path.resolve(here, '../../.shots/features/tmp')
const FIXTURE = path.resolve(here, '../../../../packages/schemas/examples/run.real-l1-astar.json')
const RUNS = process.env.MARSX_RUNS_DIR

function prepared(name, tamper) {
  const src = RUNS && fs.existsSync(path.join(RUNS, `${name}.run.json`)) ? path.join(RUNS, `${name}.run.json`) : FIXTURE
  if (!tamper) return src
  fs.mkdirSync(tmp, { recursive: true })
  const out = path.join(tmp, `${name}-tampered.run.json`)
  fs.writeFileSync(out, tamper(fs.readFileSync(src, 'utf8')))
  return out
}

async function openLab(page, vp, h) {
  await h.openMode(page, vp, 'AI Lab', 'AI Lab')
  await page.getByRole('radio', { name: 'Bring your model' }).first().click()
  await page.waitForTimeout(300)
}

async function loadRun(page, vp, h, file, done = /Verified by re-simulation|Not verifiable|Not verified/) {
  await openLab(page, vp, h)
  await page.locator('input[type=file][accept^=".json"]').setInputFiles(file)
  await page.getByText(done).first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(500)
}

async function openScorecard(page, vp, h, file) {
  await loadRun(page, vp, h, file)
  await page.getByRole('button', { name: /Open scorecard/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(1500)
}

const scrollDialog = (page, heading) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('[role=dialog] h3')].find((e) => e.textContent?.trim().toLowerCase().startsWith(t.toLowerCase()))
    el?.scrollIntoView({ block: 'start' })
  }, heading)

export const SCENARIOS = {
  replay_run_l1: async (page, vp, _t, h) => {
    await loadRun(page, vp, h, prepared('L1'))
    await h.scrollInspector(page, vp, 'Benchmark run (run.json)')
  },
  replay_run_l2_partial: async (page, vp, _t, h) => {
    await loadRun(page, vp, h, prepared('L2'))
    await h.scrollInspector(page, vp, 'Benchmark run (run.json)')
  },
  replay_not_verifiable: async (page, vp, _t, h) => {
    await loadRun(page, vp, h, prepared('L1', (t) => t.replace(/("metrics": ?\{"n": ?\d+, ?"success": ?)[0-9.]+/, '$10.5')))
    await h.scrollInspector(page, vp, 'Benchmark run (run.json)')
  },
  replay_episode: async (page, vp, _t, h) => {
    await loadRun(page, vp, h, prepared('L2'))
    await page.getByRole('button', { name: /^Ran out of energy/ }).first().click({ timeout: 2000 }).catch(() => {})
    await page.getByRole('list', { name: 'Episodes' }).getByRole('button').first().click()
    await page.getByRole('button', { name: /Play replay|Pause replay/ }).first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await h.scrollInspector(page, vp, 'Episodes')
  },
  scorecard_top: async (page, vp, _t, h) => {
    await openScorecard(page, vp, h, prepared('L2'))
  },
  scorecard_violations: async (page, vp, _t, h) => {
    await openScorecard(page, vp, h, prepared('L2'))
    await scrollDialog(page, 'Critical violations')
    await page.waitForTimeout(300)
  },
  scorecard_baselines: async (page, vp, _t, h) => {
    await openScorecard(page, vp, h, prepared('L2'))
    await scrollDialog(page, 'Compared with')
    await page.waitForTimeout(500)
  },
  scorecard_limits: async (page, vp, _t, h) => {
    await openScorecard(page, vp, h, prepared('L2'))
    await scrollDialog(page, 'What this test does NOT cover')
    await page.waitForTimeout(300)
  },
  export_packages: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByText('Export to Gazebo / Isaac Sim').first().waitFor({ timeout: 30000 })
    await page.getByRole('list', { name: 'Export packages' }).waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'Export to Gazebo / Isaac Sim')
  },
  export_contents: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByRole('list', { name: 'Export packages' }).waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: /What is in each package/ }).click()
    await h.scrollInspector(page, vp, 'Export to Gazebo / Isaac Sim')
  },
}
