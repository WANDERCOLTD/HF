import { test, expect } from '../../../fixtures';

test.describe('Content Sources Wizard', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should display wizard as default view with 7-step progress stepper', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Page title shows "Content Sources"
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Content Sources');

    // ProgressStepper should show step labels
    await expect(page.getByText('Add Source')).toBeVisible();
    await expect(page.getByText('Extract')).toBeVisible();
    await expect(page.getByText('Review')).toBeVisible();
    await expect(page.getByText('Plan Lessons')).toBeVisible();
    await expect(page.getByText('Onboard')).toBeVisible();
    await expect(page.getByText('Preview')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();
  });

  test('should show library card grid as primary view in Step 1', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Intent-driven prompt should be visible
    await expect(page.getByText(/what do you want to teach/i)).toBeVisible();

    // Library search input should be visible as primary UI
    await expect(page.getByPlaceholder(/search sources/i)).toBeVisible();

    // Upload toggle should be visible below
    await expect(page.getByText(/upload a new source/i)).toBeVisible();
  });

  test('should toggle between library and upload views in Step 1', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Click "Or upload a new source" to expand upload section
    await page.getByText(/upload a new source/i).click();

    // File drop zone should now be visible
    await expect(page.getByText(/drop a file/i)).toBeVisible();

    // "Back to library" should be visible
    await expect(page.getByText(/back to library/i)).toBeVisible();

    // Toggle back
    await page.getByText(/back to library/i).click();

    // Library search input should be visible again
    await expect(page.getByPlaceholder(/search sources/i)).toBeVisible();
  });

  test('should show describe input in upload mode', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Expand upload section first
    await page.getByText(/upload a new source/i).click();

    // The intent text input should be visible
    const intentInput = page.locator('input[placeholder*="CII"]');
    await expect(intentInput).toBeVisible();
  });

  test('should toggle between wizard and library page view', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Initially shows wizard
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Content Sources');

    // Click "View Library" toggle
    const toggleBtn = page.getByRole('button', { name: /view library/i });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Now shows library
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Content Library');

    // Toggle back
    const backBtn = page.getByRole('button', { name: /back to wizard/i });
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Back to wizard
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Content Sources');
  });

  test('library page view should show content sources table', async ({ page }) => {
    await page.goto('/x/content-sources');
    await page.waitForLoadState('domcontentloaded');

    // Switch to library page view
    await page.getByRole('button', { name: /view library/i }).click();
    await page.waitForLoadState('domcontentloaded');

    // Library should show table or list of sources
    const hasTable = await page.locator('table').count() > 0;
    const hasNoSourcesMsg = await page.getByText(/no content sources/i).count() > 0;
    const hasSourceCards = await page.locator('[data-testid="source-row"]').count() > 0;

    expect(hasTable || hasNoSourcesMsg || hasSourceCards).toBe(true);
  });
});
