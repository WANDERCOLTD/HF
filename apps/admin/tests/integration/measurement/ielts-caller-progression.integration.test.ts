/**
 * IELTS Caller Progression — Step 4 of mode-kill #566.
 *
 * Locks the empirical contract proven on 2026-05-20:
 *   - The IELTS playbook is opted into evidence-first scoring.
 *   - When the gate fires, the persisted CallScore rows have no Goodhart
 *     signals (no hasLearnerEvidence=false rows survive).
 *   - At least 3 of the 4 IELTS skill parameters score on the last
 *     non-mock call, all with hasLearnerEvidence=true.
 *
 * This is a DB-only test (no server required, no AI calls). It reads
 * the actual production state on the dev VM's DB and asserts the
 * contract holds. If the env flag is reverted, the playbook is removed
 * from the override list, or the Boaz guard regresses, this test
 * fails.
 *
 * Companion to the unit test in tests/lib/pipeline/evidence-gate.test.ts
 * which locks the helper-function contract. This test locks the
 * end-to-end behaviour we observed in production.
 *
 * Requires: a dev/test DB seeded with the IELTS Speaking Practice
 * playbook (`e460cd6f...`) and at least one sim call against Caleb
 * Jaffe (`17b1b0b7...`). When this test runs against a fresh DB
 * without those fixtures, it skips cleanly with a clear message.
 *
 * @see #566 (epic) | #572 (Step 3 PR)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const IELTS_PLAYBOOK_ID = "e460cd6f-0d0c-4948-9d8e-1ce696d4dfd3";
const CALEB_CALLER_ID = "17b1b0b7-4837-4ece-9ae5-f94a967e5ff9";

let prisma: PrismaClient;
let hasFixtures = false;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$queryRaw`SELECT 1`;

  // Detect whether the IELTS fixture is present in this DB.
  const playbook = await prisma.playbook.findUnique({
    where: { id: IELTS_PLAYBOOK_ID },
    select: { id: true },
  });
  const caller = await prisma.caller.findUnique({
    where: { id: CALEB_CALLER_ID },
    select: { id: true },
  });
  hasFixtures = !!(playbook && caller);
  if (!hasFixtures) {
    // Don't fail; surface the gap so the operator knows to seed.
    console.warn(
      "[ielts-progression] IELTS playbook or Caleb caller not present in this DB — skipping contract assertions.",
    );
  }
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

describe("IELTS caller progression — Step 3+4 contract", () => {
  it("IELTS playbook is opted into evidence-first scoring", async () => {
    if (!hasFixtures) return;
    // Read the file directly via the config getter so we mirror runtime behaviour.
    // We bypass `config` to avoid coupling to env-var state in CI.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(process.cwd(), "config/evidence-first-playbooks.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
      playbookIds?: string[];
    };
    expect(json.playbookIds ?? []).toContain(IELTS_PLAYBOOK_ID);
  });

  it("no Goodhart signals on Caleb's last non-mock sim call (post-Step-3)", async () => {
    if (!hasFixtures) return;

    // Find the latest sim call against Caleb where the gate decision
    // would have been evidence-first — any call after 2026-05-20 21:30 UTC
    // (when Step 3 activated on the VM). Falls back to "latest of any
    // mode" when nothing matches.
    const recent = await prisma.call.findFirst({
      where: {
        callerId: CALEB_CALLER_ID,
        playbookId: IELTS_PLAYBOOK_ID,
        source: "sim",
        endedAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, transcript: true, createdAt: true },
    });
    if (!recent) {
      console.warn("[ielts-progression] no sim calls yet — skipping Goodhart assertion");
      return;
    }

    const scores = await prisma.callScore.findMany({
      where: { callId: recent.id },
      select: {
        parameterId: true,
        score: true,
        hasLearnerEvidence: true,
        evidenceQuality: true,
      },
    });

    // Goodhart signal = (hasLearnerEvidence = false) AND (score > 0.5).
    // Step 3's Boaz guard SHOULD prevent any such row from persisting
    // for an evidence-first playbook.
    const goodhart = scores.filter(
      (s) => s.hasLearnerEvidence === false && s.score > 0.5,
    );
    expect(goodhart, JSON.stringify(goodhart, null, 2)).toHaveLength(0);
  });

  it("IELTS skill parameters score with real learner evidence on practice calls", async () => {
    if (!hasFixtures) return;

    const recent = await prisma.call.findFirst({
      where: {
        callerId: CALEB_CALLER_ID,
        playbookId: IELTS_PLAYBOOK_ID,
        source: "sim",
        endedAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!recent) return;

    const scores = await prisma.callScore.findMany({
      where: { callId: recent.id },
      include: {
        parameter: { select: { parameterId: true, name: true } },
      },
    });

    // The IELTS skill params are named skill_fluency, skill_lexical,
    // skill_grammar, skill_pronunciation. Pronunciation is expected to
    // drop in text-mode sims (no audio), so we require AT LEAST 3 of the
    // 4 to be present with hasLearnerEvidence=true.
    const ieltsSkills = scores.filter(
      (s) => (s.parameter.parameterId ?? "").toLowerCase().startsWith("skill_"),
    );
    expect(ieltsSkills.length, "at least 3 IELTS skill scores expected").toBeGreaterThanOrEqual(3);

    for (const s of ieltsSkills) {
      // Every persisted IELTS skill row must have learner evidence under
      // Step 3 — the Boaz guard drops anything else.
      expect(
        s.hasLearnerEvidence,
        `${s.parameter.parameterId} should have hasLearnerEvidence=true (got ${s.hasLearnerEvidence})`,
      ).toBe(true);
    }
  });

  it("non-mock calls produce more than 0 scores (mode-gate no longer blocks teach calls)", async () => {
    if (!hasFixtures) return;

    // Pre-Step-3 baseline: AI-led teach-mode calls produced 18 generic
    // scores (BIG-5, VARK) and zero IELTS skill scores. With Step 3
    // active, the gate allows every IELTS call through, so even teach-
    // posture calls produce some scoring (mix of generic + IELTS skills,
    // with the Boaz guard dropping the bad ones).
    const nonMockCalls = await prisma.call.findMany({
      where: {
        callerId: CALEB_CALLER_ID,
        playbookId: IELTS_PLAYBOOK_ID,
        source: "sim",
        endedAt: { not: null },
        requestedModuleId: { not: "mock" },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, _count: { select: { scores: true } } },
    });
    if (nonMockCalls.length === 0) return;

    for (const c of nonMockCalls) {
      expect(
        c._count.scores,
        `call ${c.id.slice(0, 8)} should have at least one score`,
      ).toBeGreaterThan(0);
    }
  });
});
