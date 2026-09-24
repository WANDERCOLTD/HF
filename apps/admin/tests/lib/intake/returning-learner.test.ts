/**
 * Unit tests for `lib/intake/returning-learner.ts::isReturningLearner` (#2050).
 *
 * The helper is the detection half of the `intakeSkipIfReturning`
 * JourneySettingContract consumer wired into
 * `app/api/student/survey-config/route.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { isReturningLearner } from "@/lib/intake/returning-learner";

function makePrismaMock(countResult: number) {
  return {
    callerAttribute: {
      count: vi.fn().mockResolvedValue(countResult),
    },
  };
}

describe("isReturningLearner", () => {
  it("returns false when no matching attributes exist (count = 0)", async () => {
    const mock = makePrismaMock(0);
    const result = await isReturningLearner(
      mock as unknown as Parameters<typeof isReturningLearner>[0],
      "caller-1",
    );
    expect(result).toBe(false);
  });

  it("returns true when at least one matching attribute exists (count = 1)", async () => {
    const mock = makePrismaMock(1);
    const result = await isReturningLearner(
      mock as unknown as Parameters<typeof isReturningLearner>[0],
      "caller-1",
    );
    expect(result).toBe(true);
  });

  it("returns true when multiple matching attributes exist (count = 5)", async () => {
    const mock = makePrismaMock(5);
    const result = await isReturningLearner(
      mock as unknown as Parameters<typeof isReturningLearner>[0],
      "caller-1",
    );
    expect(result).toBe(true);
  });

  it("queries the supplied callerId AND the canonical OR shape", async () => {
    const mock = makePrismaMock(0);
    await isReturningLearner(
      mock as unknown as Parameters<typeof isReturningLearner>[0],
      "caller-xyz",
    );
    expect(mock.callerAttribute.count).toHaveBeenCalledTimes(1);
    const arg = mock.callerAttribute.count.mock.calls[0][0];
    expect(arg.where.callerId).toBe("caller-xyz");
    // PERSONALITY/PRE_SURVEY submitted_at OR INTAKE_CHAT (any key).
    expect(arg.where.OR).toEqual([
      { scope: { in: ["PERSONALITY", "PRE_SURVEY"] }, key: "submitted_at" },
      { scope: "INTAKE_CHAT" },
    ]);
  });
});
