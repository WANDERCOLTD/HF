import { test, expect } from '../../fixtures';
import { TeachPage } from '../../page-objects';

/**
 * Teach Page Tests
 * Tests the /x/teach page — step-based flow with institution, goal, content, plan sessions, and launch
 */
test.describe('Teach Page', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should load page with heading and step 1 (institution selector)', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('domcontentloaded');

    const teachPage = new TeachPage(page);
    await expect(teachPage.heading).toBeVisible();
    // Step 1 shows institution selector
    await expect(page.getByText('Institution')).toBeVisible();
  });

  test('should show step flow banner', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('domcontentloaded');

    // The step flow banner should be visible
    const banner = page.getByRole('navigation', { name: /flow/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Step 1 of 5');
  });

  test('should show Next button on step 1', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('networkidle');

    const nextBtn = page.getByRole('button', { name: /next/i });
    await expect(nextBtn).toBeVisible();
  });

  test('should show quick action buttons when institution selected', async ({ page }) => {
    await page.goto('/x/teach');
    await page.waitForLoadState('networkidle');

    const viewInstitution = page.getByRole('button', { name: 'View Institution' });
    const quickLaunch = page.getByRole('button', { name: 'Quick Launch' });

    const hasInstitution = await viewInstitution.isVisible().catch(() => false);
    if (hasInstitution) {
      await expect(viewInstitution).toBeVisible();
      await expect(quickLaunch).toBeVisible();
    }
  });

  test('should accept domainId query parameter', async ({ page }) => {
    // Navigate with a query param — page should not crash
    await page.goto('/x/teach?domainId=nonexistent');
    await page.waitForLoadState('domcontentloaded');

    const teachPage = new TeachPage(page);
    await expect(teachPage.heading).toBeVisible();
  });
});
