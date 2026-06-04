/**
 * Tests for resolveVoiceProviderForCaller (AnyVoice #1027).
 *
 * Cascade: caller → cohort → playbook → SYSTEM.
 *
 * The cohort and playbook layers are stubs today (return null) because
 * neither CohortGroup nor PlaybookConfig has a voiceProvider field yet.
 * The tests assert the cascade structure works AS-IS:
 *   - Caller override wins
 *   - No caller override + no other overrides → SYSTEM default from
 *     VoiceProvider.isDefault row
 *   - Caller resolves to system source when no override is set
 *
 * When cohort/playbook fields are added in a future story, that story
 * adds tests for those layers — the resolver signature is locked from
 * day one (TL guidance in #1015 grooming).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: { findUnique: vi.fn() },
    voiceProvider: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

// The factory module reads from prisma too. Mock its public surface so
// the resolver's calls to getDefaultVoiceProviderSlug return predictable
// values without exercising the real cache logic.
vi.mock("@/lib/voice/provider-factory", () => ({
  getDefaultVoiceProviderSlug: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getDefaultVoiceProviderSlug } from "@/lib/voice/provider-factory";
import { resolveVoiceProviderForCaller } from "@/lib/voice/resolve-voice-provider";

describe("resolveVoiceProviderForCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the caller's override when set (highest precedence)", async () => {
    (prisma.caller.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProvider: "retell",
      cohortGroupId: "cohort-1",
    });

    const result = await resolveVoiceProviderForCaller("caller-1");

    expect(result).toEqual({ slug: "retell", source: "caller" });
    // SYSTEM default lookup must NOT fire when caller override wins
    expect(getDefaultVoiceProviderSlug).not.toHaveBeenCalled();
  });

  it("falls through to SYSTEM default when caller has no override", async () => {
    (prisma.caller.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProvider: null,
      cohortGroupId: "cohort-1",
    });
    (getDefaultVoiceProviderSlug as ReturnType<typeof vi.fn>).mockResolvedValue("vapi");

    const result = await resolveVoiceProviderForCaller("caller-2");

    expect(result).toEqual({ slug: "vapi", source: "system" });
    expect(getDefaultVoiceProviderSlug).toHaveBeenCalledOnce();
  });

  it("falls through to SYSTEM default when caller record itself is missing", async () => {
    // Defensive: if Caller row was deleted between phone-lookup and
    // resolver-run, fall back to system rather than throwing.
    (prisma.caller.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getDefaultVoiceProviderSlug as ReturnType<typeof vi.fn>).mockResolvedValue("vapi");

    const result = await resolveVoiceProviderForCaller("caller-missing");

    expect(result).toEqual({ slug: "vapi", source: "system" });
  });

  it("respects an empty-string voiceProvider as 'no override' (treats it as null)", async () => {
    // The PATCH route already maps "" → null before write, but the
    // resolver should also defend against any legacy row that snuck "".
    (prisma.caller.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProvider: "",
      cohortGroupId: null,
    });
    (getDefaultVoiceProviderSlug as ReturnType<typeof vi.fn>).mockResolvedValue("vapi");

    const result = await resolveVoiceProviderForCaller("caller-3");

    expect(result).toEqual({ slug: "vapi", source: "system" });
  });

  it("propagates the 'no default configured' error from the factory", async () => {
    (prisma.caller.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProvider: null,
      cohortGroupId: null,
    });
    (getDefaultVoiceProviderSlug as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("No default voice provider configured"),
    );

    await expect(resolveVoiceProviderForCaller("caller-4")).rejects.toThrow(
      /No default voice provider configured/,
    );
  });
});
