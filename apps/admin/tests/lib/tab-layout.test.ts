/**
 * Tests for `lib/tab-layout.ts` — Wave E of the legacy-tab retirement
 * plan. Drives the HF_TAB_LAYOUT FF + amber pills + retire-mode
 * redirects.
 *
 * Pinned acceptance:
 *   1. Default to "both" when env var unset
 *   2. "both" returns visible-set with V3_PRIMARY + KEEP + RETIRING
 *   3. "retire" returns visible-set with V3_PRIMARY + KEEP ONLY (no retiring)
 *   4. isRetiring identifies legacy tabs
 *   5. retirementRedirect returns null in `both` mode (no redirect)
 *   6. retirementRedirect returns v3 replacement in `retire` mode
 *   7. Non-retiring tabs return null from retirementRedirect always
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getTabLayout,
  computeVisibleTabs,
  RETIRING_TABS,
  V3_PRIMARY_TABS,
  KEEP_TABS,
} from "@/lib/tab-layout";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_HF_TAB_LAYOUT;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_HF_TAB_LAYOUT;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_HF_TAB_LAYOUT;
  } else {
    process.env.NEXT_PUBLIC_HF_TAB_LAYOUT = ORIGINAL_ENV;
  }
  vi.restoreAllMocks();
});

describe("getTabLayout", () => {
  it("defaults to 'both' when env var unset", () => {
    expect(getTabLayout()).toBe("both");
  });

  it("returns 'both' when env var is any string other than 'retire'", () => {
    process.env.NEXT_PUBLIC_HF_TAB_LAYOUT = "anything";
    expect(getTabLayout()).toBe("both");
  });

  it("returns 'retire' when env var explicitly set", () => {
    process.env.NEXT_PUBLIC_HF_TAB_LAYOUT = "retire";
    expect(getTabLayout()).toBe("retire");
  });
});

describe("computeVisibleTabs", () => {
  it("in 'both' mode includes V3_PRIMARY + KEEP + RETIRING tabs", () => {
    const result = computeVisibleTabs("both");
    for (const id of V3_PRIMARY_TABS) {
      expect(result.visible.has(id)).toBe(true);
    }
    for (const id of KEEP_TABS) {
      expect(result.visible.has(id)).toBe(true);
    }
    for (const id of Object.keys(RETIRING_TABS)) {
      expect(result.visible.has(id as never)).toBe(true);
    }
  });

  it("in 'retire' mode includes V3_PRIMARY + KEEP ONLY (no retiring tabs)", () => {
    const result = computeVisibleTabs("retire");
    for (const id of V3_PRIMARY_TABS) {
      expect(result.visible.has(id)).toBe(true);
    }
    for (const id of KEEP_TABS) {
      expect(result.visible.has(id)).toBe(true);
    }
    for (const id of Object.keys(RETIRING_TABS)) {
      expect(result.visible.has(id as never)).toBe(false);
    }
  });

  it("isRetiring identifies retiring tabs in both modes", () => {
    const both = computeVisibleTabs("both");
    const retire = computeVisibleTabs("retire");
    for (const id of Object.keys(RETIRING_TABS)) {
      expect(both.isRetiring(id as never)).toBe(true);
      expect(retire.isRetiring(id as never)).toBe(true);
    }
  });

  it("isRetiring returns false for non-retiring tabs", () => {
    const result = computeVisibleTabs("both");
    for (const id of V3_PRIMARY_TABS) {
      expect(result.isRetiring(id)).toBe(false);
    }
    for (const id of KEEP_TABS) {
      expect(result.isRetiring(id)).toBe(false);
    }
  });

  it("retirementRedirect returns null in 'both' mode (no redirect needed)", () => {
    const result = computeVisibleTabs("both");
    for (const id of Object.keys(RETIRING_TABS)) {
      expect(result.retirementRedirect(id as never)).toBeNull();
    }
  });

  it("retirementRedirect returns v3 replacement in 'retire' mode", () => {
    const result = computeVisibleTabs("retire");
    expect(result.retirementRedirect("overview-v2")).toBe("snapshot-v3");
    expect(result.retirementRedirect("progress-v2")).toBe("attainment");
    expect(result.retirementRedirect("uplift-v2")).toBe("snapshot-v3");
    expect(result.retirementRedirect("how")).toBe("snapshot-v3");
  });

  it("retirementRedirect returns null for non-retiring tabs even in 'retire' mode", () => {
    const result = computeVisibleTabs("retire");
    expect(result.retirementRedirect("snapshot-v3")).toBeNull();
    expect(result.retirementRedirect("attainment")).toBeNull();
    expect(result.retirementRedirect("calls-prompts")).toBeNull();
    expect(result.retirementRedirect("tune")).toBeNull();
  });
});

describe("RETIRING_TABS map", () => {
  it("includes all 4 expected legacy tabs", () => {
    const ids = Object.keys(RETIRING_TABS).sort();
    expect(ids).toEqual(["how", "overview-v2", "progress-v2", "uplift-v2"].sort());
  });

  it("every replacement is a v3 primary or a keep tab", () => {
    const allowed = new Set<string>([...V3_PRIMARY_TABS, ...KEEP_TABS]);
    for (const entry of Object.values(RETIRING_TABS)) {
      expect(allowed.has(entry.replacedBy)).toBe(true);
    }
  });
});
