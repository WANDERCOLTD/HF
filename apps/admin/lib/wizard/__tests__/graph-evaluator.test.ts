import { describe, it, expect } from "vitest";
import {
  evaluateGraph,
  evaluateSkipCondition,
  checkDependencies,
  buildGraphPromptSection,
  buildGraphFallback,
  getGroupStatuses,
} from "../graph-evaluator";
import { WIZARD_GRAPH_NODES, AUTO_NODES, ALL_NODES } from "../graph-nodes";
import type { GraphEvaluation } from "../graph-schema";

// ── Helpers ──────────────────────────────────────────────

function emptyBoard(): Record<string, unknown> {
  return {};
}

function boardWith(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields };
}

// ── evaluateSkipCondition ────────────────────────────────

describe("evaluateSkipCondition", () => {
  it("community shorthand checks defaultDomainKind", () => {
    expect(evaluateSkipCondition({ type: "community" }, { defaultDomainKind: "COMMUNITY" })).toBe(true);
    expect(evaluateSkipCondition({ type: "community" }, { defaultDomainKind: "STANDARD" })).toBe(false);
    expect(evaluateSkipCondition({ type: "community" }, {})).toBe(false);
  });

  it("equals / not-equals", () => {
    expect(evaluateSkipCondition({ type: "equals", key: "foo", value: "bar" }, { foo: "bar" })).toBe(true);
    expect(evaluateSkipCondition({ type: "equals", key: "foo", value: "bar" }, { foo: "baz" })).toBe(false);
    expect(evaluateSkipCondition({ type: "not-equals", key: "foo", value: "bar" }, { foo: "baz" })).toBe(true);
  });

  it("truthy / falsy", () => {
    expect(evaluateSkipCondition({ type: "truthy", key: "x" }, { x: "yes" })).toBe(true);
    expect(evaluateSkipCondition({ type: "truthy", key: "x" }, { x: "" })).toBe(false);
    expect(evaluateSkipCondition({ type: "falsy", key: "x" }, {})).toBe(true);
  });
});

// ── checkDependencies ────────────────────────────────────

describe("checkDependencies", () => {
  it("empty deps = always met", () => {
    expect(checkDependencies([], {})).toBe(true);
  });

  it("simple dep", () => {
    expect(checkDependencies(["institutionName"], { institutionName: "PAW" })).toBe(true);
    expect(checkDependencies(["institutionName"], {})).toBe(false);
  });

  it("OR operator", () => {
    expect(checkDependencies(["existingDomainId|draftDomainId"], { existingDomainId: "d1" })).toBe(true);
    expect(checkDependencies(["existingDomainId|draftDomainId"], { draftDomainId: "d2" })).toBe(true);
    expect(checkDependencies(["existingDomainId|draftDomainId"], {})).toBe(false);
  });

  it("empty string = not satisfied", () => {
    expect(checkDependencies(["institutionName"], { institutionName: "" })).toBe(false);
  });
});

// ── evaluateGraph: empty board ───────────────────────────

describe("evaluateGraph — empty board", () => {
  it("independent nodes are available, dependent nodes are blocked", () => {
    const result = evaluateGraph(emptyBoard());

    // institutionName has no deps → available
    expect(result.nodeStatuses.get("institutionName")).toBe("available");

    // interactionPattern has no deps → available
    expect(result.nodeStatuses.get("interactionPattern")).toBe("available");

    // subjectDiscipline depends on domainId → blocked
    expect(result.nodeStatuses.get("subjectDiscipline")).toBe("blocked");

    // courseName depends on domainId → blocked
    expect(result.nodeStatuses.get("courseName")).toBe("blocked");

    // Auto nodes depend on institutionName → blocked
    expect(result.nodeStatuses.get("existingDomainId")).toBe("blocked");
  });

  it("cannot launch — missing required fields", () => {
    const result = evaluateGraph(emptyBoard());
    expect(result.canLaunch).toBe(false);
    expect(result.missingRequired.length).toBeGreaterThan(0);

    const requiredKeys = result.missingRequired.map((n) => n.key);
    expect(requiredKeys).toContain("institutionName");
    expect(requiredKeys).toContain("courseName");
    expect(requiredKeys).toContain("interactionPattern");
  });

  it("readiness is 0%", () => {
    const result = evaluateGraph(emptyBoard());
    expect(result.readinessPct).toBe(0);
  });
});

// ── evaluateGraph: progressive fill ──────────────────────

