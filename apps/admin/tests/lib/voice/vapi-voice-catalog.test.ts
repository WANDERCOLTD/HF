/**
 * Tests for the VAPI adapter's `getVoiceCatalog()` (#1421 Slice A).
 *
 * Pins:
 *   - Catalog returns the canonical Deepgram Aura 12-voice list
 *   - Catalog returns the canonical OpenAI 6-voice list
 *   - ElevenLabs / Azure / PlayHT are intentionally absent so the UI
 *     falls through to the custom-ID hatch for account-specific catalogs
 *   - Every entry has the three required fields (voiceProvider, voiceId, label)
 *   - "asteria" (HF default) is present in the Deepgram subset
 */

import { describe, expect, it } from "vitest";
import { VapiProvider } from "@/lib/voice/providers/vapi";

const adapter = new VapiProvider({}, {});

describe("VapiVoiceProvider.getVoiceCatalog (#1421 Slice A)", () => {
  const catalog = adapter.getVoiceCatalog!();

  it("returns the 12 canonical Deepgram Aura voices", () => {
    const dg = catalog.filter((v) => v.voiceProvider === "deepgram");
    expect(dg.length).toBe(12);
    const ids = dg.map((v) => v.voiceId).sort();
    expect(ids).toEqual(
      [
        "asteria",
        "luna",
        "stella",
        "athena",
        "hera",
        "orion",
        "arcas",
        "perseus",
        "angus",
        "orpheus",
        "helios",
        "zeus",
      ].sort(),
    );
  });

  it("returns the 6 canonical OpenAI TTS voices", () => {
    const oai = catalog.filter((v) => v.voiceProvider === "openai");
    expect(oai.length).toBe(6);
    const ids = oai.map((v) => v.voiceId).sort();
    expect(ids).toEqual(
      ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].sort(),
    );
  });

  it("intentionally returns no entries for ElevenLabs (account-specific)", () => {
    expect(catalog.filter((v) => v.voiceProvider === "11labs")).toEqual([]);
  });

  it("intentionally returns no entries for Azure / PlayHT (custom-ID hatch)", () => {
    expect(catalog.filter((v) => v.voiceProvider === "azure")).toEqual([]);
    expect(catalog.filter((v) => v.voiceProvider === "playht")).toEqual([]);
  });

  it("every entry has voiceProvider + voiceId + label", () => {
    for (const v of catalog) {
      expect(v.voiceProvider.length).toBeGreaterThan(0);
      expect(v.voiceId.length).toBeGreaterThan(0);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it("includes 'asteria' (HF system default voice) in the Deepgram subset", () => {
    const found = catalog.find(
      (v) => v.voiceProvider === "deepgram" && v.voiceId === "asteria",
    );
    expect(found).toBeDefined();
    expect(found!.label).toMatch(/asteria/i);
  });
});
