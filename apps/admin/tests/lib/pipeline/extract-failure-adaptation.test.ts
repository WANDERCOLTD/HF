/**
 * Unit tests for #1340 ADAPT sub-op 8 — extractFailureAdaptation.
 *
 * Coverage:
 *   - empty/null/undefined input returns null (normal-Session no-op)
 *   - each documented FailureLog.kind returns a distinct non-empty signal
 *   - multi-failure array → signal phrasing driven by the most-recent
 *     row (sorted by occurredAt DESC), failureCount = total array length
 *   - unknown kind falls through to generic phrasing (open-ended schema)
 *   - delta is the documented -0.1 reassurance bias
 *
 * Mock shape: we synthesise FailureLog objects directly via the
 * Prisma-generated type rather than mocking the client — the function
 * under test is pure and takes the row(s) as a parameter.
 */

import { describe, expect, test } from "vitest";
import type { FailureLog } from "@prisma/client";
import {
  extractFailureAdaptation,
  signalFor,
} from "@/lib/pipeline/extract-failure-adaptation";

function mkFailure(overrides: Partial<FailureLog> = {}): FailureLog {
  return {
    id: overrides.id ?? "fl-test",
    sessionId: overrides.sessionId ?? "session-test",
    kind: overrides.kind ?? "GHOST_NEVER_CONNECTED",
    attemptNumber: overrides.attemptNumber ?? 1,
    errorPayload: overrides.errorPayload ?? {},
    occurredAt: overrides.occurredAt ?? new Date("2026-06-08T10:06:02Z"),
  };
}

describe("extractFailureAdaptation — no-input no-op", () => {
  test("null input → null", () => {
    expect(extractFailureAdaptation(null)).toBeNull();
  });

  test("undefined input → null", () => {
    expect(extractFailureAdaptation(undefined)).toBeNull();
  });

  test("empty array → null", () => {
    expect(extractFailureAdaptation([])).toBeNull();
  });
});

describe("extractFailureAdaptation — documented kinds (AC #1340 vitest 2)", () => {
  test("GHOST_NEVER_CONNECTED → distinct non-empty signal", () => {
    const result = extractFailureAdaptation(
      mkFailure({ kind: "GHOST_NEVER_CONNECTED" }),
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("GHOST_NEVER_CONNECTED");
    expect(result?.signal).toBe(
      "previous attempt: connection never opened — let's try again together",
    );
    expect(result?.signal.length).toBeGreaterThan(0);
  });

  test("VAPI_502 → distinct non-empty signal", () => {
    const result = extractFailureAdaptation(mkFailure({ kind: "VAPI_502" }));
    expect(result?.kind).toBe("VAPI_502");
    expect(result?.signal).toBe(
      "previous attempt: the voice provider rejected our request — let's try again",
    );
  });

  test("OUTBOUND_DIAL_FAILED → distinct non-empty signal", () => {
    const result = extractFailureAdaptation(
      mkFailure({ kind: "OUTBOUND_DIAL_FAILED" }),
    );
    expect(result?.kind).toBe("OUTBOUND_DIAL_FAILED");
    expect(result?.signal).toBe(
      "previous attempt: outbound dial failed before VAPI accepted it — let's try again",
    );
  });

  test("INTAKE_SCHEMA_FAIL → distinct non-empty signal", () => {
    const result = extractFailureAdaptation(
      mkFailure({ kind: "INTAKE_SCHEMA_FAIL" }),
    );
    expect(result?.kind).toBe("INTAKE_SCHEMA_FAIL");
    expect(result?.signal).toBe(
      "previous attempt: enrolment couldn't capture all the required details — let's pick up where we left off",
    );
  });

  test("all four documented kinds produce mutually distinct signals", () => {
    const kinds = [
      "GHOST_NEVER_CONNECTED",
      "VAPI_502",
      "OUTBOUND_DIAL_FAILED",
      "INTAKE_SCHEMA_FAIL",
    ];
    const signals = new Set(kinds.map((k) => signalFor(k)));
    expect(signals.size).toBe(kinds.length);
  });
});

describe("extractFailureAdaptation — multi-failure stacking", () => {
  test("array → signal driven by most-recent occurredAt", () => {
    const older = mkFailure({
      id: "fl-1",
      kind: "OUTBOUND_DIAL_FAILED",
      occurredAt: new Date("2026-06-08T10:00:00Z"),
    });
    const newer = mkFailure({
      id: "fl-2",
      kind: "GHOST_NEVER_CONNECTED",
      occurredAt: new Date("2026-06-08T10:06:02Z"),
    });
    const result = extractFailureAdaptation([older, newer]);
    expect(result?.kind).toBe("GHOST_NEVER_CONNECTED");
    expect(result?.failureCount).toBe(2);
  });

  test("array order independent — picks newest regardless of input order", () => {
    const older = mkFailure({
      id: "fl-1",
      kind: "VAPI_502",
      occurredAt: new Date("2026-06-08T10:00:00Z"),
    });
    const newer = mkFailure({
      id: "fl-2",
      kind: "GHOST_NEVER_CONNECTED",
      occurredAt: new Date("2026-06-08T10:06:02Z"),
    });
    const reversed = extractFailureAdaptation([newer, older]);
    const forward = extractFailureAdaptation([older, newer]);
    expect(reversed?.kind).toBe(forward?.kind);
    expect(reversed?.failureCount).toBe(forward?.failureCount);
  });
});

describe("extractFailureAdaptation — open-ended kind fallback", () => {
  test("unknown kind → non-empty generic phrasing", () => {
    const result = extractFailureAdaptation(
      mkFailure({ kind: "LLM_TIMEOUT" }),
    );
    expect(result).not.toBeNull();
    expect(result?.signal.length).toBeGreaterThan(0);
    // Generic phrasing humanises the underscore form.
    expect(result?.signal.toLowerCase()).toContain("llm timeout");
  });

  test("totally novel kind still returns a signal (no throw)", () => {
    const result = extractFailureAdaptation(
      mkFailure({ kind: "SOMETHING_NEW_FROM_SLICE_8" }),
    );
    expect(result).not.toBeNull();
    expect(result?.signal.length).toBeGreaterThan(0);
  });
});

describe("extractFailureAdaptation — delta + metadata shape", () => {
  test("delta is the documented -0.1 reassurance bias", () => {
    const result = extractFailureAdaptation(mkFailure());
    expect(result?.delta).toBe(-0.1);
  });

  test("mostRecentAt is an ISO timestamp", () => {
    const ts = new Date("2026-06-08T10:06:02.123Z");
    const result = extractFailureAdaptation(mkFailure({ occurredAt: ts }));
    expect(result?.mostRecentAt).toBe(ts.toISOString());
  });
});
