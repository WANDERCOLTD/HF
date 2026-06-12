/**
 * Pins `lib/intake/hf-adapter/disclosure-store.ts::deriveDisclosureId` — the #1048
 * synthetic-id guard (documented in .claude/rules/ai-to-db-guard.md but previously
 * unpinned; audit HF-L).
 *
 * The load-bearing invariant: the DisclosureId is deterministic from
 * (intentId, requirementId) AND per-intent scoped. Determinism lets three independent
 * routes (bootstrap / acknowledge / signal) agree on the same row without threading
 * state; per-intent scoping prevents two concurrent EnrollmentIntake intents that emit
 * the same requirementId from colliding on a shared PK.
 */

import { describe, it, expect } from "vitest";
import { deriveDisclosureId } from "@/lib/intake/hf-adapter/disclosure-store";

describe("deriveDisclosureId — #1048 synthetic-id guard", () => {
  it("is deterministic for the same (intentId, requirementId)", () => {
    expect(deriveDisclosureId("intent-A", "req-1")).toBe(deriveDisclosureId("intent-A", "req-1"));
  });

  it("is per-intent scoped — same requirementId, different intent → different id", () => {
    expect(deriveDisclosureId("intent-A", "req-1")).not.toBe(deriveDisclosureId("intent-B", "req-1"));
  });

  it("distinguishes requirements within the same intent", () => {
    expect(deriveDisclosureId("intent-A", "req-1")).not.toBe(deriveDisclosureId("intent-A", "req-2"));
  });

  it("carries both components in the id (so it is debuggable + collision-resistant)", () => {
    const id = deriveDisclosureId("intent-A", "req-1");
    expect(id).toContain("intent-A");
    expect(id).toContain("req-1");
    expect(id.startsWith("disc_")).toBe(true);
  });
});
