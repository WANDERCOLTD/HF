import { describe, expect, test } from "vitest";
import { resolveProsodyMode } from "@/lib/pipeline/prosody-runner";

describe("resolveProsodyMode — precedence (#1252 follow-up)", () => {
  test("explicit voice.prosodyMode='ielts' wins", () => {
    expect(
      resolveProsodyMode({ voice: { prosodyMode: "ielts" }, tierPresetId: "anything" }),
    ).toBe("ielts");
  });

  test("explicit voice.prosodyMode='general' wins", () => {
    expect(
      resolveProsodyMode({
        voice: { prosodyMode: "general" },
        tierPresetId: "ielts-speaking",
      }),
    ).toBe("general");
  });

  test("voice.prosodyMode='auto' falls through to tierPresetId heuristic", () => {
    expect(
      resolveProsodyMode({ voice: { prosodyMode: "auto" }, tierPresetId: "ielts-speaking" }),
    ).toBe("ielts");
  });

  test("voice.prosodyMode='auto' with no preset → general", () => {
    expect(resolveProsodyMode({ voice: { prosodyMode: "auto" } })).toBe("general");
  });

  test("no voice config, tierPresetId='ielts-speaking' → ielts (legacy)", () => {
    expect(resolveProsodyMode({ tierPresetId: "ielts-speaking" })).toBe("ielts");
  });

  test("empty config → general (default)", () => {
    expect(resolveProsodyMode({})).toBe("general");
  });

  test("null config → general", () => {
    expect(resolveProsodyMode(null)).toBe("general");
  });

  test("undefined config → general", () => {
    expect(resolveProsodyMode(undefined)).toBe("general");
  });

  test("unknown voice.prosodyMode string falls through to heuristic", () => {
    expect(
      resolveProsodyMode({
        voice: { prosodyMode: "bogus" },
        tierPresetId: "ielts-speaking",
      }),
    ).toBe("ielts");
    expect(
      resolveProsodyMode({ voice: { prosodyMode: "bogus" } }),
    ).toBe("general");
  });

  test("voice block present but no prosodyMode key → tier heuristic", () => {
    expect(
      resolveProsodyMode({ voice: { provider: "vapi" }, tierPresetId: "ielts-speaking" }),
    ).toBe("ielts");
  });
});
