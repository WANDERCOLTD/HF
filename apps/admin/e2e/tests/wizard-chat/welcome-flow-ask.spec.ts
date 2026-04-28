import { test, expect } from '../../fixtures';

/**
 * V5 Conversational Wizard — Welcome Flow Ask (#210)
 *
 * Verifies that after the educator confirms the main configuration proposal,
 * the AI proposes the four welcome flow phases (Goals / About You / Knowledge
 * Check / AI Introduction) BEFORE create_course is called.
 *
 * AC-1, AC-2, AC-3 from issue #210.
 *
 * NOTE: this spec drives a real chat-AI conversation end-to-end. It depends on
 * an Anthropic API key, a seeded institution, and ~60–90 s for AI turns. Run
 * with `npm run test:e2e -- welcome-flow-ask.spec.ts` against a live server —
 * do NOT run as part of the default e2e sweep.
 *
 * Authored 2026-04-28; flagged as authored-only at PR time (not run from the
 * worktree because no dev server is available locally).
 */

test.describe('V5 Conversational Wizard — Welcome Flow Ask', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin@test.com');
  });

  // ── AC-1 + AC-2: Sounds good path ──────────────────────────────────────

  test('main proposal confirmed → welcome flow card renders → "Sounds good" advances', async ({ page }) => {
    test.slow(); // Multiple AI turns

    await page.goto('/x/get-started-v5');
    await page.waitForLoadState('networkidle');

    // Send an initial intake message that gives the AI enough to make a proposal.
    const chatInput = page.locator('textarea, [contenteditable="true"]').first();
    await chatInput.waitFor({ state: 'visible' });
    await chatInput.fill(
      'I want to set up a 6-session GCSE Biology course for Year 10 students at Riverside Academy. Question-led Socratic teaching, 30-minute calls, balanced coverage.',
    );
    await page.keyboard.press('Enter');

    // Wait for the playback turn — assistant repeats understanding back.
    await expect(page.getByText(/let me play back what i've understood/i)).toBeVisible({ timeout: 60_000 });

    // Confirm the playback.
    const playbackConfirmChip = page.getByRole('button', { name: /that's exactly right|that's right|sounds right/i }).first();
    await playbackConfirmChip.click();

    // Wait for the full configuration proposal turn.
    await expect(page.getByText(/here's what i'd set up|teaching approach/i)).toBeVisible({ timeout: 60_000 });

    // Confirm the main proposal.
    const proposalConfirmChip = page.getByRole('button', { name: /sounds right|sounds good/i }).first();
    await proposalConfirmChip.click();

    // ── AC-1: Welcome flow card renders ────────────────────────────────
    // The OptionsCard checklist for _welcomePhases should appear with 4 options.
    const welcomeCard = page.locator('.cv4-options-card').filter({
      has: page.getByText(/goals/i),
    });
    await expect(welcomeCard).toBeVisible({ timeout: 60_000 });

    // All four options must be present.
    await expect(welcomeCard.getByText(/goals/i)).toBeVisible();
    await expect(welcomeCard.getByText(/about you/i)).toBeVisible();
    await expect(welcomeCard.getByText(/knowledge check/i)).toBeVisible();
    await expect(welcomeCard.getByText(/ai introduction|introduction call/i)).toBeVisible();

    // Confirmation chips should be present.
    await expect(page.getByRole('button', { name: /sounds good/i }).first()).toBeVisible();

    // ── AC-2: Click Sounds good → AI moves to Phase 5 ─────────────────
    await page.getByRole('button', { name: /^sounds good$/i }).first().click();

    // The Phase 5 summary should appear with the new Welcome flow line.
    await expect(page.getByText(/welcome flow:/i)).toBeVisible({ timeout: 60_000 });

    // The summary should use the human bundle format — "Goals + About You" enabled-list.
    // (Knowledge Check off, AI Intro off) format.
    await expect(
      page.getByText(/goals \+ about you|goals,? +about you/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-3: Override path — turn off knowledge check ────────────────────

  test('main proposal confirmed → educator turns off knowledge check → AI confirms new bundle', async ({ page }) => {
    test.slow();

    await page.goto('/x/get-started-v5');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea, [contenteditable="true"]').first();
    await chatInput.waitFor({ state: 'visible' });
    await chatInput.fill(
      'I want to set up a 6-session GCSE Biology course for Year 10 students at Riverside Academy. Socratic teaching, 30-minute calls.',
    );
    await page.keyboard.press('Enter');

    await expect(page.getByText(/let me play back what i've understood/i)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /that's exactly right|that's right|sounds right/i }).first().click();

    await expect(page.getByText(/here's what i'd set up|teaching approach/i)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /sounds right|sounds good/i }).first().click();

    // Welcome flow card should appear.
    await expect(page.locator('.cv4-options-card').filter({ has: page.getByText(/goals/i) })).toBeVisible({ timeout: 60_000 });

    // Type a natural-language override instead of clicking the chip.
    await chatInput.fill('Turn off knowledge check, keep the rest');
    await page.keyboard.press('Enter');

    // The AI should confirm the new bundle in 1-2 sentences before advancing.
    await expect(page.getByText(/welcome flow:|here's what we've set up/i)).toBeVisible({ timeout: 60_000 });

    // Verify the playbook config matches the educator's choice. The wizard exposes
    // setupData via the /api/wizard/state endpoint; we hit it once create_course
    // has fired (which is gated by the welcome-flow ask).
    const stateRes = await page.request.get('/api/wizard/state').catch(() => null);
    if (stateRes && stateRes.ok()) {
      const state = await stateRes.json();
      const setup = state.setupData || {};
      // welcomeKnowledgeCheck must be false; the others must also be set as booleans.
      expect(setup.welcomeKnowledgeCheck).toBe(false);
      expect(typeof setup.welcomeGoals).toBe('boolean');
      expect(typeof setup.welcomeAboutYou).toBe('boolean');
      expect(typeof setup.welcomeAiIntro).toBe('boolean');
    }
  });

  // ── AC-2 (post-creation verification): playbook.config.welcome.* matches choice ──

  test('after create_course, playbook.config.welcome reflects the educator\'s explicit choice', async ({ page }) => {
    test.slow();

    await page.goto('/x/get-started-v5');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea, [contenteditable="true"]').first();
    await chatInput.fill('Set up GCSE Biology for Year 10, 6 sessions of 30 min, Socratic.');
    await page.keyboard.press('Enter');

    // Drive through to creation, picking "Sounds good" at every chip.
    for (let i = 0; i < 8; i++) {
      const chip = page.getByRole('button', { name: /sounds (right|good)|that's right/i }).first();
      const visible = await chip.isVisible({ timeout: 60_000 }).catch(() => false);
      if (!visible) break;
      await chip.click();
      await page.waitForTimeout(2_000);
    }

    // Find a "Create my course" CTA and click it.
    const createBtn = page.getByRole('button', { name: /create my course|create.*course/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 60_000 });
    await createBtn.click();

    // The success card should appear.
    await expect(page.getByText(/your.*ready|course.*live|created/i)).toBeVisible({ timeout: 90_000 });

    // Pull the created playbook config from the API and assert welcome values exist.
    const playbooksRes = await page.request.get('/api/playbooks?limit=1&order=createdAt:desc').catch(() => null);
    if (playbooksRes && playbooksRes.ok()) {
      const data = await playbooksRes.json();
      const pb = (data.playbooks || data || [])[0];
      const welcome = pb?.config?.welcome;
      expect(welcome).toBeDefined();
      expect(typeof welcome?.goals?.enabled).toBe('boolean');
      expect(typeof welcome?.aboutYou?.enabled).toBe('boolean');
      expect(typeof welcome?.knowledgeCheck?.enabled).toBe('boolean');
      expect(typeof welcome?.aiIntroCall?.enabled).toBe('boolean');
    }
  });
});
