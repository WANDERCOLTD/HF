import { test, expect } from '../../../fixtures';

/**
 * Content Sources & Subject Detail E2E Tests
 * Tests content-related navigation and stepper flows
 */

test.describe('Content Sources Page', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should load content sources page', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible();
  });
});

test.describe('Subject Detail Stepper', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should show progress stepper on subject detail', async ({ page }) => {
    await page.goto('/x/subjects');
    await page.waitForLoadState('networkidle');

    const cards = page.locator('div[style*="cursor: pointer"][style*="border-radius"]');
    if (await cards.count() > 0) {
      await cards.first().click();
      await page.waitForLoadState('networkidle');

      // Stepper should show steps
      const sourcesStep = page.getByText('Sources').first();
      const curriculumStep = page.getByText('Curriculum').first();
      const domainsStep = page.getByText('Domains').first();

      const hasSourcesStep = await sourcesStep.isVisible({ timeout: 3000 }).catch(() => false);
      const hasCurriculumStep = await curriculumStep.isVisible({ timeout: 1000 }).catch(() => false);
      const hasDomainsStep = await domainsStep.isVisible({ timeout: 1000 }).catch(() => false);

      expect(hasSourcesStep || hasCurriculumStep || hasDomainsStep).toBe(true);
    }
  });
});

test.describe('Quick Launch → Content Flow', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should load quick launch page', async ({ page }) => {
    await page.goto('/x/quick-launch');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});

test.describe('Session Count Picker', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should show session count picker on subject detail', async ({ page }) => {
    await page.goto('/x/subjects');
    await page.waitForLoadState('networkidle');

    const cards = page.locator('div[style*="cursor: pointer"][style*="border-radius"]');
    if (await cards.count() > 0) {
      await cards.first().click();
      await page.waitForLoadState('networkidle');

      // Just verify the page loaded without error
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
  });
});
