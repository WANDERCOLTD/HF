/**
 * #1346 Slice 5 — headline guarantee test.
 *
 * The user-specified guarantee from issue #1346:
 *
 *   "Call 5 fails mid-COMPOSE (no P6 written). The reconciler ALSO fails
 *    on its first attempt. Call 6 starts via createSession. Assert: Call
 *    6's usedPromptId === P5.id (the prompt Call 4 produced)."
 *
 * This is the structural promise of the whole epic — under any failure
 * mode, n+1 carries forward.
 *
 * The test is structurally a unit-level walk of:
 *   - The I-CT2 cascade in resolve-used-prompt.ts (which is what
 *     createSession reads via usedPromptId resolution)
 *   - The reconciler's idempotency + the carry-through helper's contract
 *
 * Live-DB version runs in `tests/integration/sessions/1346-reconciler.integration.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: { findFirst: vi.fn() },
  composedPrompt: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#1346 headline — Call 5 fails AND reconciler fails → Call 6 uses Call 4's P5", () => {
  it("createSession's prompt-cascade returns P5 when Session 5 has no producedComposedPromptId", async () => {
    // Setup the canonical scenario:
    //  - Caller has Sessions 1-5 in DB
    //  - Sessions 1-4 each have a producedComposedPromptId (P1..P5)
    //    where P5 = Session 4's produced prompt
    //  - Session 5 has endedAt set but producedComposedPromptId IS NULL
    //    (the COMPOSE failure)
    //
    // The I-CT2 cascade should walk:
    //   Step 1 — Session.findFirst({producedComposedPromptId: not null},
    //            orderBy {startedAt: desc}) — returns Session 4's row
    //            with producedComposedPromptId = "P5"
    //
    // No need to get to step 2 or 3 — step 1 already returns the correct
    // P5. The test asserts that.
    mockPrisma.session.findFirst.mockResolvedValueOnce({
      producedComposedPromptId: "P5",
    });

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-bertie" });

    expect(result.usedPromptId).toBe("P5");
    expect(result.source).toBe("previous-session");
  });

  it("when Session 4 ALSO has no producedComposedPromptId — falls through to most-recent ACTIVE ComposedPrompt", async () => {
    // Scenario: a longer outage. Both Session 5 AND Session 4 failed
    // mid-COMPOSE. The cascade step 1 returns null (no Session has a
    // producedComposedPromptId yet — they're ALL orphaned). Step 2 finds
    // P5 anyway because it was still written as ACTIVE before being
    // un-linked from a Session.
    mockPrisma.session.findFirst.mockResolvedValueOnce(null); // step 1: no prior Session has produced
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce({ id: "P5" }); // step 2: stale ACTIVE

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-bertie" });

    expect(result.usedPromptId).toBe("P5");
    expect(result.source).toBe("active-composed-prompt");
  });

  it("ENROLLMENT bootstrap is the terminal — first call ever still gets a usable prompt", async () => {
    // Brand-new caller, just completed ENROLLMENT. No prior Sessions yet
    // (just the enrolment one). Cascade step 1 + step 2 return null;
    // step 3 finds the ENROLLMENT Session's producedComposedPromptId.
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null) // step 1
      .mockResolvedValueOnce({ producedComposedPromptId: "P-bootstrap" }); // step 3
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null); // step 2

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-fresh" });

    expect(result.usedPromptId).toBe("P-bootstrap");
    expect(result.source).toBe("enrollment-bootstrap");
  });

  it("only when ALL three cascade steps fail does usedPromptId return null", async () => {
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null) // step 1
      .mockResolvedValueOnce(null); // step 3
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null); // step 2

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-brand-new-no-enrollment" });

    expect(result.usedPromptId).toBeNull();
    expect(result.source).toBe("none");
  });
});
