/**
 * Tests for lib/voice/mask-credentials.ts (AnyVoice #1031).
 *
 * Locks the masking contract that every GET response in
 * /api/voice-providers/* depends on. Each sensitive-suffix pattern gets
 * a pin test so a regression on any one of them fails loudly.
 */

import { describe, it, expect } from "vitest";
import { maskCredentials, MASK_TOKEN, NOT_SET_TOKEN } from "@/lib/voice/mask-credentials";

describe("maskCredentials", () => {
  describe("suffix matching (case-insensitive)", () => {
    it("masks *Key", () => {
      expect(maskCredentials({ apiKey: "live-secret" })).toEqual({ apiKey: MASK_TOKEN });
      expect(maskCredentials({ APIKEY: "x" })).toEqual({ APIKEY: MASK_TOKEN });
      expect(maskCredentials({ rotationkey: "y" })).toEqual({ rotationkey: MASK_TOKEN });
    });

    it("masks *Secret", () => {
      expect(maskCredentials({ webhookSecret: "live" })).toEqual({ webhookSecret: MASK_TOKEN });
      expect(maskCredentials({ SecretValue: "x", clientSecret: "y" })).toEqual({
        SecretValue: "x",
        clientSecret: MASK_TOKEN,
      });
    });

    it("masks *Token", () => {
      expect(maskCredentials({ accessToken: "abc" })).toEqual({ accessToken: MASK_TOKEN });
      expect(maskCredentials({ Token: "ok" })).toEqual({ Token: MASK_TOKEN });
    });

    it("masks *Password", () => {
      expect(maskCredentials({ adminPassword: "x" })).toEqual({ adminPassword: MASK_TOKEN });
      expect(maskCredentials({ DbPassword: "y" })).toEqual({ DbPassword: MASK_TOKEN });
    });
  });

  it("passes through non-sensitive fields unchanged", () => {
    expect(
      maskCredentials({
        baseUrl: "https://api.example.com",
        model: "gpt-4o",
        voiceId: "alloy",
      }),
    ).toEqual({
      baseUrl: "https://api.example.com",
      model: "gpt-4o",
      voiceId: "alloy",
    });
  });

  it("returns NOT_SET marker for empty / null / undefined sensitive values", () => {
    expect(maskCredentials({ apiKey: "" })).toEqual({ apiKey: NOT_SET_TOKEN });
    expect(maskCredentials({ apiKey: null as unknown as string })).toEqual({ apiKey: NOT_SET_TOKEN });
    expect(maskCredentials({ webhookSecret: undefined as unknown as string })).toEqual({
      webhookSecret: NOT_SET_TOKEN,
    });
  });

  it("mixed payload — masks only sensitive fields", () => {
    const input = {
      apiKey: "k1",
      webhookSecret: "s1",
      baseUrl: "https://api",
      model: "x",
      enabled: true,
    };
    expect(maskCredentials(input)).toEqual({
      apiKey: MASK_TOKEN,
      webhookSecret: MASK_TOKEN,
      baseUrl: "https://api",
      model: "x",
      enabled: true,
    });
  });

  it("does not mutate the input object", () => {
    const input = { apiKey: "live" };
    maskCredentials(input);
    expect(input.apiKey).toBe("live");
  });

  it("handles empty input", () => {
    expect(maskCredentials({})).toEqual({});
  });

  it("does NOT mask substring matches that aren't suffixes", () => {
    // "keyword" ends in "word", not "key" — passes through. "secretValue" ends in "value", passes.
    expect(
      maskCredentials({
        keyword: "noun",
        secretValue: "noun",
        tokenValue: "noun",
      }),
    ).toEqual({
      keyword: "noun",
      secretValue: "noun",
      tokenValue: "noun",
    });
  });
});
