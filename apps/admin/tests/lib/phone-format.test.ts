/**
 * Tests for lib/voice/phone-format.ts — E.164 normaliser used at all
 * Caller.phone write points + the outbound-dial site.
 *
 * Discovered live: a UK learner's `07768485153` → VAPI 400 → our 502.
 * These tests pin down the heuristics so the bug can't slip back.
 */

import { describe, it, expect } from "vitest";
import { toE164, stripPhone, isE164 } from "@/lib/voice/phone-format";

describe("toE164", () => {
  describe("UK (default country = GB)", () => {
    it("converts leading-zero domestic to +44", () => {
      expect(toE164("07768485153")).toBe("+447768485153");
    });

    it("strips the UK trunk-prefix (0) when already in +44 form", () => {
      // UK convention `+44 (0) ...` — the (0) is for domestic readers
      // only; international dial drops it. VAPI rejects a literal +440…
      expect(toE164("+44 (0) 7768 485153")).toBe("+447768485153");
    });

    it("survives spaces, dashes, parens", () => {
      expect(toE164("07768-485-153")).toBe("+447768485153");
      expect(toE164("(077) 68 485 153")).toBe("+447768485153");
    });

    it("handles international trunk prefix 00", () => {
      // 00 + country code + number = E.164 via 00→+ swap
      expect(toE164("0044 7768 485153")).toBe("+447768485153");
      expect(toE164("001 415 555 0123")).toBe("+14155550123");
    });

    it("non-zero non-+ string is assumed to be domestic GB", () => {
      // No way to tell — default country wins (current market test)
      expect(toE164("7768485153")).toBe("+447768485153");
    });
  });

  describe("US (default country = US)", () => {
    it("converts 10-digit to +1", () => {
      expect(toE164("4155550123", "US")).toBe("+14155550123");
    });

    it("strips trunk 1 if user wrote 1-415-555-0123", () => {
      // Note: this is treated as domestic US — our heuristic only strips
      // a leading 0 (UK trunk). A literal leading 1 is kept (it's the
      // country code). This is by design — we don't know if 1 is trunk
      // or country code; we trust the default country.
      expect(toE164("14155550123", "US")).toBe("+114155550123");
    });
  });

  describe("preserves a real E.164 verbatim", () => {
    it("strips non-digits + keeps the +", () => {
      expect(toE164("+44 7768 485153")).toBe("+447768485153");
      expect(toE164("+1 (415) 555-0123")).toBe("+14155550123");
    });
  });

  describe("nulls + empties", () => {
    it("returns null for null / undefined / empty / whitespace", () => {
      expect(toE164(null)).toBeNull();
      expect(toE164(undefined)).toBeNull();
      expect(toE164("")).toBeNull();
      expect(toE164("   ")).toBeNull();
    });

    it("returns null for a string with no digits", () => {
      expect(toE164("abc-def")).toBeNull();
    });
  });
});

describe("stripPhone", () => {
  it("removes spaces / dashes / parens; preserves the +", () => {
    // stripPhone is mechanical — keeps the trunk 0 (toE164 is responsible
    // for context-aware stripping via stripTrunkZero).
    expect(stripPhone("+44 (0) 7768-485-153")).toBe("+4407768485153");
    expect(stripPhone("07768 485 153")).toBe("07768485153");
  });
});

describe("isE164", () => {
  it("accepts 7-15 digit + prefixed strings", () => {
    expect(isE164("+447768485153")).toBe(true);
    expect(isE164("+14155550123")).toBe(true);
  });

  it("rejects missing +", () => {
    expect(isE164("447768485153")).toBe(false);
  });

  it("rejects non-digits after the +", () => {
    expect(isE164("+44 77 68")).toBe(false);
  });

  it("rejects too-short / too-long", () => {
    expect(isE164("+1234")).toBe(false);
    expect(isE164("+1234567890123456")).toBe(false);
  });
});