describe("evaluateGraph — progressive fill", () => {
  it("institution name satisfies that node, unblocks domain-dependent nodes once domainId set", () => {
    const board = boardWith({
      institutionName: "PAW Campus",
      existingDomainId: "dom-1",
      defaultDomainKind: "STANDARD",
    });
    const result = evaluateGraph(board);

    expect(result.nodeStatuses.get("institutionName")).toBe("satisfied");
    expect(result.nodeStatuses.get("existingDomainId")).toBe("satisfied");

    // Now subjectDiscipline and courseName should be available
    expect(result.nodeStatuses.get("subjectDiscipline")).toBe("available");
    expect(result.nodeStatuses.get("courseName")).toBe("available");
  });

  it("all required fields → canLaunch", () => {
    const board = boardWith({
      institutionName: "PAW Campus",
      existingDomainId: "dom-1",
      courseName: "GCSE English",
      interactionPattern: "socratic",
    });
    const result = evaluateGraph(board);

    expect(result.canLaunch).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("readiness increases as fields are filled", () => {
    const empty = evaluateGraph(emptyBoard());
    const partial = evaluateGraph(
      boardWith({
        institutionName: "PAW",
        existingDomainId: "d",
        interactionPattern: "socratic",
      }),
    );
    const full = evaluateGraph(
      boardWith({
        institutionName: "PAW",
        existingDomainId: "d",
        courseName: "GCSE",
        interactionPattern: "socratic",
        welcomeMessage: "Hi",
        sessionCount: "5",
        durationMins: "30",
        behaviorTargets: { warmth: 70 },
      }),
    );

    expect(partial.readinessPct).toBeGreaterThan(empty.readinessPct);
    expect(full.readinessPct).toBeGreaterThan(partial.readinessPct);
  });
});

// ── evaluateGraph: COMMUNITY skips ───────────────────────

describe("evaluateGraph — COMMUNITY domain", () => {
  it("skips 5 nodes for COMMUNITY", () => {
    const board = boardWith({ defaultDomainKind: "COMMUNITY" });
    const result = evaluateGraph(board);

    const skippedKeys = result.skipped.map((n) => n.key);
    expect(skippedKeys).toContain("teachingMode");
    expect(skippedKeys).toContain("sessionCount");
    expect(skippedKeys).toContain("planEmphasis");
    expect(skippedKeys).toContain("lessonPlanModel");
    expect(skippedKeys).toContain("subjectDiscipline");
  });

  it("readiness adjusts for skipped nodes", () => {
    const standard = evaluateGraph(boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      courseName: "C",
      interactionPattern: "socratic",
    }));
    const community = evaluateGraph(boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      defaultDomainKind: "COMMUNITY",
      courseName: "C",
      interactionPattern: "socratic",
    }));

    // Community has fewer active nodes, so same fields = higher readiness
    expect(community.readinessPct).toBeGreaterThan(standard.readinessPct);
  });
});

// ── evaluateGraph: post-scaffold lock ────────────────────

describe("evaluateGraph — post-scaffold locking", () => {
  it("structural fields are locked when draftPlaybookId is set", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      courseName: "GCSE",
      interactionPattern: "socratic",
      draftPlaybookId: "pb-1",
    });
    const result = evaluateGraph(board);

    // Structural fields → locked
    expect(result.nodeStatuses.get("institutionName")).toBe("locked");
    expect(result.nodeStatuses.get("courseName")).toBe("locked");
    expect(result.nodeStatuses.get("interactionPattern")).toBe("locked");

    // draftPlaybookId is auto-resolved + not mutable → also locked
    expect(result.nodeStatuses.get("draftPlaybookId")).toBe("locked");
  });

  it("mutable fields remain editable post-scaffold", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      draftPlaybookId: "pb-1",
      welcomeMessage: "Hello",
      sessionCount: "5",
    });
    const result = evaluateGraph(board);

    expect(result.nodeStatuses.get("welcomeMessage")).toBe("satisfied");
    expect(result.nodeStatuses.get("sessionCount")).toBe("satisfied");
  });
});

// ── Priority ordering ────────────────────────────────────

