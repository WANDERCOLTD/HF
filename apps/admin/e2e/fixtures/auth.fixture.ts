import { test as base, Page, BrowserContext } from '@playwright/test';

/**
 * Authentication fixture for E2E tests
 * Provides helpers for login/logout and pre-authenticated pages
 */

export type AuthFixture = {
  /** Login as a specific user */
  loginAs: (email: string, password?: string) => Promise<void>;
  /** Logout current user */
  logout: () => Promise<void>;
  /** Create a new browser context logged in as a specific user */
  createAuthenticatedContext: (email: string, password?: string) => Promise<BrowserContext>;
};

export const test = base.extend<AuthFixture>({
  loginAs: async ({ page }, use) => {
    const login = async (email: string, password = process.env.SEED_ADMIN_PASSWORD || 'admin123') => {
      const isCloud = !!process.env.CLOUD_E2E;
      await page.goto('/login', { timeout: isCloud ? 60000 : 30000 });
      await page.waitForLoadState('networkidle', { timeout: isCloud ? 30000 : 15000 });

      // Toggle to password mode (login defaults to magic-link).
      await page.getByRole('button', { name: 'Use a password instead' }).click();

      // Fill credentials
      await page.locator('#contact').fill(email);
      await page.locator('#password').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#password').fill(password);

      // Submit form
      await page.locator('button.login-btn[type="submit"]').click();

      // Wait for redirect to /x (domcontentloaded — dashboard has long-lived connections that block 'load')
      await page.waitForURL(/\/x/, { timeout: isCloud ? 60000 : 15000, waitUntil: 'domcontentloaded' });
    };
    await use(login);
  },

  logout: async ({ page }, use) => {
    const logout = async () => {
      // Clear session by clearing cookies and navigating to login
      await page.context().clearCookies();
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');
    };
    await use(logout);
  },

  createAuthenticatedContext: async ({ browser }, use) => {
    const createContext = async (email: string, password = process.env.SEED_ADMIN_PASSWORD || 'admin123') => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');

      await page.getByRole('button', { name: 'Use a password instead' }).click();
      await page.locator('#contact').fill(email);
      await page.locator('#password').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#password').fill(password);
      await page.locator('button.login-btn[type="submit"]').click();

      await page.waitForURL(/\/x/, { timeout: 10000 });
      await page.close();

      return context;
    };
    await use(createContext);
  },
});

export { expect } from '@playwright/test';
