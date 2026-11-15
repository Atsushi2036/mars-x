import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const ONNX = path.join(repo, 'models/jezero-v1/policy.onnx')

async function openLab(page, vp, h) {
  await h.openMode(page, vp, 'AI Lab', 'AI Lab')
}
const tab = (page, name) => page.getByRole('radio', { name }).first().click()

/** requests that carry a body or leave the origin while a file is processed (privacy check, S3-10) */
function watchNetwork(page) {
  const seen = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.origin !== new URL(page.url()).origin || (r.method() !== 'GET' && r.method() !== 'HEAD') || r.postData()) seen.push(`${r.method()} ${r.url()}`)
  })
  return seen
}

export const SCENARIOS = {
  lab_map: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await page.waitForSelector('canvas[aria-label^="Learning grid"]', { timeout: 60000 })
  },
  lab_train: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await page.waitForSelector('canvas[aria-label^="Learning grid"]', { timeout: 60000 })
    await page.getByRole('button', { name: /^Train$/ }).first().click()
    await page.waitForTimeout(9000)
    await h.scrollInspector(page, vp, 'Reward per episode')
  },
  lab_compare: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await page.waitForSelector('canvas[aria-label^="Learning grid"]', { timeout: 60000 })
    await page.getByRole('button', { name: /^Train$/ }).first().click()
    await page.waitForTimeout(9000)
    await h.scrollInspector(page, vp, 'Greedy policy vs A*')
  },
  lab_reference: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await tab(page, 'Bring your model')
    await page.waitForTimeout(800)
  },
  lab_policy_ok: async (page, vp, _t, h) => {
    const net = watchNetwork(page)
    await openLab(page, vp, h)
    await tab(page, 'Bring your model')
    await page.locator('input[type=file][accept=".onnx"]').setInputFiles(ONNX)
    await page.getByText('Matches the policy/1 contract').first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'ONNX policy')
    console.log('  network with body or off-origin during ONNX load:', net.length ? net : 'none')
  },
  lab_policy_bad: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await tab(page, 'Bring your model')
    const bad = path.join(repo, 'apps/explorer/.shots/features/bad.onnx')
    fs.mkdirSync(path.dirname(bad), { recursive: true })
    fs.writeFileSync(bad, Buffer.from('this is not an onnx model'))
    await page.locator('input[type=file][accept=".onnx"]').setInputFiles(bad)
    await page.getByRole('alert').filter({ hasText: /model/i }).first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'ONNX policy')
  },
  lab_run_bad: async (page, vp, _t, h) => {
    await openLab(page, vp, h)
    await tab(page, 'Bring your model')
    const bad = path.join(repo, 'apps/explorer/.shots/features/bad.json')
    fs.writeFileSync(bad, '{"hello":"world"}')
    await page.locator('input[type=file][accept^=".json"]').setInputFiles(bad)
    await page.getByRole('alert').filter({ hasText: /run\/1|JSON/ }).first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'Benchmark run (run.json)')
  },
}

// ---- Data & Sources
Object.assign(SCENARIOS, {
  sources_top: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByText('Validation').first().waitFor({ timeout: 30000 })
  },
  sources_validation: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByText('r = 1.00000').first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'Validation')
  },
  sources_credits: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByText('Map data').first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'Data sources')
  },
  sources_scope: async (page, vp, _t, h) => {
    await h.openMode(page, vp, 'Data & Sources', 'Data')
    await page.getByText('Scope & limits').first().waitFor({ timeout: 30000 })
    await h.scrollInspector(page, vp, 'Scope & limits')
  },
})
