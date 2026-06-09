/**
 * #1340 AC vitest — `isSystemEventKind(customEventKind("FailureLog"))`
 * returns `false`.
 *
 * The dispatcher-routing check codifies the Tallyseal contract: HF's
 * FailureLog event kind is a custom (host-side) brand and MUST NOT
 * collide with the Tallyseal system-event switch. If this test fails
 * after a `@tallyseal/core` bump, the bump introduced an allowlist
 * promotion of "FailureLog" — escalate to the Tallyseal seam owner
 * before consuming the new version.
 */

import { describe, expect, test } from "vitest";
import {
  customEventKind,
  isSystemEventKind,
} from "@/lib/intake/tallyseal";
import { FAILURE_LOG_EVENT_KIND } from "@/lib/intake/audit-bundle";

describe("#1340 — FailureLog Tallyseal event-kind brand", () => {
  test("isSystemEventKind(customEventKind('FailureLog')) === false", () => {
    expect(isSystemEventKind(customEventKind("FailureLog"))).toBe(false);
  });

  test("FAILURE_LOG_EVENT_KIND export is the same brand", () => {
    expect(FAILURE_LOG_EVENT_KIND).toBe(customEventKind("FailureLog"));
  });

  test("the brand is a string-shaped EventKind (passes through appendEvent)", () => {
    expect(typeof FAILURE_LOG_EVENT_KIND).toBe("string");
    expect((FAILURE_LOG_EVENT_KIND as string).length).toBeGreaterThan(0);
  });
});