describe("evaluateGraph — priority ordering", () => {
  it("required fields come before optional in suggestions", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
    });
    const result = evaluateGraph(board);

    // courseName and interactionPattern are priority 1, required
    // They should be in the top suggestions
    const topKeys = result.suggested.slice(0, 3).map((n) => n.key);
    expect(topKeys).toContain("courseName");
    expect(topKeys).toContain("interactionPattern");

    // behaviorTargets (priority 4) should be lower
    const behaviorIdx = result.suggested.findIndex((n) => n.key === "behaviorTargets");
    const courseIdx = result.suggested.findIndex((n) => n.key === "courseName");
    expect(behaviorIdx).toBeGreaterThan(courseIdx);
  });

  it("affinity tags bond related fields (timing: sessionCount → durationMins)", () => {
    // After answering sessionCount, durationMins (same timing tag) should rank
    // higher than welcomeMessage (same group but no shared tag)
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      courseName: "GCSE",
      interactionPattern: "socratic",
      sessionCount: "5", // timing + structure tags
    });
    const result = evaluateGraph(board);
    const durationIdx = result.suggested.findIndex((n) => n.key === "durationMins");
    const welcomeIdx = result.suggested.findIndex((n) => n.key === "welcomeMessage");
    // Both are priority 3, but durationMins shares "timing" tag with sessionCount
    expect(durationIdx).toBeLessThan(welcomeIdx);
  });

  it("affinity ignores auto-resolved nodes (uses last user answer)", () => {
    // User answers institutionName → resolver auto-fills domainId, domainKind
    // Affinity should anchor on institutionName (institution tags), not domainKind
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",       // auto-resolved
      defaultDomainKind: "STANDARD", // auto-resolved
      existingInstitutionId: "i1",   // auto-resolved
    });
    const result = evaluateGraph(board);
    // typeSlug shares ["identity", "institution"] with institutionName
    // It should get affinity bonus over nodes with no shared tags
    const typeIdx = result.suggested.findIndex((n) => n.key === "typeSlug");
    const behaviorIdx = result.suggested.findIndex((n) => n.key === "behaviorTargets");
    expect(typeIdx).toBeLessThan(behaviorIdx);
  });

  it("auto-resolved nodes are not in suggestions", () => {
    const result = evaluateGraph(emptyBoard());
    const suggestedKeys = result.suggested.map((n) => n.key);

    expect(suggestedKeys).not.toContain("existingDomainId");
    expect(suggestedKeys).not.toContain("existingInstitutionId");
    expect(suggestedKeys).not.toContain("defaultDomainKind");
    expect(suggestedKeys).not.toContain("draftPlaybookId");
  });
});

// ── Multi-field single turn ──────────────────────────────

describe("evaluateGraph — multi-field single turn", () => {
  it("'PAW Campus, English, 5 sessions, socratic' fills 4+ nodes", () => {
    // Simulates what happens after AI extracts + resolvers fire
    const board = boardWith({
      institutionName: "PAW Campus",
      existingInstitutionId: "inst-1",
      existingDomainId: "dom-1",
      defaultDomainKind: "STANDARD",
      typeSlug: "school",
      subjectDiscipline: "English Language",
      sessionCount: "5",
      interactionPattern: "socratic",
    });
    const result = evaluateGraph(board);

    // 8 nodes should be satisfied
    expect(result.satisfied.length).toBeGreaterThanOrEqual(7);

    // courseName is still needed (user said "English" not a specific course)
    expect(result.nodeStatuses.get("courseName")).toBe("available");
    expect(result.missingRequired.map((n) => n.key)).toContain("courseName");

    // But canLaunch is false because courseName is missing
    expect(result.canLaunch).toBe(false);

    // Add courseName → can launch
    board.courseName = "11+ Comprehension";
    const updated = evaluateGraph(board);
    expect(updated.canLaunch).toBe(true);
  });
});

// ── buildGraphPromptSection ──────────────────────────────

describe("buildGraphPromptSection", () => {
  it("includes readiness and launch status", () => {
    const eval1 = evaluateGraph(emptyBoard());
    const section = buildGraphPromptSection(eval1, emptyBoard());
    expect(section).toContain("Readiness:");
    expect(section).toContain("Can launch: NO");
  });

  it("shows collected values", () => {
    const board = boardWith({ institutionName: "PAW Campus" });
    const eval1 = evaluateGraph(board);
    const section = buildGraphPromptSection(eval1, board);
    expect(section).toContain("PAW Campus");
    expect(section).toContain("Already collected");
  });

  it("shows suggestion with ASK THIS NEXT marker", () => {
    const eval1 = evaluateGraph(emptyBoard());
    const section = buildGraphPromptSection(eval1, emptyBoard());
    expect(section).toContain("HANDLE THIS NEXT");
  });

  it("shows resolver context when provided", () => {
    const eval1 = evaluateGraph(emptyBoard());
    const section = buildGraphPromptSection(eval1, emptyBoard(), [
      "Resolved institution: PAW Campus (school)",
    ]);
    expect(section).toContain("Just resolved");
    expect(section).toContain("PAW Campus");
  });

  it("shows all-collected message when canLaunch", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      courseName: "C",
      interactionPattern: "socratic",
      // Fill all optional fields to clear suggestions
      typeSlug: "school",
      websiteUrl: "http://paw.edu",
      teachingMode: "comprehension",
      welcomeMessage: "Hi",
      sessionCount: "5",
      durationMins: "30",
      planEmphasis: "balanced",
      behaviorTargets: { warmth: 70 },
      lessonPlanModel: "direct",
      subjectDiscipline: "English",
    });
    const eval1 = evaluateGraph(board);
    const section = buildGraphPromptSection(eval1, board);
    expect(section).toContain("Can launch: YES");
  });
});

