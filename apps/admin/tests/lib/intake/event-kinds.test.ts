// event-kinds — epic #1338 Slice 2 (#1343).

import { describe, it, expect } from "vitest";
import { FAILURE_LOG, SESSION_EVENT } from "@/lib/intake/event-kinds";
import { isSystemEventKind } from "@/lib/intake/tallyseal";

describe("custom event kinds", () => {
  it("FAILURE_LOG carries the right string value", () => {
    expect(String(FAILURE_LOG)).toBe("FailureLog");
  });

  it("SESSION_EVENT carries the right string value", () => {
    expect(String(SESSION_EVENT)).toBe("SessionEvent");
  });

  it("neither is classified as a system event kind", () => {
    expect(isSystemEventKind(FAILURE_LOG)).toBe(false);
    expect(isSystemEventKind(SESSION_EVENT)).toBe(false);
  });

  it("the two kinds are distinct", () => {
    expect(String(FAILURE_LOG)).not.toBe(String(SESSION_EVENT));
  });
});
