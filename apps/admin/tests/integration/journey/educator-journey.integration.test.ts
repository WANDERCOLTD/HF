/**
 * Educator Journey Integration Test
 *
 * Validates the critical path still works end-to-end:
 *   1. Course exists (domain + playbook + subject + content source)
 *   2. Assertions extracted with correct shape
 *   3. Teaching points assigned to lesson plan sessions via learningOutcomeRefs
 *   4. Prompt composition produces valid Call 1 output with teaching content
 *   5. Prompt composition for Call 2 shows expected diff (memories, curriculum progress)
 *
 * Runs against real database (no mocks). No AI calls — fully deterministic.
 *
 * @see https://github.com/paw2paw/HF/issues/46
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  seedJourneyFixtures,
  cleanupJourneyFixtures,
  type JourneyFixtures,
} from "./fixtures";

// Direct library imports — no HTTP, no server required
import {
  executeComposition,
  loadComposeConfig,
  type CompositionResult,
} from "@/lib/prompt/composition";

const prisma = new PrismaClient();
let fixtures: JourneyFixtures;

beforeAll(async () => {
  // Verify DB connectivity
  await prisma.$queryRaw`SELECT 1`;

  // Verify specs exist (prerequisite: seed-from-specs)
  const composeSpec = await prisma.analysisSpec.findFirst({
    where: { outputType: "COMPOSE", isActive: true },
  });
  if (!composeSpec) {
    throw new Error(
      "COMPOSE spec not found. Run `npm run db:seed` before integration tests."
    );
  }

  fixtures = await seedJourneyFixtures(prisma);
}, 30_000);

afterAll(async () => {
  await cleanupJourneyFixtures(prisma);
  await prisma.$disconnect();
});

// ─── Step 1: Course Structure ────────────────────────────────────

describe("Step 1: Course exists with correct structure", () => {
  it("domain is active", async () => {
    const domain = await prisma.domain.findUnique({
      where: { id: fixtures.domainId },
    });
    expect(domain).toBeTruthy();
    expect(domain!.isActive).toBe(true);
  });

  it("playbook is PUBLISHED and linked to domain", async () => {
    const playbook = await prisma.playbook.findUnique({
      where: { id: fixtures.playbook.id },
      include: { items: true },
    });
    expect(playbook).toBeTruthy();
    expect(playbook!.status).toBe("PUBLISHED");
    expect(playbook!.domainId).toBe(fixtures.domainId);
    expect(playbook!.items.length).toBeGreaterThan(0);
  });

  it("subject is linked to domain and content source", async () => {
    const subjectDomain = await prisma.subjectDomain.findUnique({
      where: {
        subjectId_domainId: {
          subjectId: fixtures.subjectId,
          domainId: fixtures.domainId,
        },
      },
    });
    expect(subjectDomain).toBeTruthy();

    const subjectSource = await prisma.subjectSource.findFirst({
      where: {
        subjectId: fixtures.subjectId,
        sourceId: fixtures.sourceId,
      },
    });
    expect(subjectSource).toBeTruthy();
  });

  it("playbook is linked to subject (content scoping)", async () => {
    const playbookSubject = await prisma.playbookSubject.findUnique({
      where: {
        playbookId_subjectId: {
          playbookId: fixtures.playbook.id,
          subjectId: fixtures.subjectId,
        },
      },
    });
    expect(playbookSubject).toBeTruthy();
  });
});

// ─── Step 2: Assertions Extracted ────────────────────────────────

describe("Step 2: Assertions extracted with correct shape", () => {
  it("assertions exist for the content source", async () => {
    const assertions = await prisma.contentAssertion.findMany({
      where: { sourceId: fixtures.sourceId },
      orderBy: { orderIndex: "asc" },
    });

    expect(assertions.length).toBe(5);
    expect(fixtures.assertionIds.length).toBe(5);
  });

  it("each assertion has required fields", async () => {
    const assertions = await prisma.contentAssertion.findMany({
      where: { sourceId: fixtures.sourceId },
    });

    for (const a of assertions) {
      expect(a.assertion).toBeTruthy();
      expect(a.category).toBeTruthy();
      expect(["fact", "definition", "rule", "process", "example", "threshold"]).toContain(a.category);
      expect(a.tags.length).toBeGreaterThan(0);
      expect(a.learningOutcomeRef).toBeTruthy();
      expect(a.topicSlug).toBeTruthy();
      expect(a.teachMethod).toBeTruthy();
    }
  });

  it("assertions are linked to learning objectives", async () => {
    const linked = await prisma.contentAssertion.findMany({
      where: {
        sourceId: fixtures.sourceId,
        learningObjectiveId: { not: null },
      },
    });

    expect(linked.length).toBe(5);
  });
});

// ─── Step 3: TPs Assigned to Lesson Plan ─────────────────────────

describe("Step 3: Teaching points assigned to lesson plan sessions", () => {
  it("curriculum has a lesson plan with sessions", async () => {
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: fixtures.curriculum.id },
    });
    expect(curriculum).toBeTruthy();

    const deliveryConfig = curriculum!.deliveryConfig as any;
    expect(deliveryConfig).toBeTruthy();
    expect(deliveryConfig.lessonPlan).toBeTruthy();
    expect(deliveryConfig.lessonPlan.length).toBe(2);
  });

  it("each session has learningOutcomeRefs", async () => {
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: fixtures.curriculum.id },
    });
    const lessonPlan = (curriculum!.deliveryConfig as any).lessonPlan;

    for (const session of lessonPlan) {
      expect(session.learningOutcomeRefs).toBeTruthy();
      expect(session.learningOutcomeRefs.length).toBeGreaterThan(0);
    }
  });

  it("assertions can be filtered by session learningOutcomeRefs", async () => {
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: fixtures.curriculum.id },
    });
    const lessonPlan = (curriculum!.deliveryConfig as any).lessonPlan;

    const allAssertions = await prisma.contentAssertion.findMany({
      where: { sourceId: fixtures.sourceId },
    });

    // Session 1: BIO-LO1 → should match 3 assertions
    const session1Refs = lessonPlan[0].learningOutcomeRefs;
    const session1TPs = allAssertions.filter((a) =>
      session1Refs.some((ref: string) => a.learningOutcomeRef?.includes(ref))
    );
    expect(session1TPs.length).toBe(3);

    // Session 2: BIO-LO2 → should match 2 assertions
    const session2Refs = lessonPlan[1].learningOutcomeRefs;
    const session2TPs = allAssertions.filter((a) =>
      session2Refs.some((ref: string) => a.learningOutcomeRef?.includes(ref))
    );
    expect(session2TPs.length).toBe(2);

    // All TPs assigned — no orphans
    const allAssigned = new Set([...session1TPs, ...session2TPs].map((a) => a.id));
    expect(allAssigned.size).toBe(5);
  });

  it("curriculum has modules with learning objectives", async () => {
    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId: fixtures.curriculum.id },
      include: { learningObjectives: true },
    });

    expect(modules.length).toBeGreaterThan(0);

    const allLOs = modules.flatMap((m) => m.learningObjectives);
    expect(allLOs.length).toBe(2);
    expect(allLOs.map((lo) => lo.ref).sort()).toEqual(["BIO-LO1", "BIO-LO2"]);
  });
});

// ─── Step 4: Prompt Composition (Call 1) ─────────────────────────

describe("Step 4: Prompt composition produces valid output", () => {
  let composeResult: CompositionResult;

  beforeAll(async () => {
    const composeConfig = await loadComposeConfig({ forceFirstCall: true });
    composeResult = await executeComposition(
      fixtures.callerId,
      composeConfig.sections,
      { ...composeConfig.fullSpecConfig, forceFirstCall: true }
    );
  }, 15_000);

  it("composition succeeds with llmPrompt", () => {
    expect(composeResult).toBeTruthy();
    expect(composeResult.llmPrompt).toBeTruthy();
    expect(typeof composeResult.llmPrompt).toBe("object");
  });

  it("composition includes caller context", () => {
    expect(composeResult.callerContext).toBeTruthy();
    expect(typeof composeResult.callerContext).toBe("string");
    expect(composeResult.callerContext.length).toBeGreaterThan(0);
  });

  it("composition metadata reports activated sections", () => {
    expect(composeResult.metadata).toBeTruthy();
    expect(composeResult.metadata.sectionsActivated.length).toBeGreaterThan(0);
  });

  it("composition loaded caller data", () => {
    expect(composeResult.loadedData).toBeTruthy();
    expect(composeResult.loadedData.caller).toBeTruthy();
    expect(composeResult.loadedData.caller!.id).toBe(fixtures.callerId);
  });
});

// ─── Step 5: Prompt Diff (Call 1 vs Call 2) ──────────────────────

describe("Step 5: Call 2 prompt shows expected changes", () => {
  let call1Result: CompositionResult;
  let call2Result: CompositionResult;

  beforeAll(async () => {
    const composeConfig = await loadComposeConfig();

    // Call 1: force first-call mode
    call1Result = await executeComposition(
      fixtures.callerId,
      composeConfig.sections,
      { ...composeConfig.fullSpecConfig, forceFirstCall: true }
    );

    // Call 2: normal mode (caller has 1 call + memories)
    call2Result = await executeComposition(
      fixtures.callerId,
      composeConfig.sections,
      { ...composeConfig.fullSpecConfig, forceFirstCall: false }
    );
  }, 30_000);

  it("both compositions succeed", () => {
    expect(call1Result.llmPrompt).toBeTruthy();
    expect(call2Result.llmPrompt).toBeTruthy();
  });

  it("Call 2 has memories section (Call 1 may not)", () => {
    // The caller has memories from the fixture — Call 2 should include them
    const call2HasMemories =
      call2Result.metadata.sectionsActivated.includes("memories") ||
      call2Result.sections?.memories;

    // Memories should be present in Call 2 (we seeded 3 memories)
    if (call2Result.loadedData.memories) {
      expect(call2Result.loadedData.memories.length).toBeGreaterThan(0);
    }

    expect(call2HasMemories).toBeTruthy();
  });

  it("Call 2 has call history (Call 1 does not)", () => {
    const call2Calls = call2Result.loadedData.recentCalls;
    expect(call2Calls).toBeTruthy();

    if (Array.isArray(call2Calls)) {
      expect(call2Calls.length).toBeGreaterThan(0);
    }
  });

  it("section activation differs between calls", () => {
    const call1Sections = new Set(call1Result.metadata.sectionsActivated);
    const call2Sections = new Set(call2Result.metadata.sectionsActivated);

    // There should be some difference in activated sections
    // (e.g., first-call-only sections vs returning-caller sections)
    const onlyInCall1 = [...call1Sections].filter((s) => !call2Sections.has(s));
    const onlyInCall2 = [...call2Sections].filter((s) => !call1Sections.has(s));

    // Log the diff for debugging
    if (onlyInCall1.length > 0 || onlyInCall2.length > 0) {
      console.log("  Section diff:");
      if (onlyInCall1.length) console.log("    Only Call 1:", onlyInCall1);
      if (onlyInCall2.length) console.log("    Only Call 2:", onlyInCall2);
    }

    // At minimum, the prompt content should differ (different context loaded)
    expect(call1Result.callerContext).not.toBe(call2Result.callerContext);
  });

  it("prompt diff summary is computable", () => {
    // Compute a simple section-level diff
    const allKeys = new Set([
      ...Object.keys(call1Result.llmPrompt),
      ...Object.keys(call2Result.llmPrompt),
    ]);

    const diff: Record<string, "added" | "removed" | "changed" | "unchanged"> = {};
    for (const key of allKeys) {
      const inCall1 = key in call1Result.llmPrompt;
      const inCall2 = key in call2Result.llmPrompt;

      if (!inCall1 && inCall2) diff[key] = "added";
      else if (inCall1 && !inCall2) diff[key] = "removed";
      else if (JSON.stringify(call1Result.llmPrompt[key]) !== JSON.stringify(call2Result.llmPrompt[key]))
        diff[key] = "changed";
      else diff[key] = "unchanged";
    }

    // Log the diff for visibility
    const changes = Object.entries(diff).filter(([, status]) => status !== "unchanged");
    if (changes.length > 0) {
      console.log("  Prompt diff (Call 1 → Call 2):");
      for (const [key, status] of changes) {
        console.log(`    ${status === "added" ? "+" : status === "removed" ? "-" : "Δ"} ${key}`);
      }
    }

    // The prompts should not be identical — something must change between calls
    expect(changes.length).toBeGreaterThan(0);
  });
});
