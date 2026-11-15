import fs from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import { open, openMode, type Theme } from './helpers'

/** Visual evidence: 1440 and 390, dark and light, per mode -> e2e/__shots__/<mode>__<project>__<theme>.png */
const OUT = path.resolve(import.meta.dirname, '__shots__')
const MODES = ['Explore', 'Layers', 'Plan a route', 'Test your AI', 'Data']

for (const theme of ['dark', 'light'] as Theme[]) {
  test(`captures (${theme})`, async ({ page }, info) => {
    fs.mkdirSync(OUT, { recursive: true })
    await open(page, theme)
    await page.waitForTimeout(1500)
    for (const label of MODES) {
      await openMode(page, info, label)
      await page.waitForTimeout(900)
      const slug = label.toLowerCase().replace(/[^a-z]+/g, '-')
      await page.screenshot({ path: path.join(OUT, `${slug}__${info.project.name}__${theme}.png`) })
    }
  })
}
