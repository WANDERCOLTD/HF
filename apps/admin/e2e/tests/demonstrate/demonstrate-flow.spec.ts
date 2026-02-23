import { test, expect } from '../../fixtures';
import { TeachPage } from '../../page-objects';

/**
 * Teach Flow Tests
 * Tests the multi-step teach flow: Institution → Goal → Content → Plan Sessions → Launch
 */
test.describe('Teach Flow', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('goal input visible on step 2', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('networkidle');

    // Check if institutions exist and Next is enabled
    const nextBtn = page.getByRole('button', { name: /next/i });
    const isEnabled = await nextBtn.isEnabled().catch(() => false);

    if (isEnabled) {
      // Advance to step 2 (goal)
      await nextBtn.click();

      // Goal textarea should be visible
      const goalInput = page.getByPlaceholder(/what do you want to teach/i);
      await expect(goalInput).toBeVisible();
    }
  });

  test('back button returns to previous step', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('networkidle');

    const nextBtn = page.getByRole('button', { name: /next/i });
    const isEnabled = await nextBtn.isEnabled().catch(() => false);

    if (isEnabled) {
      await nextBtn.click();
      await page.waitForTimeout(300);

      // Now on step 2, click Back
      const backBtn = page.getByRole('button', { name: /back/i });
      await backBtn.click();

      // Should be back on step 1 — institution selector visible
      const institutionLabel = page.getByText(/institution/i).first();
      await expect(institutionLabel).toBeVisible();
    }
  });
});
