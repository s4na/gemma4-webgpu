import { defineConfig } from '@playwright/test'

const siteUrl = process.env.SMOKE_TEST_URL?.replace(/\/$/, '') || 'https://s4na.github.io/gemma4-webgpu'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'smoke.spec.ts',
  timeout: 60_000,
  retries: 2,
  use: {
    baseURL: siteUrl,
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
