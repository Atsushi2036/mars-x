import fs from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import { modeButton, open, type Theme } from './helpers'

/** Visual evidence: 1440 and 390, dark and light, per mode -> e2e/__shots__/<mode>__<project>__<theme>.png */
const OUT = path.resolve(import.meta.dirname, '__shots__')
const MODES = ['Explore', 'Layers', 'Mission', 'AI Lab', 'Data & Sources']

for (const theme of ['dark', 'light'] as Theme[]) {
  test(`captures (${theme})`, async ({ page }, info) => {
    fs.mkdirSync(OUT, { recursive: true })
    await open(page, theme)
    await page.waitForTimeout(1500)
    for (const label of MODES) {
      await modeButton(page, info, label).click()
      await page.waitForTimeout(900)
      const slug = label.toLowerCase().replace(/[^a-z]+/g, '-')
      await page.screenshot({ path: path.join(OUT, `${slug}__${info.project.name}__${theme}.png`) })
    }
  })
}
