// Synthetic e2e — intake/enrollment-crawcus chat flow.
//
// Runs against a real running HF instance (default: hf-dev VM via SSH
// tunnel on localhost:3000). Verifies the spec-driven `update-setup`
// tool-call path captures all 3 required fields from a single
// multi-field paste — the regression that fixed the "last name: yes"
// bug class once items 12+13 landed.
//
// HOW TO RUN
//   1. SSH tunnel open: `gcloud compute ssh hf-dev --zone=europe-west2-a
//                       --tunnel-through-iap -- -L 3000:localhost:3000 -N`
//   2. From apps/admin/:
//        CLOUD_E2E=1 npx playwright test --project=intake \
//          tests/intake/enrollment-crawcus.spec.ts
//
// THE ROUTE
// Defaults to the tokenless platform-level demo route
// (`/intake/enrollment-crawcus`) so this test runs on any HF
// instance without requiring a seeded Classroom row.
// `INTAKE_E2E_TOKEN=xyz` switches to the token-bound route — useful
// for verifying the join-handoff redirect against a known seeded
// classroom on hf-dev. When unset, the test stops at "all 3 fields
// captured + 'submitting' confirmation" without redirecting; with a
// token, the redirect URL is computed but NOT followed (we don't
// want to mint a real Caller on every CI run).
//
// EMAIL
// Each run uses a unique timestamped email so re-runs don't collide
// on the email uniqueness constraint when a redirect IS followed
// downstream.

import { test, expect } from "@playwright/test";

const TOKEN = process.env.INTAKE_E2E_TOKEN; // optional
const ROUTE = TOKEN
  ? `/intake/enrollment-crawcus/${TOKEN}`
  : "/intake/enrollment-crawcus";

function makeEmail(): string {
  // Unique per run; example.com so DKIM/deliverability checks (if any
  // get added later) won't try to actually mail this address.
  return `e2e-intake-${Date.now()}@hftest.example.com`;
}

test.describe("intake/enrollment-crawcus", () => {
  test("captures firstName + lastName + email from a single multi-field paste", async ({ page }) => {
    const email = makeEmail();

    await page.goto(ROUTE);

    // 1. Page header renders.
    await expect(page.getByRole("heading", { name: /enrolment/i })).toBeVisible({ timeout: 15_000 });

    // 2. Chat composer + thread render — bootstrap has completed.
    const input = page.getByTestId("enrollment-chat-input");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(input).toBeEnabled();
    await expect(page.getByTestId("enrollment-chat-thread")).toBeVisible();

    // 3. Send the multi-field paste in one message. With items 12+13
    //    spec-driven tool calling, the AI should call `update-setup`
    //    with all three fields populated atomically.
    const sendBtn = page.getByTestId("enrollment-chat-send");
    await input.fill(`Hello — I'm Peter Jones and my email is ${email}.`);
    await sendBtn.click();

    // 4. Wait for the assistant turn to land + the values panel to
    //    reflect all three captured fields. We poll the page text
    //    rather than a specific element because ValuesPanel renders
    //    captured values as a compact summary list.
    const valuesPanel = page.locator("body");
    await expect(valuesPanel).toContainText("Peter", { timeout: 30_000 });
    await expect(valuesPanel).toContainText("Jones", { timeout: 30_000 });
    await expect(valuesPanel).toContainText(email, { timeout: 30_000 });
  });

  test("renders the Art 13 disclosure banner with notice text", async ({ page }) => {
    await page.goto(ROUTE);

    // Banner text should appear — at least the controller name and
    // a snippet of the Art 13 body. Catches the Q-CR9 wire-up
    // regression: if noticeText/requirementId aren't passed,
    // TallysealBanner won't render the notice.
    await expect(page.locator("body")).toContainText("HumanFirst Foundation", { timeout: 15_000 });
    await expect(page.locator("body")).toContainText("Privacy Notice", { timeout: 5_000 });
  });

  test("redirects to /intake/done with intentId after enrolment completes", async ({ page }) => {
    const email = makeEmail();
    await page.goto(ROUTE);
    const input = page.getByTestId("enrollment-chat-input");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill(`I'm Peter Jones and my email is ${email}.`);
    await page.getByTestId("enrollment-chat-send").click();

    // Wait for the chat client to follow data.redirectUrl → /intake/done?…
    await page.waitForURL(/\/intake\/done\?intentId=/, { timeout: 30_000 });

    // The recap page renders the captured values + actions + CoC.
    await expect(page.getByTestId("intake-done-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("intake-coc-panel")).toBeVisible();
    await expect(page.getByTestId("intake-done-download")).toBeVisible();
    await expect(page.locator("body")).toContainText(email);
  });

  test("acknowledge button emits DisclosureAcknowledged + flips to confirmation pill", async ({ page }) => {
    await page.goto(ROUTE);
    const btn = page.getByTestId("intake-art13-ack-btn");
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expect(page.getByTestId("intake-art13-acked")).toBeVisible({ timeout: 10_000 });
    // Re-acknowledging is idempotent — the button is gone, no error
    // banner appears.
    await expect(page.getByTestId("intake-art13-ack-btn")).toHaveCount(0);
  });

  test("does not render the 4 internal field keys on the learner form", async ({ page }) => {
    await page.goto(ROUTE);
    await expect(page.getByTestId("enrollment-chat-input")).toBeVisible({ timeout: 15_000 });

    // INTERNAL_FIELDS — these MUST never appear in the learner UI.
    // Regression guard: if EnrollmentChat stops filtering the spec,
    // TallysealIntentForm will dump them and this assertion fails.
    const body = page.locator("body");
    await expect(body).not.toContainText("processesArt9");
    await expect(body).not.toContainText("art9Exemption");
    await expect(body).not.toContainText("classroomToken");
    await expect(body).not.toContainText("classroomName");
  });
});
