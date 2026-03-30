import { describe, it, expect } from "vitest";
import { WIZARD_GRAPH_NODES, AUTO_NODES, ALL_NODES } from "../graph-nodes";

// ── Structural invariants ────────────────────────────────

describe("graph-nodes structural validation", () => {
  it("has no duplicate keys", () => {
    const keys = ALL_NODES.map((n) => n.key);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it("all dependencies reference node keys or known blackboard keys", () => {
    const allKeys = new Set(ALL_NODES.map((n) => n.key));
    // Blackboard keys set by resolvers (not graph nodes, but valid dep targets)
    const resolverKeys = new Set(["draftDomainId", "draftInstitutionId"]);
    const validKeys = new Set([...allKeys, ...resolverKeys]);

    for (const node of ALL_NODES) {
      for (const dep of node.dependsOn) {
        const parts = dep.split("|");
        // At least one alternative must be a known key
        const anyKnown = parts.some((p) => validKeys.has(p));
        expect(anyKnown, `Node "${node.key}" dep "${dep}" has no known keys`).toBe(true);
      }
    }
  });

  it("has no circular dependencies (DAG check)", () => {
    // Build adjacency: node -> nodes it depends on
    const adjacency = new Map<string, Set<string>>();
    for (const node of ALL_NODES) {
      const deps = new Set<string>();
      for (const dep of node.dependsOn) {
        for (const part of dep.split("|")) deps.add(part);
      }
      adjacency.set(node.key, deps);
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function hasCycle(key: string): boolean {
      if (inStack.has(key)) return true;
      if (visited.has(key)) return false;
      visited.add(key);
      inStack.add(key);
      for (const dep of adjacency.get(key) ?? []) {
        if (hasCycle(dep)) return true;
      }
      inStack.delete(key);
      return false;
    }

    for (const key of adjacency.keys()) {
      expect(hasCycle(key), `Circular dependency detected involving "${key}"`).toBe(false);
    }
  });

  it("all required nodes have priority 1 or 2", () => {
    const required = WIZARD_GRAPH_NODES.filter((n) => n.required);
    for (const node of required) {
      expect(
        node.priority <= 2,
        `Required node "${node.key}" has priority ${node.priority} — should be 1 or 2`,
      ).toBe(true);
    }
  });

  it("every user-facing node has a non-empty promptHint", () => {
    for (const node of WIZARD_GRAPH_NODES) {
      expect(
        node.promptHint.length > 0,
        `User-facing node "${node.key}" has empty promptHint`,
      ).toBe(true);
    }
  });

  it("auto-resolved nodes have empty promptHint (never shown to AI as a question)", () => {
    for (const node of AUTO_NODES) {
      expect(
        node.promptHint,
        `Auto-resolved node "${node.key}" should have empty promptHint`,
      ).toBe("");
    }
  });

  it("every node has a valid group", () => {
    const validGroups = new Set(["institution", "course", "pedagogy", "content", "welcome", "tune"]);
    for (const node of ALL_NODES) {
      expect(
        validGroups.has(node.group),
        `Node "${node.key}" has invalid group "${node.group}"`,
      ).toBe(true);
    }
  });

  it("satisfiedAlso keys reference existing node keys", () => {
    const allKeys = new Set(ALL_NODES.map((n) => n.key));
    for (const node of ALL_NODES) {
      for (const alt of node.satisfiedAlso ?? []) {
        expect(
          allKeys.has(alt),
          `Node "${node.key}" satisfiedAlso references unknown key "${alt}"`,
        ).toBe(true);
      }
    }
  });

  it("WIZARD_GRAPH_NODES and AUTO_NODES partition ALL_NODES", () => {
    expect(WIZARD_GRAPH_NODES.length + AUTO_NODES.length).toBe(ALL_NODES.length);
  });
});

// ── Content invariants ──────────────────────────────────

describe("graph-nodes content checks", () => {
  it("has at least 3 required nodes for course launch", () => {
    const required = WIZARD_GRAPH_NODES.filter((n) => n.required);
    expect(required.length).toBeGreaterThanOrEqual(3);
  });

  it("courseName and interactionPattern are required", () => {
    const requiredKeys = WIZARD_GRAPH_NODES.filter((n) => n.required).map((n) => n.key);
    expect(requiredKeys).toContain("courseName");
    expect(requiredKeys).toContain("interactionPattern");
  });

  it("key course-specific nodes skip for COMMUNITY domains", () => {
    // These nodes MUST skip for communities — they don't apply to hubs
    const mustSkip = ["subjectDiscipline", "teachingMode", "lessonPlanModel"];
    for (const key of mustSkip) {
      const node = WIZARD_GRAPH_NODES.find((n) => n.key === key);
      if (node) {
        expect(
          node.skipWhen?.type === "community",
          `Course node "${key}" should skip for COMMUNITY domains`,
        ).toBe(true);
      }
    }
  });
});
