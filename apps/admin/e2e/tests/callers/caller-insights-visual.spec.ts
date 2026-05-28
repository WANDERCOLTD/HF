import { test, expect } from "../../fixtures";

/**
 * Caller Insights — Visual Regression
 *
 * Baseline screenshots for the three caller-insight tabs (Overview, Uplift,
 * Progress) plus the two new v2 BETA tabs. Run before AND after every UI
 * PR touching this surface so v1 regressions and v2 drift are caught.
 *
 * Workflow:
 *   1. Before the PR: `npm run test:e2e -- caller-insights-visual` to
 *      establish the baseline (auto-saves on first run).
 *   2. After the PR: re-run; failures = visual diff. Inspect via
 *      `playwright-report/` html report.
 *   3. To accept an intentional change, re-run with `--update-snapshots`.
 *
 * Dynamic content (timestamps, names, ids) is masked to keep the diff
 * focused on layout and primitives. Animations are disabled so rings /
 * sparklines settle deterministically.
 */
test.describe("Caller Insights visual regression", () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs("admin@test.com");
  });

  async function openFirstCallerDetail(
    page: import("@playwright/test").Page,
  ): Promise<string | null> {
    await page.goto("/x/callers");
    await page.waitForLoadState("networkidle");

    const callerLink = page.locator('a[href*="/x/callers/"]').first();
    if (!(await callerLink.isVisible().catch(() => false))) return null;

    const href = await callerLink.getAttribute("href");
    if (!href) return null;

    await callerLink.click();
    await page.waitForLoadState("domcontentloaded");
    return href;
  }

  /** Stops rings / sparklines / banners mid-animation. */
  async function freezeAnimations(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });
  }

  /** Avatar + name + dates change per fixture; mask before screenshotting. */
  function dynamicLocators(page: import("@playwright/test").Page) {
    return [
      page.locator(".cdp-avatar"),
      page.locator(".cdp-info"),
      page.locator(".hf-empty-state-desc"),
    ];
  }

  async function snapshotTab(
    page: import("@playwright/test").Page,
    href: string,
    tab: string,
    fileName: string,
  ): Promise<void> {
    await page.goto(`${href}?tab=${tab}`);
    await page.waitForLoadState("networkidle");
    await freezeAnimations(page);
    await expect(page).toHaveScreenshot(fileName, {
      fullPage: true,
      mask: dynamicLocators(page),
      maxDiffPixelRatio: 0.01,
    });
  }

  test("Overview tab — baseline", async ({ page }) => {
    const href = await openFirstCallerDetail(page);
    if (!href) test.skip(true, "No seed callers available");
    await snapshotTab(page, href!, "overview", "overview.png");
  });

  test("v1 Uplift tab — baseline (with BETA banner)", async ({ page }) => {
    const href = await openFirstCallerDetail(page);
    if (!href) test.skip(true, "No seed callers available");
    await snapshotTab(page, href!, "uplift", "uplift-v1.png");
  });

  test("v1 Progress tab — baseline (with BETA banner)", async ({ page }) => {
    const href = await openFirstCallerDetail(page);
    if (!href) test.skip(true, "No seed callers available");
    await snapshotTab(page, href!, "what", "progress-v1.png");
  });

  test("v2 Uplift BETA tab — baseline shell", async ({ page }) => {
    const href = await openFirstCallerDetail(page);
    if (!href) test.skip(true, "No seed callers available");
    await snapshotTab(page, href!, "uplift-v2", "uplift-v2.png");
  });

  test("v2 Progress BETA tab — baseline shell", async ({ page }) => {
    const href = await openFirstCallerDetail(page);
    if (!href) test.skip(true, "No seed callers available");
    await snapshotTab(page, href!, "progress-v2", "progress-v2.png");
  });
});