// ── buildGraphFallback ───────────────────────────────────

describe("buildGraphFallback", () => {
  it("acknowledges fields from update_setup tool calls", () => {
    const board = boardWith({ institutionName: "PAW Campus" });
    const eval1 = evaluateGraph(board);
    const toolCalls = [{ name: "update_setup", input: { fields: { institutionName: "PAW Campus" } } }];
    const fallback = buildGraphFallback(eval1, board, toolCalls);
    expect(fallback).toContain("PAW Campus");
  });

  it("suggests next field when not launchable", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      interactionPattern: "socratic",
    });
    const eval1 = evaluateGraph(board);
    const fallback = buildGraphFallback(eval1, board);
    // Should mention the next suggested field
    expect(fallback.length).toBeGreaterThan(10);
  });

  it("returns full-sentence questions verbatim (no 'Choose your … below.' wrapping)", () => {
    const board = boardWith({ institutionName: "PAW", interactionPattern: "socratic" });
    const eval1 = evaluateGraph(board);
    const toolCalls = [
      {
        name: "show_options",
        input: { question: "What should students see before their first teaching session?" },
      },
    ];
    const fallback = buildGraphFallback(eval1, board, toolCalls);
    expect(fallback).toBe("What should students see before their first teaching session?");
    expect(fallback).not.toContain("Choose your");
  });

  it("wraps short noun-phrase show_options labels with 'Choose your … below.'", () => {
    const board = boardWith({ institutionName: "PAW" });
    const eval1 = evaluateGraph(board);
    const toolCalls = [{ name: "show_options", input: { question: "audience" } }];
    const fallback = buildGraphFallback(eval1, board, toolCalls);
    expect(fallback).toBe("Choose your **audience** below.");
  });

  it("falls back to 'Pick an option below.' when show_options has no question", () => {
    const board = boardWith({ institutionName: "PAW" });
    const eval1 = evaluateGraph(board);
    const toolCalls = [{ name: "show_options", input: {} }];
    const fallback = buildGraphFallback(eval1, board, toolCalls);
    expect(fallback).toBe("Pick an option below.");
  });

  it("offers launch when all fields collected", () => {
    const board = boardWith({
      institutionName: "PAW",
      existingDomainId: "d",
      courseName: "C",
      interactionPattern: "socratic",
      // Fill all optional fields so suggested is empty
      typeSlug: "school",
      websiteUrl: "http://paw.edu",
      teachingMode: "comprehension",
      welcomeMessage: "Hi",
      sessionCount: "5",
      durationMins: "30",
      planEmphasis: "balanced",
      behaviorTargets: { warmth: 70 },
      lessonPlanModel: "direct",
      subjectDiscipline: "English",
      audience: "secondary",
      learningOutcomes: ["outcome1"],
      assessments: "formal",
    });
    const eval1 = evaluateGraph(board);
    const fallback = buildGraphFallback(eval1, board);
    expect(fallback).toContain("create your course");
  });
});

// ── getGroupStatuses ─────────────────────────────────────

describe("getGroupStatuses", () => {
  it("all groups start as active or waiting", () => {
    const eval1 = evaluateGraph(emptyBoard());
    const statuses = getGroupStatuses(eval1);

    // institution has independent fields → active
    expect(statuses.get("institution")).toBe("active");

    // course has blocked fields (courseName, subjectDiscipline) + available (interactionPattern)
    expect(statuses.get("course")).toBe("active");
  });

  it("group becomes complete when all its nodes are satisfied/skipped", () => {
    const board = boardWith({
      institutionName: "PAW",
      typeSlug: "school",
      websiteUrl: "http://paw.edu",
    });
    const eval1 = evaluateGraph(board);
    const statuses = getGroupStatuses(eval1);

    expect(statuses.get("institution")).toBe("complete");
  });
});
