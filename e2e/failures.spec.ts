import { test, expect, type Page } from '@playwright/test';

test.describe('Failures page smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
  });

  test('loads at 375px without horizontal overflow', async ({ page }) => {
    await page.goto('/failures');
    await expect(page.locator('#root')).toBeVisible();

    const loginGate = page.getByRole('heading', { name: /welcome back/i });
    const heroTitle = page.getByText('Failures', { exact: true });

    await expect(loginGate.or(heroTitle)).toBeVisible({ timeout: 10_000 });

    if (await heroTitle.isVisible()) {
      await expect(heroTitle).toBeVisible();
    }

    await expectNoHorizontalOverflow(page);
  });
});

async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(hasOverflow).toBe(false);
}
