import { chromium, FullConfig } from '@playwright/test';
import { execSync } from 'child_process';

const AUTH_FILE = '.playwright/auth.json';

/**
 * Ensure test database is migrated (local only — CI handles its own DB).
 * Runs prisma migrate deploy which is fast and idempotent.
 */
function ensureTestDb() {
  if (process.env.CI || process.env.CLOUD_E2E) return;

  console.log('[Global Setup] Running Prisma migrate deploy on test DB...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'pipe' });
    console.log('[Global Setup] Migrations up to date.');
  } catch (error) {
    console.error(
      '\n[Global Setup] Database migration failed.\n' +
      'Run this first: npm run test:e2e:setup\n'
    );
    throw error;
  }
}

/**
 * Global Setup
 * Runs once before all tests to establish authenticated session state
 */
async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;

  ensureTestDb();

  console.log('[Global Setup] Starting authentication...');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to login page and wait for form to render
    const isCloud = !!process.env.CLOUD_E2E;
    console.log(`[Global Setup] baseURL=${baseURL}, isCloud=${isCloud}`);
    await page.goto(`${baseURL}/login`, { timeout: isCloud ? 60000 : 30000 });
    // Wait for email input to appear (Turbopack may be compiling on first hit)
    await page.locator('#email').waitFor({ state: 'visible', timeout: isCloud ? 60000 : 15000 });
    console.log(`[Global Setup] Login page loaded at ${page.url()}`);

    // Fill in credentials (using default admin user)
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    await page.locator('#email').fill('admin@test.com');
    await page.locator('#password').fill(password);

    // Submit login form — scope to the login form so a stray
    // chat-send button elsewhere on the page (e.g. intake preview)
    // doesn't trigger a strict-mode collision.
    await page.locator('button.login-btn[type="submit"]').click();
    console.log('[Global Setup] Form submitted, waiting for redirect...');

    // Wait a moment then check URL
    await page.waitForTimeout(5000);
    console.log(`[Global Setup] After 5s: url=${page.url()}`);

    // Check for error message
    const errorEl = page.locator('text=Invalid email or password');
    if (await errorEl.isVisible()) {
      console.error('[Global Setup] ERROR: Invalid email or password shown!');
    }

    // Wait for successful redirect to /x
    await page.waitForURL(/\/x/, { timeout: isCloud ? 60000 : 15000, waitUntil: 'domcontentloaded' });

    console.log('[Global Setup] Login successful, saving auth state...');

    // Save storage state (cookies, localStorage) for reuse
    await context.storageState({ path: AUTH_FILE });

    console.log('[Global Setup] Auth state saved to:', AUTH_FILE);
  } catch (error) {
    console.error('[Global Setup] Authentication failed:', error);
    // Take screenshot on failure for debugging
    await page.screenshot({ path: 'playwright-report/global-setup-failure.png' });
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
