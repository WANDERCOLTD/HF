import { test, expect } from '../../fixtures';
import { SidebarPage } from '../../page-objects';

/**
 * Cloud Smoke Tests
 *
 * Validates that the cloud deployment is healthy and key pages load.
 * No AI dependency — these should pass even without API keys.
 * Run first to catch deployment issues before heavier tests.
 */
test.describe('Cloud Smoke', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should load dashboard after login', async ({ page }) => {
    await page.goto('/x');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x/);
  });

  test('should display sidebar with navigation', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await sidebar.goto();
    await sidebar.verifySidebarStructure();
  });

  test('should load Callers page', async ({ page }) => {
    await page.goto('/x/callers');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x\/callers/);
  });

  test('should load Domains page', async ({ page }) => {
    await page.goto('/x/domains');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x\/domains/);
  });

  test('should load Pipeline page', async ({ page }) => {
    await page.goto('/x/pipeline');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x\/pipeline/);
  });

  test('should load Specs page', async ({ page }) => {
    await page.goto('/x/specs');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x\/specs/);
  });

  test('should load Settings page', async ({ page }) => {
    await page.goto('/x/settings');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/x\/settings/);
  });

  test('health API should return ok', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test('ready API should confirm specs loaded', async ({ page }) => {
    const response = await page.request.get('/api/ready');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
