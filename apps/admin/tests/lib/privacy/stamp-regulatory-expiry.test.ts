/**
 * #1917 (epic #1915 §6a I-PR3) — unit tests for the stamp helper.
 *
 * Pins the layered resolution: preset > env > NULL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock `@/lib/config` so we can drive `config.retention.callerDataDays`
// per test without depending on the actual env. Mock factory runs at
// import time so it must be hoisted above the SUT import.
vi.mock("@/lib/config", () => ({
  config: {
    retention: {
      get callerDataDays() {
        return mockCallerDataDays;
      },
    },
  },
}));

let mockCallerDataDays = 0;

import { stampRegulatoryExpiry } from "@/lib/privacy/stamp-regulatory-expiry";

describe("stampRegulatoryExpiry", () => {
  const FIXED_NOW = new Date("2026-06-18T12:00:00.000Z");

  beforeEach(() => {
    mockCallerDataDays = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns NULL when both preset and env are absent", () => {
    mockCallerDataDays = 0;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: null,
      now: FIXED_NOW,
    });
    expect(result).toBeNull();
  });

  it("returns NULL when preset is 0 and env is 0", () => {
    mockCallerDataDays = 0;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: 0,
      now: FIXED_NOW,
    });
    expect(result).toBeNull();
  });

  it("uses env fallback when preset is NULL and env > 0", () => {
    mockCallerDataDays = 30;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: null,
      now: FIXED_NOW,
    });
    expect(result).toEqual(new Date("2026-07-18T12:00:00.000Z"));
  });

  it("preset wins over env when both are set and non-zero", () => {
    mockCallerDataDays = 30;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: 90,
      now: FIXED_NOW,
    });
    expect(result).toEqual(new Date("2026-09-16T12:00:00.000Z"));
  });

  it("preset wins over env when preset = 1 and env = 365", () => {
    mockCallerDataDays = 365;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: 1,
      now: FIXED_NOW,
    });
    expect(result).toEqual(new Date("2026-06-19T12:00:00.000Z"));
  });

  it("preset = 0 falls through to env (treated as 'no preset opinion')", () => {
    // Per helper contract: presetRetentionDays === 0 is treated the same
    // as null — "preset has no opinion, use env fallback". This avoids
    // an accidental "preset says delete immediately" interpretation.
    mockCallerDataDays = 14;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: 0,
      now: FIXED_NOW,
    });
    expect(result).toEqual(new Date("2026-07-02T12:00:00.000Z"));
  });

  it("uses real Date.now() when `now` arg omitted", () => {
    mockCallerDataDays = 7;
    const before = Date.now();
    const result = stampRegulatoryExpiry({ presetRetentionDays: null });
    const after = Date.now();
    expect(result).not.toBeNull();
    const expiry = result!.getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 7 * 86400000);
    expect(expiry).toBeLessThanOrEqual(after + 7 * 86400000);
  });

  it("365-day preset produces a future date within 366 days", () => {
    mockCallerDataDays = 0;
    const result = stampRegulatoryExpiry({
      presetRetentionDays: 365,
      now: FIXED_NOW,
    });
    expect(result).not.toBeNull();
    const diffDays = (result!.getTime() - FIXED_NOW.getTime()) / 86400000;
    expect(diffDays).toBe(365);
  });
});
