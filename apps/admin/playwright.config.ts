import { defineConfig, devices } from '@playwright/test';

const AUTH_FILE = '.playwright/auth.json';
const isCloud = !!process.env.CLOUD_E2E;
const TEST_PORT = process.env.PORT || (isCloud ? '3000' : '3001');
const TEST_BASE_URL = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${TEST_PORT}`;

/**
 * Playwright Configuration for E2E Testing
 *
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',

  /* Global setup for authentication */
  globalSetup: './e2e/global-setup.ts',

  /* Global teardown — clean up e2e-created data */
  globalTeardown: './e2e/global-teardown.ts',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry — cloud gets more retries due to network variability */
  retries: isCloud ? 3 : process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,

  /* Cloud tests get longer timeouts for AI calls + network latency */
  timeout: isCloud ? 120_000 : 30_000,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  /* Shared settings for all the projects below. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: TEST_BASE_URL,

    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Maximum time each action can take — cloud gets more time */
    actionTimeout: isCloud ? 30_000 : 10_000,

    /* Navigation timeout for cloud latency */
    navigationTimeout: isCloud ? 60_000 : 30_000,
  },

  /* Configure projects for major browsers */
  projects: [
    /* Authenticated tests - run with pre-established session */
    {
      name: 'authenticated',
      testMatch: /tests\/(?!cloud\/|_archived\/|intake\/).+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
    },

    /* Unauthenticated tests - for login flow testing */
    {
      name: 'unauthenticated',
      testMatch: /tests\/auth\/.+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
      },
    },

    /* Intake tests — public learner-facing surface; no auth, no
     * cookie. Excluded from authenticated + mobile so AUTH_FILE
     * doesn't bleed in. Run against the hf-dev VM via tunnel with
     * `CLOUD_E2E=1` (default port 3000 + longer timeouts). */
    {
      name: 'intake',
      testMatch: /tests\/intake\/.+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
      },
    },

    /* Mobile viewport tests */
    {
      name: 'mobile',
      testMatch: /tests\/(?!cloud\/|_archived\/|intake\/).+\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        storageState: AUTH_FILE,
      },
    },

    /* Cloud E2E tests — full system flow against cloud environment */
    {
      name: 'cloud',
      testMatch: /tests\/cloud\/.+\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
    },

    /* Legacy tests (deprecated routes) */
    {
      name: 'legacy',
      testMatch: /\d+-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run test server on separate port so dev server stays untouched.
   * Skip for CI (handles its own server) and cloud E2E (uses SSH tunnel). */
  webServer: (process.env.CI || isCloud) ? undefined : {
    command: `NODE_ENV=test npm run dev -- --port ${TEST_PORT}`,
    url: TEST_BASE_URL,
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
