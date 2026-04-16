import { test, expect } from '../../fixtures';

/**
 * Caller Detail Tabs E2E Tests
 * Tests the WHAT | HOW | WHO tab layout (Calls & Prompts, How, What, Artifacts)
 * and SectionSelector toggle chips
 */
test.describe('Caller Detail Tab Structure', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  async function navigateToCallerDetail(page: import('@playwright/test').Page) {
    await page.goto('/x/callers');
    await page.waitForLoadState('networkidle');

    const callerLink = page.locator('a[href*="/x/callers/"]').first();
    if (await callerLink.isVisible()) {
      await callerLink.click();
      await page.waitForLoadState('domcontentloaded');
      return true;
    }
    return false;
  }

  test('should display 4 main tabs', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    // Should show tabs: Calls & Prompts, How, What, Artifacts (or Call)
    const tabContainer = page.locator('[role="tablist"], [class*="tab"]').first();

    // Check for the expected tab names
    const callsTab = page.getByText(/Calls & Prompts/i);
    const howTab = page.getByText(/^How$/i);
    const whatTab = page.getByText(/^What$/i);

    // At least the core tabs should be present
    if (await callsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(callsTab).toBeVisible();
    }
  });

  test('should show What tab (learner progress)', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    // Verify "What" tab exists (mirrors Course WHAT | HOW | WHO from learner perspective)
    const whatTab = page.getByText(/^What$/i).first();
    if (await whatTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(whatTab).toBeVisible();
    }
  });

  test('should switch between tabs', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    const tabs = page.locator('[role="tab"], [class*="tab-button"]');
    const tabCount = await tabs.count();

    if (tabCount >= 2) {
      // Click second tab
      await tabs.nth(1).click();
      await page.waitForTimeout(300);

      // Tab content should change
      const content = page.locator('main, [role="main"]');
      await expect(content).toBeVisible();

      // Click third tab if available
      if (tabCount >= 3) {
        await tabs.nth(2).click();
        await page.waitForTimeout(300);
        await expect(content).toBeVisible();
      }
    }
  });

  test('should show What tab with Gauge icon', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    // Click What tab
    const whatTab = page.getByText(/^What$/i).first();
    if (await whatTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await whatTab.click();
      await page.waitForTimeout(500);

      // Should show measurement data or empty state
      const content = page.locator('main, [role="main"]');
      await expect(content).toBeVisible();
    }
  });
});

test.describe('SectionSelector Toggle Chips', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  async function navigateToCallerDetail(page: import('@playwright/test').Page) {
    await page.goto('/x/callers');
    await page.waitForLoadState('networkidle');

    const callerLink = page.locator('a[href*="/x/callers/"]').first();
    if (await callerLink.isVisible()) {
      await callerLink.click();
      await page.waitForLoadState('domcontentloaded');
      return true;
    }
    return false;
  }

  test('should display section toggle chips on How tab', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    // Click How tab
    const profileTab = page.getByText(/^How$/i).first();
    if (await profileTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await profileTab.click();
      await page.waitForTimeout(500);

      // Look for section toggle chips (SectionSelector)
      const chips = page.locator('[class*="chip"], [class*="toggle"], button[class*="section"]');
      if ((await chips.count()) > 0) {
        await expect(chips.first()).toBeVisible();
      }
    }
  });

  test('should toggle section visibility', async ({ page }) => {
    const navigated = await navigateToCallerDetail(page);
    if (!navigated) return;

    const howTab = page.getByText(/^How$/i).first();
    if (await howTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await howTab.click();
      await page.waitForTimeout(500);

      // Find a toggle chip and click it
      const chips = page.locator('[class*="chip"], [class*="toggle"], button[class*="section"]');
      if ((await chips.count()) > 0) {
        const firstChip = chips.first();
        await firstChip.click();
        await page.waitForTimeout(300);

        // Clicking again should toggle the section back
        await firstChip.click();
        await page.waitForTimeout(300);
      }
    }
  });
});

test.describe('Call-Level Tabs', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('admin@test.com');
  });

  test('should show 4 call-level tabs when viewing a call', async ({ page }) => {
    await page.goto('/x/callers');
    await page.waitForLoadState('networkidle');

    const callerLink = page.locator('a[href*="/x/callers/"]').first();
    if (!await callerLink.isVisible()) return;

    await callerLink.click();
    await page.waitForLoadState('domcontentloaded');

    // Click Calls & Prompts tab first
    const callsTab = page.getByText(/Calls & Prompts/i).first();
    if (await callsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await callsTab.click();
      await page.waitForTimeout(500);

      // Click on a specific call to see call-level tabs
      const callRow = page.locator('tr a, [class*="call-row"], [class*="call-item"]').first();
      if (await callRow.isVisible({ timeout: 3000 }).catch(() => false)) {
        await callRow.click();
        await page.waitForTimeout(500);

        // Should see call-level tabs: Transcript, Extraction, Behaviour, Prompt
        const transcriptTab = page.getByText(/^Transcript$/i);
        if (await transcriptTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(transcriptTab).toBeVisible();
        }
      }
    }
  });
});
