import { test, expect } from '@playwright/test'

test.describe('Production smoke test', () => {
  test('page loads and shows app title', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Verify HTTP 200
    expect(response?.status()).toBe(200)

    // Verify the app title renders
    await expect(page.locator('h1')).toContainText('Gemma')
  })

  test('page contains key UI elements', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Subtitle about privacy should be visible
    await expect(page.locator('.subtitle')).toBeVisible()

    // Either loading section, WebGPU error banner, or chat area should appear
    const loadSection = page.locator('.load-section')
    const errorBanner = page.locator('.error-banner')
    const chatArea = page.locator('.chat-area')
    await expect(
      loadSection.or(errorBanner).or(chatArea).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('no JavaScript errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/', { waitUntil: 'networkidle' })

    // Filter out WebGPU-not-supported errors (expected in headless Chrome)
    const unexpected = errors.filter(
      (e) => !e.includes('WebGPU') && !e.includes('gpu'),
    )
    expect(unexpected).toHaveLength(0)
  })
})
