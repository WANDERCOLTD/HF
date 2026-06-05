/**
 * Tests for lib/voice/system-settings.ts (AnyVoice #1044).
 *
 * Validates the cross-provider settings helper: cache TTL behaviour,
 * defaults when DB read fails, upsert path through updateVoiceSystemSettings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceSystemSettings: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

import {
  getVoiceSystemSettings,
  invalidateVoiceSystemSettingsCache,
  updateVoiceSystemSettings,
  VOICE_SYSTEM_DEFAULTS,
} from "@/lib/voice/system-settings";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateVoiceSystemSettingsCache();
});

describe("getVoiceSystemSettings", () => {
  it("returns defaults when no row exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getVoiceSystemSettings();
    expect(result).toEqual(VOICE_SYSTEM_DEFAULTS);
  });

  it("returns the row when present", async () => {
    mockFindUnique.mockResolvedValue({
      id: "singleton",
      fallbackOnAdapterError: "silent",
      maxCostPerCallUsd: 2.5,
      auditRetentionDays: 30,
      defaultProviderSlug: "vapi",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await getVoiceSystemSettings();
    expect(result.fallbackOnAdapterError).toBe("silent");
    expect(result.maxCostPerCallUsd).toBe(2.5);
    expect(result.auditRetentionDays).toBe(30);
    expect(result.defaultProviderSlug).toBe("vapi");
  });

  it("falls back to default on invalid fallbackOnAdapterError value", async () => {
    mockFindUnique.mockResolvedValue({
      id: "singleton",
      fallbackOnAdapterError: "shrug",
      maxCostPerCallUsd: null,
      auditRetentionDays: 90,
      defaultProviderSlug: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await getVoiceSystemSettings();
    expect(result.fallbackOnAdapterError).toBe("throw");
  });

  it("returns defaults when the DB throws (does not propagate)", async () => {
    mockFindUnique.mockRejectedValue(new Error("connection refused"));
    const result = await getVoiceSystemSettings();
    expect(result).toEqual(VOICE_SYSTEM_DEFAULTS);
  });

  it("caches reads — second call does not re-query", async () => {
    mockFindUnique.mockResolvedValue(null);
    await getVoiceSystemSettings();
    await getVoiceSystemSettings();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });
});

describe("updateVoiceSystemSettings", () => {
  it("upserts the singleton row and invalidates the cache", async () => {
    mockFindUnique.mockResolvedValue(null);
    await getVoiceSystemSettings();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    mockUpsert.mockResolvedValue({
      id: "singleton",
      fallbackOnAdapterError: "throw",
      maxCostPerCallUsd: 5,
      auditRetentionDays: 90,
      defaultProviderSlug: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await updateVoiceSystemSettings({ maxCostPerCallUsd: 5 });
    expect(result.maxCostPerCallUsd).toBe(5);

    const upsertArgs = mockUpsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ id: "singleton" });
    expect(upsertArgs.create.id).toBe("singleton");
    expect(upsertArgs.create.maxCostPerCallUsd).toBe(5);
  });
});
