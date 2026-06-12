/**
 * Adaptive Loop Canary — #1514 Slice 4 of epic #1510.
 *
 * THE PROOF GATE. Drives a real-engine call through the full pipeline and
 * asserts the chain closes:
 *
 *   EXTRACT → MEMORIES (LEARN) → AGGREGATE → CallerTarget → COMPOSE
 *
 * **Gate classification:**
 *
 * | Assertion | Gate | Action on failure |
 * | --- | --- | --- |
 * | EXTRACT: `CallScore.length >= 10` | hard FAIL | blocks deploy |
 * | LEARN: `CallerMemory.length > 0` (G9) | WARN (env-gated) | surfaces #1515 |
 * | AGGREGATE: `skill_* CallerTarget.currentScore > 0` (G2) | WARN | surfaces #1516 |
 * | COMPOSE: `key_memories` non-null | WARN | downstream of G9 |
 * | COMPOSE: `invariantErrors` empty | hard FAIL | I-C invariants tripped |
 *
 * Hard FAILs use vanilla `expect()`. WARN-gated assertions use
 * `expect.soft()` so the test process exits 0 with the gap surfaced in
 * the AppLog dashboard row (`pipeline.canary.run`). Flip
 * `HF_CANARY_WARN_ONLY=false` to promote the WARN gates to hard fails
 * (planned after the 2-week observation window per the epic plan).
 *
 * **Constraints honoured (per #1514 brief):**
 *
 *  - PURE READ + ASSERT — never modifies pipeline runner or invariant
 *    module.
 *  - I-AL3 is informational only — known broken until #1519 ships; the
 *    canary observes via the AppLog count but never blocks on it.
 *  - Fixture cleanup is non-negotiable — `cleanupCanaryFixture` runs in
 *    `afterAll` regardless of test outcome.
 *
 * **Run modes:**
 *
 *  - Local (against `npm run dev`):
 *      `TEST_API_URL=http://localhost:3000 ANTHROPIC_API_KEY=… \
 *       npm run test:canary`
 *  - hf-dev VM (preferred): SSH to the VM, then run the same command.
 *  - Without `ANTHROPIC_API_KEY`: the test SKIPS cleanly with a
 *    friendly message. The CI workflow only schedules the run on
 *    branches with the secret available.
 *
 * Companion: `tests/integration/journey/canary-fixture.integration.test.ts`
 * pins the fixture itself.
 *
 * @see docs/CHAIN-CONTRACTS.md §6 — invariant contracts
 * @see scripts/seed-system-behavior-defaults.ts — SYSTEM cascade root
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import {
  bootstrapCanaryFixture,
  cleanupCanaryFixture,
  CANARY_TRANSCRIPT,
  type CanaryFixture,
} from "./canary-fixture";

const prisma = new PrismaClient();

const API_BASE_URL = process.env.TEST_API_URL || "http://localhost:3000";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

const WARN_ONLY = process.env.HF_CANARY_WARN_ONLY !== "false"; // default true

const EXTRACT_FLOOR = 10; // canonical lower bound; not 50+ to leave room
                          // for spec evolution

let fixture: CanaryFixture | null = null;
let canRun = false;

interface CanaryGateRecord {
  gate: string;
  outcome: "PASS" | "WARN" | "FAIL" | "SKIP";
  detail: string;
}

const gateResults: CanaryGateRecord[] = [];

function recordGate(
  gate: string,
  outcome: CanaryGateRecord["outcome"],
  detail: string,
): void {
  gateResults.push({ gate, outcome, detail });
}

beforeAll(async () => {
  if (!ANTHROPIC_API_KEY) {
    console.warn(
      "[canary] ANTHROPIC_API_KEY not set — skipping real-engine canary. " +
        "The fixture self-tests still run; this case requires a live LLM.",
    );
    return;
  }

  // Probe the server before touching the DB.
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(
        `[canary] ${API_BASE_URL}/api/health returned ${res.status} — skipping. ` +
          "Start the server with `npm run dev` (or set TEST_API_URL to a live env).",
      );
      return;
    }
  } catch (err) {
    console.warn(
      `[canary] ${API_BASE_URL} unreachable (${(err as Error).message}) — skipping.`,
    );
    return;
  }

  if (!INTERNAL_API_SECRET) {
    console.warn(
      "[canary] INTERNAL_API_SECRET not set — pipeline route requires it for " +
        "the service-to-service path. Skipping.",
    );
    return;
  }

  await cleanupCanaryFixture(prisma);
  fixture = await bootstrapCanaryFixture(prisma);
  canRun = true;
});

afterAll(async () => {
  // Cleanup is non-negotiable per the #1514 brief — runs regardless of
  // test outcome.
  try {
    if (fixture) {
      await cleanupCanaryFixture(prisma);
    }
  } finally {
    // Write one AppLog row summarising the run so the
    // /x/help/pipeline-health "Latest canary run" panel can render it.
    if (canRun) {
      const passed = gateResults.filter((g) => g.outcome === "PASS").length;
      const failed = gateResults.filter((g) => g.outcome === "FAIL").length;
      const warns = gateResults.filter((g) => g.outcome === "WARN").length;
      try {
        // Prisma's `Json` input type doesn't admit a wider Record<string,
        // unknown>; cast the structured payload through a generic
        // marshal step before handing it to the create() call.
        const metadataPayload = JSON.parse(
          JSON.stringify({
            passed,
            failed,
            warns,
            gateResults,
            warnOnly: WARN_ONLY,
            apiBaseUrl: API_BASE_URL,
            observedAt: new Date().toISOString(),
          }),
        );
        await prisma.appLog.create({
          data: {
            type: "system",
            stage: "pipeline.canary.run",
            level: failed > 0 ? "error" : warns > 0 ? "warn" : "info",
            message: `Adaptive Loop canary — passed=${passed} failed=${failed} warns=${warns}`,
            metadata: metadataPayload,
          },
        });
      } catch (err) {
        console.warn(
          `[canary] Could not write AppLog summary: ${(err as Error).message}`,
        );
      }
    }
    await prisma.$disconnect();
  }
});

describe("#1514 Adaptive Loop canary — proves the chain closes", () => {
  it("real-engine call: EXTRACT → MEMORIES → AGGREGATE → CallerTarget → COMPOSE", { timeout: 180_000 }, async () => {
    if (!canRun || !fixture) {
      recordGate(
        "preflight",
        "SKIP",
        "ANTHROPIC_API_KEY / server / INTERNAL_API_SECRET prerequisites not met",
      );
      console.warn("[canary] preflight failed — see beforeAll output");
      return;
    }

    // ARRANGE — create the Call row directly. We mirror the shape the
    // production `createCallEnteringPipeline` builder writes (#1333 chain
    // contract Link 3): callerId + playbookId + curriculumModuleId all
    // populated. Skipping the builder lets the canary test stay PURE READ
    // on pipeline code while still producing the FK triple the pipeline
    // expects.
    const call = await prisma.call.create({
      data: {
        source: "canary-1514",
        externalId: `canary-1514-${Date.now()}`,
        callerId: fixture.callerId,
        playbookId: fixture.playbookId,
        curriculumModuleId: fixture.moduleId,
        transcript: CANARY_TRANSCRIPT,
      },
    });

    const callStartedAt = call.createdAt;

    // ACT — trigger the pipeline via the same service-to-service path
    // the VAPI webhook uses. Mode "prompt" runs all stages including
    // COMPOSE, which is the gate the canary cares about most.
    const pipelineRes = await fetch(
      `${API_BASE_URL}/api/calls/${call.id}/pipeline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_API_SECRET,
        },
        body: JSON.stringify({
          callerId: fixture.callerId,
          mode: "prompt",
          engine: "claude",
          force: true,
        }),
        // The pipeline is allowed to take a while (real LLM + multi-stage).
        signal: AbortSignal.timeout(180_000),
      },
    );

    const pipelineBody = await pipelineRes.json().catch(() => ({}));

    // The pipeline route returns 200 even for partial failures — it
    // surfaces them in `summary.composeFailed`. So we don't fail on a
    // non-200 unconditionally; we attach it to the FAIL detail.
    const pipelineOk = pipelineRes.ok;
    recordGate(
      "pipeline.http",
      pipelineOk ? "PASS" : "FAIL",
      `status=${pipelineRes.status} ok=${pipelineOk} composeFailed=${pipelineBody?.data?.composeFailed ?? "n/a"}`,
    );

    // ASSERT — read the post-state. Even a failed COMPOSE leaves
    // EXTRACT/AGGREGATE rows behind in the happy paths we want to verify.

    // ── Gate 1: EXTRACT — CallScore rows ─────────────────────
    const scores = await prisma.callScore.findMany({
      where: { callId: call.id },
      select: {
        id: true,
        parameterId: true,
        scoredBy: true,
        analysisSpecId: true,
      },
    });
    const scoreCount = scores.length;
    const hardFail1 = scoreCount < EXTRACT_FLOOR;
    recordGate(
      "extract.scores",
      hardFail1 ? "FAIL" : "PASS",
      `CallScore count=${scoreCount} floor=${EXTRACT_FLOOR}`,
    );
    // HARD FAIL — pipeline is broken if EXTRACT didn't write anything.
    expect(
      scoreCount,
      `EXTRACT wrote ${scoreCount} CallScore rows; expected >= ${EXTRACT_FLOOR}`,
    ).toBeGreaterThanOrEqual(EXTRACT_FLOOR);

    // ── Gate 1b: #1539 — every CallScore stamps analysisSpecId ─
    const unspecced = scores.filter((s) => !s.analysisSpecId);
    recordGate(
      "extract.spec-lineage",
      unspecced.length === 0 ? "PASS" : "FAIL",
      `unspecced=${unspecced.length}/${scoreCount} (#1539 contract: every CallScore carries analysisSpecId)`,
    );
    // HARD FAIL — if any CallScore row landed without lineage, the
    // chokepoint helper was bypassed. ESLint rule + writeCallScore
    // runtime guard SHOULD prevent this; the canary catches drift.
    expect(
      unspecced.length,
      `#1539 — ${unspecced.length} CallScore row(s) lack analysisSpecId. ` +
        `Every write must route through lib/measurement/write-call-score.ts. ` +
        `Sample: ${unspecced.slice(0, 3).map((s) => `${s.parameterId} (scoredBy=${s.scoredBy})`).join(", ")}`,
    ).toBe(0);

    // ── Gate 2 (WARN — G9 dependency): LEARN — CallerMemory ──
    const memories = await prisma.callerMemory.findMany({
      where: {
        callerId: fixture.callerId,
        createdAt: { gte: callStartedAt },
      },
      select: { id: true, key: true, category: true },
    });
    const memoryCount = memories.length;
    const memoriesOk = memoryCount > 0;
    recordGate(
      "learn.memories",
      memoriesOk ? "PASS" : "WARN",
      `CallerMemory count=${memoryCount}; > 0 expected. Tied to #1515.`,
    );
    if (WARN_ONLY) {
      expect
        .soft(
          memoryCount,
          `LEARN produced ${memoryCount} CallerMemory rows; expected > 0. Surfaces G9 / #1515.`,
        )
        .toBeGreaterThan(0);
    } else {
      expect(memoryCount).toBeGreaterThan(0);
    }

    // ── Gate 3 (WARN — G2 dependency): AGGREGATE — CallerTarget ──
    const skillTargets = await prisma.callerTarget.findMany({
      where: {
        callerId: fixture.callerId,
        parameterId: { startsWith: "skill_" },
        currentScore: { not: null },
      },
      select: { id: true, parameterId: true, currentScore: true },
    });
    const skillTargetCount = skillTargets.length;
    const targetsOk = skillTargetCount > 0;
    recordGate(
      "aggregate.skillTargets",
      targetsOk ? "PASS" : "WARN",
      `CallerTarget(skill_*, currentScore!=null) count=${skillTargetCount}; > 0 expected. Tied to #1516.`,
    );
    if (WARN_ONLY) {
      expect
        .soft(
          skillTargetCount,
          `AGGREGATE produced ${skillTargetCount} skill_* CallerTarget rows; expected > 0. Surfaces G2 / #1516.`,
        )
        .toBeGreaterThan(0);
    } else {
      expect(skillTargetCount).toBeGreaterThan(0);
    }

    // ── Gate 4 (WARN — downstream of G9): COMPOSE — key_memories ──
    const composed = await prisma.composedPrompt.findFirst({
      where: { callerId: fixture.callerId, status: "active" },
      orderBy: { composedAt: "desc" },
      select: { id: true, inputs: true },
    });
    const composedExists = !!composed;
    const inputs = (composed?.inputs as Record<string, unknown> | null) ?? {};
    const keyMemories = inputs.key_memories;
    const keyMemoriesArray = Array.isArray(keyMemories) ? keyMemories : [];
    const composeKeyMemoriesOk = composedExists && keyMemoriesArray.length > 0;
    recordGate(
      "compose.keyMemories",
      composeKeyMemoriesOk ? "PASS" : "WARN",
      `ComposedPrompt=${composedExists ? "present" : "missing"}; key_memories len=${keyMemoriesArray.length}`,
    );
    if (WARN_ONLY) {
      expect
        .soft(
          composedExists,
          "COMPOSE produced no active ComposedPrompt for the canary caller.",
        )
        .toBe(true);
      expect
        .soft(
          keyMemoriesArray.length,
          `ComposedPrompt.inputs.key_memories is empty (len=${keyMemoriesArray.length}). Downstream of G9.`,
        )
        .toBeGreaterThan(0);
    } else {
      expect(composedExists).toBe(true);
      expect(keyMemoriesArray.length).toBeGreaterThan(0);
    }

    // ── Gate 5: COMPOSE invariant errors (HARD FAIL) ─────────
    const invariantErrors =
      (inputs.invariantErrors as unknown[] | undefined) ?? [];
    recordGate(
      "compose.invariantErrors",
      invariantErrors.length === 0 ? "PASS" : "FAIL",
      `invariantErrors count=${invariantErrors.length}`,
    );
    expect(
      invariantErrors,
      `COMPOSE tripped invariant errors: ${JSON.stringify(invariantErrors)}`,
    ).toEqual([]);

    // ── Observability: count I-AL3 emits since the canary's call started ──
    // This is informational only — I-AL3 is known-broken until #1519
    // ships (the ContractRegistry.get typo). We log the count to the
    // AppLog summary row so trend-watchers can see it drop after #1519.
    const ial3Count = await prisma.appLog.count({
      where: {
        stage: "pipeline.invariant.i-al3",
        createdAt: { gte: callStartedAt },
      },
    });
    recordGate(
      "observe.iAL3",
      "PASS",
      `I-AL3 emits since call start: ${ial3Count}. Known-broken until #1519.`,
    );
  });

  it("mock-engine call: EXTRACT writes scores but NOT memories (by design)", async () => {
    if (!canRun || !fixture) {
      console.warn("[canary] preflight failed — skipping mock-engine case");
      return;
    }

    // Pin the route.ts:1029-1031 mock-engine carve-out: I-AL1 must NOT
    // fire for a mock call, even though the transcript is long enough to
    // pass the 200-char threshold. The CallScore.scoredBy marker
    // `mock_batched_v1` is what the invariant classifier reads.
    const mockCall = await prisma.call.create({
      data: {
        source: "canary-1514-mock",
        externalId: `canary-1514-mock-${Date.now()}`,
        callerId: fixture.callerId,
        playbookId: fixture.playbookId,
        curriculumModuleId: fixture.moduleId,
        transcript: CANARY_TRANSCRIPT,
      },
    });

    const startedAt = mockCall.createdAt;

    const res = await fetch(
      `${API_BASE_URL}/api/calls/${mockCall.id}/pipeline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_API_SECRET,
        },
        body: JSON.stringify({
          callerId: fixture.callerId,
          mode: "prep",
          engine: "mock",
          force: true,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    // Even mock can return non-200 if upstream stages fail for unrelated
    // reasons. We tolerate that for this case — what matters is the
    // mock-engine carve-out marker.
    const mockOk = res.ok;
    const mockScores = await prisma.callScore.findMany({
      where: { callId: mockCall.id },
      select: { scoredBy: true, parameterId: true },
    });
    const mockMarked = mockScores.filter((s) =>
      (s.scoredBy ?? "").startsWith("mock_"),
    );

    // Mock-engine writes scores with the `mock_batched_v1` marker —
    // verified at route.ts:1051 / 1072.
    recordGate(
      "mock.scoredByMarker",
      mockMarked.length > 0 ? "PASS" : "WARN",
      `mock_batched_v1 scoredBy rows=${mockMarked.length} / total=${mockScores.length} httpOk=${mockOk}`,
    );

    if (mockMarked.length === 0) {
      console.warn(
        "[canary] mock-engine wrote zero mock_-prefixed CallScore rows. " +
          "This is unusual but not a chain failure; the carve-out cannot be " +
          "asserted without the marker.",
      );
      return;
    }

    // CONTRACT: mock engine MUST NOT write CallerMemory rows.
    // I-AL1 is suppressed by the classifier when only mock_ rows are
    // present, so this assertion is the canary's structural pin of the
    // route.ts:1029-1031 design.
    const mockMemories = await prisma.callerMemory.count({
      where: {
        callerId: fixture.callerId,
        createdAt: { gte: startedAt },
      },
    });

    recordGate(
      "mock.zeroMemories",
      mockMemories === 0 ? "PASS" : "FAIL",
      `mock-engine memory writes=${mockMemories}; expected exactly 0`,
    );
    expect(
      mockMemories,
      `Mock engine wrote ${mockMemories} CallerMemory rows; expected 0 (route.ts:1029-1031 carve-out broken).`,
    ).toBe(0);
  });
});
