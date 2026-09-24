/**
 * runtime-gates — pure-helper unit tests for the 3 #2056 runtime gates.
 *
 * Covers:
 *  - `isAgentTunerNlpEnabled`: opt-in (undefined/false → off; true → on).
 *  - `resolveCallCountPolicy`: enum coercion + default to "unlimited".
 *  - `getMaxCallsPerDay`: nullish / 0 / negative / NaN → null; positive
 *    real → integer floor.
 *  - `evaluateCallRateLimit`: 5 cases — unlimited / cap-null / under /
 *    soft-cap-hit / hard-cap-block.
 *  - `CallRateLimitError`: code + carried fields.
 */

import { describe, it, expect } from "vitest";
import {
  CallRateLimitError,
  evaluateCallRateLimit,
  getMaxCallsPerDay,
  isAgentTunerNlpEnabled,
  resolveCallCountPolicy,
} from "@/lib/journey/runtime-gates";
import type { PlaybookConfig } from "@/lib/types/json-fields";

describe("isAgentTunerNlpEnabled", () => {
  it("returns false when config is null", () => {
    expect(isAgentTunerNlpEnabled(null)).toBe(false);
  });

  it("returns false when config is undefined", () => {
    expect(isAgentTunerNlpEnabled(undefined)).toBe(false);
  });

  it("returns false when agentTunerNlpEnabled is unset", () => {
    expect(isAgentTunerNlpEnabled({} as PlaybookConfig)).toBe(false);
  });

  it("returns false when agentTunerNlpEnabled is explicitly false", () => {
    expect(
      isAgentTunerNlpEnabled({ agentTunerNlpEnabled: false } as PlaybookConfig),
    ).toBe(false);
  });

  it("returns true when agentTunerNlpEnabled is explicitly true", () => {
    expect(
      isAgentTunerNlpEnabled({ agentTunerNlpEnabled: true } as PlaybookConfig),
    ).toBe(true);
  });

  it("treats non-boolean truthy values as not enabled (strict equality)", () => {
    // Guards against accidental string "true" / number 1 reaching the runtime.
    expect(
      isAgentTunerNlpEnabled({
        agentTunerNlpEnabled: "true" as unknown as boolean,
      } as PlaybookConfig),
    ).toBe(false);
  });
});

describe("resolveCallCountPolicy", () => {
  it("defaults to 'unlimited' when config is null", () => {
    expect(resolveCallCountPolicy(null)).toBe("unlimited");
  });

  it("defaults to 'unlimited' when config has no policy", () => {
    expect(resolveCallCountPolicy({} as PlaybookConfig)).toBe("unlimited");
  });

  it("returns the policy when set to hard_cap", () => {
    expect(
      resolveCallCountPolicy({ callCountPolicy: "hard_cap" } as PlaybookConfig),
    ).toBe("hard_cap");
  });

  it("returns the policy when set to soft_cap", () => {
    expect(
      resolveCallCountPolicy({ callCountPolicy: "soft_cap" } as PlaybookConfig),
    ).toBe("soft_cap");
  });

  it("returns the policy when set to unlimited", () => {
    expect(
      resolveCallCountPolicy({
        callCountPolicy: "unlimited",
      } as PlaybookConfig),
    ).toBe("unlimited");
  });

  it("rejects unknown values and falls back to 'unlimited'", () => {
    expect(
      resolveCallCountPolicy({
        callCountPolicy: "moderate" as never,
      } as PlaybookConfig),
    ).toBe("unlimited");
  });
});

describe("getMaxCallsPerDay", () => {
  it("returns null when config is null", () => {
    expect(getMaxCallsPerDay(null)).toBeNull();
  });

  it("returns null when field is unset", () => {
    expect(getMaxCallsPerDay({} as PlaybookConfig)).toBeNull();
  });

  it("returns null when value is 0", () => {
    expect(
      getMaxCallsPerDay({ maxCallsPerDay: 0 } as PlaybookConfig),
    ).toBeNull();
  });

  it("returns null when value is negative", () => {
    expect(
      getMaxCallsPerDay({ maxCallsPerDay: -3 } as PlaybookConfig),
    ).toBeNull();
  });

  it("returns null when value is NaN", () => {
    expect(
      getMaxCallsPerDay({ maxCallsPerDay: NaN } as PlaybookConfig),
    ).toBeNull();
  });

  it("returns the integer floor for positive real values", () => {
    expect(
      getMaxCallsPerDay({ maxCallsPerDay: 3.7 } as PlaybookConfig),
    ).toBe(3);
  });

  it("returns the value unchanged for positive integers", () => {
    expect(getMaxCallsPerDay({ maxCallsPerDay: 5 } as PlaybookConfig)).toBe(5);
  });
});

describe("evaluateCallRateLimit", () => {
  it("allows unconditionally when policy is unlimited", () => {
    expect(
      evaluateCallRateLimit({
        policy: "unlimited",
        maxCallsPerDay: 1,
        usedToday: 100,
      }),
    ).toMatchObject({ decision: "allow" });
  });

  it("allows when cap is null (no cap to enforce)", () => {
    expect(
      evaluateCallRateLimit({
        policy: "hard_cap",
        maxCallsPerDay: null,
        usedToday: 100,
      }),
    ).toMatchObject({ decision: "allow" });
  });

  it("allows when usedToday is below the cap", () => {
    expect(
      evaluateCallRateLimit({
        policy: "hard_cap",
        maxCallsPerDay: 5,
        usedToday: 4,
      }),
    ).toMatchObject({ decision: "allow", cap: 5, usedToday: 4 });
  });

  it("blocks with over-cap decision under hard_cap when usedToday == cap", () => {
    expect(
      evaluateCallRateLimit({
        policy: "hard_cap",
        maxCallsPerDay: 5,
        usedToday: 5,
      }),
    ).toMatchObject({
      decision: "block-over-cap",
      policy: "hard_cap",
      cap: 5,
      usedToday: 5,
    });
  });

  it("allows but flags soft-cap-hit under soft_cap when usedToday == cap", () => {
    expect(
      evaluateCallRateLimit({
        policy: "soft_cap",
        maxCallsPerDay: 5,
        usedToday: 5,
      }),
    ).toMatchObject({
      decision: "allow-soft-cap-hit",
      policy: "soft_cap",
      cap: 5,
      usedToday: 5,
    });
  });

  it("allows but flags soft-cap-hit when usedToday > cap (over the line)", () => {
    expect(
      evaluateCallRateLimit({
        policy: "soft_cap",
        maxCallsPerDay: 3,
        usedToday: 7,
      }),
    ).toMatchObject({ decision: "allow-soft-cap-hit" });
  });
});

describe("CallRateLimitError", () => {
  it("carries a stable code for routes to catch", () => {
    const err = new CallRateLimitError({
      callerId: "abcdef1234567890",
      playbookId: "pb-1",
      cap: 5,
      usedToday: 5,
    });
    expect(err.code).toBe("CALL_RATE_LIMIT_OVER_CAP");
    expect(err.name).toBe("CallRateLimitError");
    expect(err.cap).toBe(5);
    expect(err.usedToday).toBe(5);
    expect(err.callerId).toBe("abcdef1234567890");
    expect(err.playbookId).toBe("pb-1");
  });

  it("instanceOf Error", () => {
    const err = new CallRateLimitError({
      callerId: "x",
      playbookId: null,
      cap: 1,
      usedToday: 1,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CallRateLimitError);
  });
});
