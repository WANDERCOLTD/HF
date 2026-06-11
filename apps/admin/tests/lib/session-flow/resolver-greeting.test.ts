/**
 * #1403 — Greeting lens resolver tests.
 *
 * Pins `resolveSessionFlow()`'s handling of the two new fields:
 *   - `firstCallCourseIntro` (string | null)
 *   - `firstCallWaitForAck` ("none" | "any_response" | "greeting_words")
 *
 * Plus the `source` provenance fields.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSessionFlow,
  DEFAULT_FIRST_CALL_WAIT_FOR_ACK,
} from "@/lib/session-flow/resolver";
import type { PlaybookConfig } from "@/lib/types/json-fields";

describe("resolveSessionFlow — #1403 Greeting lens", () => {
  it("returns null + 'none' source for unset firstCallCourseIntro", () => {
    const r = resolveSessionFlow({ playbook: { config: {} as PlaybookConfig } });
    expect(r.firstCallCourseIntro).toBeNull();
    expect(r.source.firstCallCourseIntro).toBe("none");
  });

  it("returns the educator-authored firstCallCourseIntro + 'playbook' source", () => {
    const r = resolveSessionFlow({
      playbook: {
        config: { firstCallCourseIntro: "Today about {courseName}. Ready?" } as PlaybookConfig,
      },
    });
    expect(r.firstCallCourseIntro).toBe("Today about {courseName}. Ready?");
    expect(r.source.firstCallCourseIntro).toBe("playbook");
  });

  it("treats blank/whitespace firstCallCourseIntro as unset", () => {
    const r = resolveSessionFlow({
      playbook: {
        config: { firstCallCourseIntro: "   \n  " } as PlaybookConfig,
      },
    });
    expect(r.firstCallCourseIntro).toBeNull();
    expect(r.source.firstCallCourseIntro).toBe("none");
  });

  it("defaults firstCallWaitForAck to 'greeting_words' when unset", () => {
    const r = resolveSessionFlow({ playbook: { config: {} as PlaybookConfig } });
    expect(r.firstCallWaitForAck).toBe(DEFAULT_FIRST_CALL_WAIT_FOR_ACK);
    expect(r.firstCallWaitForAck).toBe("greeting_words");
    expect(r.source.firstCallWaitForAck).toBe("default");
  });

  it("returns the educator-authored firstCallWaitForAck + 'playbook' source", () => {
    const r = resolveSessionFlow({
      playbook: {
        config: { firstCallWaitForAck: "any_response" } as PlaybookConfig,
      },
    });
    expect(r.firstCallWaitForAck).toBe("any_response");
    expect(r.source.firstCallWaitForAck).toBe("playbook");
  });

  it("falls back to default when firstCallWaitForAck is an unknown value", () => {
    // Force a garbage value (simulates legacy data drift).
    const r = resolveSessionFlow({
      playbook: {
        config: { firstCallWaitForAck: "garbage" as unknown as "none" } as PlaybookConfig,
      },
    });
    expect(r.firstCallWaitForAck).toBe(DEFAULT_FIRST_CALL_WAIT_FOR_ACK);
    expect(r.source.firstCallWaitForAck).toBe("default");
  });

  it("accepts all three explicit modes", () => {
    for (const mode of ["none", "any_response", "greeting_words"] as const) {
      const r = resolveSessionFlow({
        playbook: {
          config: { firstCallWaitForAck: mode } as PlaybookConfig,
        },
      });
      expect(r.firstCallWaitForAck).toBe(mode);
      expect(r.source.firstCallWaitForAck).toBe("playbook");
    }
  });
});
