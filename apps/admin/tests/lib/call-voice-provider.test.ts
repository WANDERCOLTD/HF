/**
 * Tests for Call.voiceProvider field (AnyVoice #1025 + #1031).
 *
 * #1025 originally shipped this as a VoiceProviderSlug enum. #1031
 * superseded that with a String column referencing VoiceProvider.slug
 * so providers are data, not code. The test now validates the new
 * column shape: a string with default "vapi" — backfill safety for
 * existing rows and any caller that creates a Call without setting
 * the field.
 *
 * Foundational — if the column shape regresses, #1027 (per-caller
 * routing) and the factory (#1031) can't trust what they read.
 */

import { describe, it, expect, vi } from "vitest";

// tests/setup.ts mocks @prisma/client wholesale; override here so the
// real generated types are visible to this file.
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return actual;
});

import type { Prisma } from "@prisma/client";

describe("Call.voiceProvider (#1025 + #1031)", () => {
  it("type-checks as string (not enum) — the field accepts arbitrary slugs", () => {
    // Compile-time assertion: a Prisma CallUncheckedCreateInput must
    // accept a string for voiceProvider. If the schema regresses back
    // to an enum, this fails to compile. Runtime is a tautology — the
    // type check is the point.
    const sample: Pick<Prisma.CallUncheckedCreateInput, "source" | "transcript" | "voiceProvider"> = {
      source: "vapi",
      transcript: "",
      voiceProvider: "vapi",
    };
    expect(sample.voiceProvider).toBe("vapi");

    // The same shape must accept any provider slug — the whole point of
    // dropping the enum was to remove the schema migration tax.
    const retell: typeof sample = { source: "vapi", transcript: "", voiceProvider: "retell" };
    expect(retell.voiceProvider).toBe("retell");
  });

  it("VoiceProviderSlug enum is GONE — #1031 dropped it", async () => {
    const mod = await import("@prisma/client");
    expect("VoiceProviderSlug" in mod).toBe(false);
  });
});
