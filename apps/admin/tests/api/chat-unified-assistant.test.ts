/**
 * #1504 Slice 1 — Unified Assistant prompt builder (spike) — unit tests.
 *
 * Pins the 6 representative scenarios called out in the epic:
 *   1. Course tuning — operator asks to adjust welcome tone for a course
 *   2. Learner tuning — operator asks about a caller's progress + adjusts a target
 *   3. Content query — operator asks what's in the course curriculum
 *   4. Sim prep — operator asks to set up a test call
 *   5. Document lookup — operator asks about a spec or pipeline rule
 *   6. Error recovery — operator describes a broken course; AI suggests a fix
 *
 * Each scenario asserts:
 *   - the unified prompt builder produces a non-empty string
 *   - the intent-routing block hints correctly for the scope/context
 *   - the grounding contract is still present (the structural pin)
 *   - the tuning catalogue is always carried in (was per-mode in legacy)
 *
 * These tests pin the BUILDER, not the route handler. The route handler
 * uses the same builder when `HF_FLAG_UNIFIED_ASSISTANT=true` — wiring a
 * route-level test would require the full Next.js test harness; the
 * builder tests are the right boundary for spike-stage validation.
 *
 * NB: This file mocks the DB-touching helpers in `lib/chat/tuning-system-prompt.ts`,
 * `lib/terminology`, and `lib/chat/ticket-context.ts` so it runs without
 * Prisma. The factual-grounding intercept is structural (regex over the
 * assistant's text) — it is tested separately in
 * `tests/api/chat-factual-grounding.test.ts` (40 cases) and is NOT
 * re-tested here; this file only checks the prompt SHAPE the unified
 * builder produces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — keep this file Prisma-free.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prompts/spec-prompts", () => ({
  // Return the fallback (second arg) verbatim — we test the SHAPE of the
  // composed prompt, not the contents of the DB-backed spec.
  getPromptSpec: vi.fn(async (_slug: string, fallback: string) => fallback),
}));

vi.mock("@/lib/terminology", async () => {
  const actual = await vi.importActual<typeof import("@/lib/terminology")>("@/lib/terminology");
  return {
    ...actual,
    resolveTerminology: vi.fn(async () => actual.TECHNICAL_TERMS),
  };
});

vi.mock("@/lib/chat/tuning-system-prompt", () => ({
  // Return a stable sentinel containing the catalogue header so assertions
  // can confirm the block is carried in.
  buildTuningSystemPrompt: vi.fn(async ({ tuningScope }: { tuningScope?: string }) => {
    const scopeBlock = tuningScope
      ? `## Active Tuning Scope\n\n**${tuningScope}** — sentinel block from mock.`
      : `## Active Tuning Scope\n\n_No scope picked yet._`;
    return `[TUNING_PROMPT_SENTINEL]\n\n## Behaviour Parameter Catalogue\n\nBEH-WARMTH, BEH-CHALLENGE-LEVEL, BEH-FORMALITY (mock entries)\n\n${scopeBlock}`;
  }),
}));

vi.mock("@/lib/chat/ticket-context", () => ({
  loadTicketContext: vi.fn(async () => ({ ok: false })),
  loadRecentTicketsDigest: vi.fn(async () => "[FEEDBACK_LIST_DIGEST]"),
}));

vi.mock("@/lib/chat/page-feature-catalogue", () => ({
  buildPageFeatureCatalogue: vi.fn((route: string | undefined) =>
    route ? `\n\n## Page features (from PAGE_HELP_REGISTRY)\n\nMock catalogue for ${route}.` : "",
  ),
}));

// page-context already pure — import it as-is.

import {
  buildUnifiedAssistantPrompt,
  deriveIntentSignals,
  buildIntentRoutingBlock,
} from "@/lib/chat/unified-assistant-prompt";

beforeEach(() => {
  // #1504 Slice 2 — flag-gated path removed; the builder is now the default.
  // Leave any prior env var set by a sibling test untouched to avoid leaking
  // cross-suite state.
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario fixtures — match the epic's 6 representative scenarios.
// ─────────────────────────────────────────────────────────────────────────────

const PLAYBOOK_CRUMB = {
  type: "playbook",
  id: "pb_test_001",
  label: "IELTS Speaking Prep",
};

const CALLER_CRUMB = {
  type: "caller",
  id: "caller_test_001",
  label: "Brynn Sandoval",
};

const DOMAIN_CRUMB = {
  type: "domain",
  id: "domain_test_001",
  label: "Test Academy",
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Course tuning
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 1: Course tuning", () => {
  it("emits a course-scoped intent hint when on a course page with PLAYBOOK tuning scope", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [DOMAIN_CRUMB, PLAYBOOK_CRUMB],
      tuningScope: "PLAYBOOK",
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: { page: "course", params: { activeTab: "design" } },
      pageHintRoute: "/x/courses/pb_test_001",
    });

    expect(result.prompt).toBeTypeOf("string");
    expect(result.prompt.length).toBeGreaterThan(500);

    // Intent-routing block must hint course-scope + PLAYBOOK tuning
    expect(result.prompt).toContain("Intent routing");
    expect(result.prompt).toContain("course-scoped");
    expect(result.prompt).toContain("Course-tuning");
    expect(result.prompt).toContain('scope: "PLAYBOOK"');

    // Grounding contract present
    expect(result.prompt).toContain("Learner-scoped facts grounding contract");
    expect(result.prompt).toContain("get_caller_detail");

    // Tuning catalogue carried in
    expect(result.prompt).toContain("[TUNING_PROMPT_SENTINEL]");
    expect(result.prompt).toContain("Behaviour Parameter Catalogue");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Learner tuning
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 2: Learner tuning", () => {
  it("emits a learner-scoped intent hint when on a learner page with LEARNER tuning scope", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [DOMAIN_CRUMB, PLAYBOOK_CRUMB, CALLER_CRUMB],
      tuningScope: "LEARNER",
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: { page: "caller", params: {} },
      pageHintRoute: "/x/callers/caller_test_001",
    });

    expect(result.prompt).toContain("learner-scoped");
    expect(result.prompt).toContain("Learner-tuning");
    expect(result.prompt).toContain('scope: "LEARNER"');

    // Course-write tools still mentioned with a "WILL affect the whole cohort" warning
    expect(result.prompt).toContain("WILL affect this learner's whole cohort");

    // Entity context surfaces both the playbook AND the caller (with ids)
    expect(result.prompt).toContain("`id = caller_test_001`");
    expect(result.prompt).toContain("`id = pb_test_001`");

    // Grounding contract present
    expect(result.prompt).toContain("Learner-scoped facts grounding contract");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Content query
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 3: Content query", () => {
  it("includes course-edit tools in the hint when the operator is viewing a course", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [DOMAIN_CRUMB, PLAYBOOK_CRUMB],
      tuningScope: undefined,
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: { page: "course", params: { activeTab: "curriculum" } },
      pageHintRoute: "/x/courses/pb_test_001",
    });

    expect(result.prompt).toContain("course-scoped");
    // Curriculum / module read tools must be in the hint
    expect(result.prompt).toContain("list_curriculum_modules");
    expect(result.prompt).toContain("update_curriculum_module");

    // No tuning-scope hint — the toggle is not set
    expect(result.prompt).not.toContain("Course-tuning");
    expect(result.prompt).not.toContain("Learner-tuning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Sim prep
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 4: Sim prep", () => {
  it("falls back to a 'no specific scope' hint when no breadcrumb / page is set", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [],
      tuningScope: undefined,
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: undefined,
      pageHintRoute: "/x/sim",
    });

    expect(result.prompt).toContain("Intent routing");
    expect(result.prompt).toContain("No specific entity is in scope");
    expect(result.prompt).toContain("query_callers");
    expect(result.prompt).toContain("query_specs");

    // Empty entity context block still emitted with the 'navigate' nudge
    expect(result.prompt).toContain("No specific entity selected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 — Document / spec lookup
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 5: Document / spec lookup", () => {
  it("emits a general data-tools hint with no breadcrumb", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [],
      tuningScope: undefined,
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageHintRoute: "/x/specs",
    });

    // No specific scope → fallback general hint
    expect(result.prompt).toContain("No specific entity is in scope");

    // System overview / runtime context still present
    expect(result.prompt).toContain("Runtime context");
    expect(result.prompt).toContain("App version");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6 — Error recovery (broken course)
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 6: Error recovery (broken course)", () => {
  it("emits course-scoped + caller-aware hints when both are in context", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [DOMAIN_CRUMB, PLAYBOOK_CRUMB, CALLER_CRUMB],
      tuningScope: undefined,
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: { page: "course", params: { activeTab: "design" } },
      pageHintRoute: "/x/courses/pb_test_001",
    });

    // Both hints should be present
    expect(result.prompt).toContain("course-scoped");
    expect(result.prompt).toContain("learner-scoped");

    // Grounding contract still in
    expect(result.prompt).toContain("get_caller_detail");

    // Course-read tools mentioned
    expect(result.prompt).toContain("get_playbook_config");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7 — Cohort fan-out (added in Slice 2)
//
// Operator is viewing a learner page and says "fix this for her" while the
// tuningScope toggle is set to PLAYBOOK. The intent-routing block must warn
// that course-edit tools affect the whole cohort so the model asks before
// fanning out instead of silently rewriting the cohort's behaviour target.
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Assistant — Scenario 7: Cohort fan-out warning", () => {
  it("emits the 'WILL affect this learner's whole cohort' warning when on a learner page with PLAYBOOK scope", async () => {
    const result = await buildUnifiedAssistantPrompt({
      entityContext: [DOMAIN_CRUMB, PLAYBOOK_CRUMB, CALLER_CRUMB],
      tuningScope: "PLAYBOOK",
      userRole: "OPERATOR",
      institutionId: "inst_test",
      pageContext: { page: "caller", params: {} },
      pageHintRoute: "/x/callers/caller_test_001",
    });

    // Course-tuning scope warning surfaced even though the operator is on
    // the learner page — the toggle is the explicit signal.
    expect(result.prompt).toContain("Course-tuning");
    expect(result.prompt).toContain('scope: "PLAYBOOK"');

    // Learner context warning that course-edit tools fan out across the
    // whole cohort — the operator must confirm before that lands.
    expect(result.prompt).toContain("WILL affect this learner's whole cohort");

    // The "HINTS — not gates" disclaimer also surfaces so an explicit
    // cross-scope request still works.
    expect(result.prompt).toContain("HINTS — not gates");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intent signal derivation — explicit unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveIntentSignals", () => {
  it("detects course-in-scope via playbook breadcrumb", () => {
    const signals = deriveIntentSignals({
      entityContext: [PLAYBOOK_CRUMB],
    });
    expect(signals.hasCourseInScope).toBe(true);
    expect(signals.hasLearnerInScope).toBe(false);
  });

  it("detects course-in-scope via /x/courses/ page hint", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
      pageHintRoute: "/x/courses/abc",
    });
    expect(signals.onCoursePage).toBe(true);
    expect(signals.hasCourseInScope).toBe(true);
  });

  it("detects learner-in-scope via caller breadcrumb", () => {
    const signals = deriveIntentSignals({
      entityContext: [CALLER_CRUMB],
    });
    expect(signals.hasLearnerInScope).toBe(true);
  });

  it("detects learner-in-scope via /x/student/ page hint", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
      pageHintRoute: "/x/student/abc",
    });
    expect(signals.onLearnerPage).toBe(true);
    expect(signals.hasLearnerInScope).toBe(true);
  });

  it("maps tuningScope='LEARNER' to explicit-learner intent", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
      tuningScope: "LEARNER",
    });
    expect(signals.tuningIntent).toBe("explicit-learner");
  });

  it("maps tuningScope='PLAYBOOK' to explicit-course intent", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
      tuningScope: "PLAYBOOK",
    });
    expect(signals.tuningIntent).toBe("explicit-course");
  });

  it("maps undefined tuningScope to 'unset'", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
    });
    expect(signals.tuningIntent).toBe("unset");
  });

  it("maps null tuningScope to 'unset'", () => {
    const signals = deriveIntentSignals({
      entityContext: [],
      tuningScope: null,
    });
    expect(signals.tuningIntent).toBe("unset");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intent routing block rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIntentRoutingBlock", () => {
  it("emits the fallback hint when no signals are active", () => {
    const block = buildIntentRoutingBlock({
      hasCourseInScope: false,
      hasLearnerInScope: false,
      tuningIntent: "unset",
      onCoursePage: false,
      onLearnerPage: false,
    });
    expect(block).toContain("No specific entity is in scope");
    expect(block).toContain("query_callers");
  });

  it("emits course + learner-tuning hints when both are active", () => {
    const block = buildIntentRoutingBlock({
      hasCourseInScope: true,
      hasLearnerInScope: true,
      tuningIntent: "explicit-learner",
      onCoursePage: true,
      onLearnerPage: false,
    });
    expect(block).toContain("course-scoped");
    expect(block).toContain("learner-scoped");
    expect(block).toContain("Learner-tuning");
  });

  it("calls out HINTS-NOT-GATES so explicit cross-scope requests still work", () => {
    const block = buildIntentRoutingBlock({
      hasCourseInScope: true,
      hasLearnerInScope: false,
      tuningIntent: "unset",
      onCoursePage: true,
      onLearnerPage: false,
    });
    expect(block).toContain("HINTS — not gates");
  });
});
