import { expect, test } from '@playwright/test'
import { canvasStats, expectClean, isMobile, modeButton, open, openMode, watch } from './helpers'

test.describe('app shell', () => {
  test('loads, scene becomes ready and keeps rendering, console and network clean', async ({ page, baseURL }) => {
    const issues = watch(page, baseURL!)
    await open(page)
    const a = await page.evaluate(() => window.__marsx!.frameCount)
    await page.waitForTimeout(1500)
    const b = await page.evaluate(() => window.__marsx!.frameCount)
    expect(b, 'frames advance').toBeGreaterThan(a)
    await expect(page.locator('canvas').first()).toBeVisible()
    expectClean(issues)
  })

  test('canvas is not black and has tonal variation', async ({ page }) => {
    await open(page)
    await page.waitForTimeout(2000)
    const s = await canvasStats(page)
    expect(s.litFraction, JSON.stringify(s)).toBeGreaterThan(0.5)
    expect(s.std, JSON.stringify(s)).toBeGreaterThan(8)
  })

  test('shows the non-affiliation disclaimer and a USGS attribution (Data & Sources)', async ({ page }, info) => {
    await open(page)
    await modeButton(page, info, 'Data & Sources').click()
    const disc = page.getByText(/Not affiliated with or endorsed by NASA, JPL or Caltech/i).locator('visible=true').first()
    await disc.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await expect(disc).toBeVisible()
    await expect(page.getByText(/USGS/).first()).toBeAttached()
  })

  test('no horizontal overflow', async ({ page }) => {
    await open(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test('mode switching: every mode opens the inspector without errors', async ({ page, baseURL }, info) => {
    const issues = watch(page, baseURL!)
    await open(page)
    for (const label of ['Layers', 'Plan a route', 'Data', 'Explore']) {
      await openMode(page, info, label)
      await expect(page.getByRole('heading', { name: label, exact: true }).or(page.getByText(label, { exact: true }).locator('visible=true')).first()).toBeVisible()
    }
    expectClean(issues)
  })

  test('layers: choosing Slope keeps the scene rendering', async ({ page }, info) => {
    await open(page)
    await openMode(page, info, 'Layers')
    await page.getByRole('radio', { name: 'Slope' }).click()
    await page.waitForTimeout(800)
    const s = await canvasStats(page)
    expect(s.litFraction).toBeGreaterThan(0.5)
  })

  test('camera modes via keyboard (desktop)', async ({ page }, info) => {
    test.skip(isMobile(info), 'keyboard shortcuts are desktop-only')
    await open(page)
    for (const [key, mode] of [['Digit2', 'fpv'], ['Digit3', 'chase'], ['Digit1', 'orbit']] as const) {
      await page.keyboard.press(key)
      await expect.poll(() => page.evaluate(() => window.__marsx!.mode)).toBe(mode)
    }
  })
})
