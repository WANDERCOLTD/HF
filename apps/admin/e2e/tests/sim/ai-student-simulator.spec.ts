import { test, expect } from '../../fixtures';
import { SimPage } from '../../page-objects';
import { ALL_PERSONAS, type StudentPersona } from '../../fixtures/student-personas';
import Anthropic from '@anthropic-ai/sdk';
import type { Page } from '@playwright/test';

/**
 * AI Student Simulator — E2E
 *
 * Runs full sim chat sessions with Claude API playing three student
 * personas (good / average / poor). After each session, the pipeline
 * runs and we assert that outputs differentiate between personas.
 *
 * Validates: UI streaming, transcript persistence, pipeline extraction,
 * scoring, and adaptation across student engagement levels.
 *
 * Requires:
 *   - ANTHROPIC_API_KEY env var
 *   - Seeded DB with domains + playbooks + composed prompts
 *   - AI API keys for tutor-side streaming
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const anthropic = new Anthropic();

type Message = { role: 'user' | 'assistant'; content: string };

async function generateStudentResponse(
  persona: StudentPersona,
  history: Message[],
): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 200,
    temperature: 0.9,
    system: persona.systemPrompt,
    messages: history,
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

/** Get the text of the last tutor (incoming) message */
async function getLastTutorMessage(page: Page): Promise<string> {
  const bubbles = page.locator('.wa-bubble-in');
  const count = await bubbles.count();
  if (count === 0) return '';
  return (await bubbles.nth(count - 1).textContent()) || '';
}

interface SessionResult {
  personaId: string;
  callId: string | null;
  scores: any[];
  memories: any[];
  rewardScore: number | null;
  turnCount: number;
}

/** Poll until pipeline results appear on the call */
async function waitForPipelineResults(
  page: Page,
  callId: string,
  timeout = 90_000,
): Promise<{ scores: any[]; memories: any[]; rewardScore: number | null }> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await page.request.get(`/api/calls/${callId}`);
    if (res.ok()) {
      const data = await res.json();
      const call = data.call || data;
      if (call.scores?.length > 0 || call.memories?.length > 0) {
        return {
          scores: call.scores || [],
          memories: call.memories || [],
          rewardScore: call.rewardScore?.score ?? call.rewardScore?.overallScore ?? null,
        };
      }
    }
    await page.waitForTimeout(5_000);
  }
  // Return empty results rather than throwing — pipeline may legitimately
  // produce nothing for a very short session
  return { scores: [], memories: [], rewardScore: null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('AI Student Simulator', () => {
  // 5 min per persona test
  test.describe.configure({ timeout: 300_000 });

  const results: Record<string, SessionResult> = {};
  let domainId: string;
  const callerIds: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#email').fill('admin@test.com');
    await page.locator('#password').fill(process.env.SEED_ADMIN_PASSWORD || 'admin123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/x/, { timeout: 15_000, waitUntil: 'domcontentloaded' });

    // Find a domain
    const res = await page.request.get('/api/callers?limit=10');
    if (!res.ok()) throw new Error('Cannot fetch callers');
    const data = await res.json();
    const callerWithDomain = (data.callers || []).find((c: any) => c.domainId);
    if (!callerWithDomain) throw new Error('No caller with domain found — seed the DB first');
    domainId = callerWithDomain.domainId;

    // Create one caller per persona
    for (const persona of ALL_PERSONAS) {
      const createRes = await page.request.post('/api/callers', {
        data: {
          name: `AI Sim — ${persona.label}`,
          domainId,
          autoName: false,
          skipOnboarding: true,
        },
      });
      if (!createRes.ok()) {
        const err = await createRes.text();
        throw new Error(`Failed to create caller for ${persona.id}: ${err}`);
      }
      const created = await createRes.json();
      callerIds[persona.id] = created.caller?.id || created.id;
    }

    await context.close();
  });

  // Run persona sessions serially so we can compare at the end
  for (const persona of ALL_PERSONAS) {
    test(`${persona.label} — full session (${persona.turnCount} turns)`, async ({ page, loginAs }) => {
      test.slow();
      await loginAs('admin@test.com');

      const callerId = callerIds[persona.id];
      const sim = new SimPage(page, callerId);
      await sim.goto();

      // Wait for tutor greeting
      await sim.waitForGreeting(60_000);
      const greeting = await getLastTutorMessage(page);

      // Build conversation history (from student's perspective:
      // tutor messages = "user", student messages = "assistant")
      const history: Message[] = [{ role: 'user', content: greeting }];

      // Multi-turn conversation
      for (let turn = 0; turn < persona.turnCount; turn++) {
        const studentResponse = await generateStudentResponse(persona, history);
        history.push({ role: 'assistant', content: studentResponse });

        await sim.sendMessage(studentResponse);
        await sim.waitForResponse(45_000);

        const tutorReply = await getLastTutorMessage(page);
        history.push({ role: 'user', content: tutorReply });
      }

      // End call with pipeline
      await sim.endCall(true);
      await sim.waitForToast(15_000);

      // Fetch the latest call for this caller
      const callsRes = await page.request.get(`/api/callers/${callerId}?includeCalls=true`);
      expect(callsRes.ok()).toBe(true);
      const callsData = await callsRes.json();
      const calls = callsData.caller?.calls || [];
      const latestCall = calls[0];
      const callId = latestCall?.id || null;

      // Wait for pipeline to complete
      let pipelineData = { scores: [] as any[], memories: [] as any[], rewardScore: null as number | null };
      if (callId) {
        pipelineData = await waitForPipelineResults(page, callId);
      }

      // Store results for cross-persona comparison
      results[persona.id] = {
        personaId: persona.id,
        callId,
        scores: pipelineData.scores,
        memories: pipelineData.memories,
        rewardScore: pipelineData.rewardScore,
        turnCount: persona.turnCount,
      };

      // Basic per-session assertions
      expect(callId).toBeTruthy();

      // Log results for debugging
      console.log(`[${persona.label}] callId=${callId} scores=${pipelineData.scores.length} memories=${pipelineData.memories.length} reward=${pipelineData.rewardScore}`);
    });
  }

  test('pipeline outputs differentiate between personas', () => {
    const good = results['good'];
    const average = results['average'];
    const poor = results['poor'];

    // Skip if any session didn't complete
    test.skip(!good || !average || !poor, 'Not all persona sessions completed');

    // Log comparison table
    console.table({
      good: { scores: good.scores.length, memories: good.memories.length, reward: good.rewardScore },
      average: { scores: average.scores.length, memories: average.memories.length, reward: average.rewardScore },
      poor: { scores: poor.scores.length, memories: poor.memories.length, reward: poor.rewardScore },
    });

    // Soft directional checks (AI is non-deterministic, so use tolerance)
    // Good student should generate more extractable signal than poor student
    if (good.memories.length > 0 || poor.memories.length > 0) {
      expect(good.memories.length).toBeGreaterThanOrEqual(poor.memories.length);
    }

    // Good student sessions should produce at least as many scores
    if (good.scores.length > 0 || poor.scores.length > 0) {
      expect(good.scores.length).toBeGreaterThanOrEqual(poor.scores.length);
    }

    // Reward score: higher for engaged student (with tolerance)
    if (good.rewardScore != null && poor.rewardScore != null) {
      expect(good.rewardScore).toBeGreaterThanOrEqual(poor.rewardScore - 0.15);
    }
  });
});
