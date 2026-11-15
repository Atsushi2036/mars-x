import { defineConfig } from '@playwright/test'

/**
 * E2E against any deployed or local build (no webServer: start `pnpm preview` yourself for localhost).
 *   E2E_URL    base URL (default: the Cloudflare Pages preview)
 *   E2E_QUERY  query string appended to the app URL (default none), e.g. "?data=synthetic"
 * Uses the system Chrome (channel 'chrome'); Playwright's own browsers are not installed.
 * SwiftShader flags make WebGL work on machines/CI runners without a GPU.
 */
const GL_ARGS = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
const baseURL = process.env.E2E_URL ?? 'https://preview.mars-x-7k9.pages.dev'

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 420_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  use: {
    baseURL,
    channel: 'chrome',
    launchOptions: { args: GL_ARGS },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
})
