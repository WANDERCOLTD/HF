import { describe, it, expect } from "vitest";
import { computeNextBreadcrumbs, type EntityBreadcrumb } from "../EntityContext";

const playbook = (id: string, label = id): EntityBreadcrumb => ({
  type: "playbook",
  id,
  label,
});
const caller = (id: string, label = id): EntityBreadcrumb => ({
  type: "caller",
  id,
  label,
});
const call = (id: string, label = id): EntityBreadcrumb => ({
  type: "call",
  id,
  label,
});

describe("computeNextBreadcrumbs — dedupe by type across the whole stack", () => {
  it("returns the same array when the pushed entity already sits at the end", () => {
    const prev = [playbook("p1"), caller("c1")];
    const next = computeNextBreadcrumbs(prev, caller("c1"));
    expect(next).toBe(prev);
  });

  it("re-pushing an existing id moves it to the end and keeps co-present entities of other types", () => {
    // Behaviour change: the previous "slice-to-existing" rule dropped any
    // entries AFTER the re-pushed entity. That truncated the caller chip
    // when CallerDetailPage re-pushed the playbook the user came from
    // (publishedPlaybookId === current stack's playbook). Now: the
    // re-pushed entity moves to the end; entities of OTHER types stay.
    const prev = [playbook("p1"), caller("c1"), call("call-a")];
    const next = computeNextBreadcrumbs(prev, caller("c1"));
    expect(next.map((b) => b.id)).toEqual(["p1", "call-a", "c1"]);
  });

  it("REGRESSION: CallerDetailPage's caller-then-playbook push pattern keeps both chips even when the playbook is already in the stack", () => {
    // The exact failure mode that motivated this fix. User arrives at a
    // learner page from the playbook page → stack starts as [playbook p1].
    // CallerDetailPage pushes caller(c1) then playbook(p1).
    let stack: EntityBreadcrumb[] = [playbook("p1")];
    stack = computeNextBreadcrumbs(stack, caller("c1"));
    stack = computeNextBreadcrumbs(stack, playbook("p1"));
    expect(stack.map((b) => b.type)).toEqual(["caller", "playbook"]);
    expect(stack.find((b) => b.type === "caller")?.id).toBe("c1");
    expect(stack.find((b) => b.type === "playbook")?.id).toBe("p1");
  });

  it("REGRESSION: replaces an earlier same-type entity even when a different type is between (the doubled-chip bug)", () => {
    // The failing path: Course p1 → Learner c1 (publishedPlaybook p1) →
    // Learner c2 (publishedPlaybook p2). CallerDetailPage pushes caller-
    // then-playbook; the playbook push lands on a caller (different type)
    // and used to append. End state used to be
    // [playbook p1, caller c2, playbook p2] — two playbook chips.
    const prev = [playbook("p1"), caller("c2")];
    const next = computeNextBreadcrumbs(prev, playbook("p2"));
    expect(next.map((b) => b.id)).toEqual(["c2", "p2"]);
    // Caller stays, old playbook is gone, new playbook is on top.
    expect(next.filter((b) => b.type === "playbook")).toHaveLength(1);
  });

  it("REGRESSION: two-course-two-learner navigation never accumulates more than one chip per type", () => {
    // Simulate exactly the screenshot: visit Course A, Learner X on A,
    // Course B, Learner Y on B. Net invariant: 1 playbook + 1 caller.
    let stack: EntityBreadcrumb[] = [];
    // 1. Open Course A
    stack = computeNextBreadcrumbs(stack, playbook("course-A"));
    // 2. Open Learner X on Course A (CallerDetailPage pushes caller then publishedPlaybook)
    stack = computeNextBreadcrumbs(stack, caller("learner-X"));
    stack = computeNextBreadcrumbs(stack, playbook("course-A")); // publishedPlaybook same as current
    // 3. Open Course B
    stack = computeNextBreadcrumbs(stack, playbook("course-B"));
    // 4. Open Learner Y (publishedPlaybook B)
    stack = computeNextBreadcrumbs(stack, caller("learner-Y"));
    stack = computeNextBreadcrumbs(stack, playbook("course-B"));

    expect(stack.filter((b) => b.type === "playbook")).toHaveLength(1);
    expect(stack.filter((b) => b.type === "caller")).toHaveLength(1);
    expect(stack.find((b) => b.type === "playbook")?.id).toBe("course-B");
    expect(stack.find((b) => b.type === "caller")?.id).toBe("learner-Y");
  });

  it("keeps drill-down hierarchy: caller + call coexist as different types", () => {
    let stack: EntityBreadcrumb[] = [];
    stack = computeNextBreadcrumbs(stack, caller("c1"));
    stack = computeNextBreadcrumbs(stack, call("call-1"));
    expect(stack.map((b) => `${b.type}:${b.id}`)).toEqual(["caller:c1", "call:call-1"]);
  });

  it("replaces a call with a newer call when both are pushed in succession", () => {
    let stack: EntityBreadcrumb[] = [caller("c1"), call("call-1")];
    stack = computeNextBreadcrumbs(stack, call("call-2"));
    expect(stack.map((b) => `${b.type}:${b.id}`)).toEqual(["caller:c1", "call:call-2"]);
  });

  it("appends the first entity to an empty stack", () => {
    const next = computeNextBreadcrumbs([], playbook("p1"));
    expect(next).toEqual([playbook("p1")]);
  });

  it("Course A → Learner X drill-down keeps both (different types) with playbook chip preserved", () => {
    let stack: EntityBreadcrumb[] = [];
    stack = computeNextBreadcrumbs(stack, playbook("p1"));
    stack = computeNextBreadcrumbs(stack, caller("c1"));
    expect(stack.map((b) => b.type)).toEqual(["playbook", "caller"]);
  });
});
