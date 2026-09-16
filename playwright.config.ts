import { defineConfig, devices } from '@playwright/test'

const BASE_PATH = '/habit-quota/'
const PORT = 4173

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    // The preview server must serve under the same base the build was made
    // with, or every asset URL 404s exactly as it would on a misconfigured
    // Pages deployment.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    env: { BASE_PATH },
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
