/**
 * Tests for lib/identity/pin.ts — PIN generation + hash/verify primitives
 * used by the first-call PIN gate (#1101).
 *
 * Properties under test:
 *   - generatePin yields a 6-digit zero-padded string
 *   - distinct calls yield distinct values (probabilistic — CSPRNG sanity)
 *   - hashPin output is not the plaintext and is stable enough to verify
 *   - verifyPinHash is constant-time-shaped (bcrypt) — match/miss both
 *     return a boolean, never throw
 */

import { describe, it, expect } from "vitest";
import { generatePin, hashPin, verifyPinHash } from "@/lib/identity/pin";

describe("lib/identity/pin", () => {
  describe("generatePin", () => {
    it("returns a 6-character string of digits", () => {
      for (let i = 0; i < 50; i++) {
        const pin = generatePin();
        expect(pin).toHaveLength(6);
        expect(pin).toMatch(/^\d{6}$/);
      }
    });

    it("zero-pads values below 100000", () => {
      // Sample many; eventually one will start with a 0 if randomInt's range
      // is correct (000000-999999). This is a sanity check that we cover the
      // whole range — not a strict guarantee.
      const samples = Array.from({ length: 200 }, () => generatePin());
      const hasZeroPrefix = samples.some((s) => s[0] === "0");
      // ~20% of 200 samples should start with 0; if none, padding is broken.
      expect(hasZeroPrefix).toBe(true);
    });

    it("yields distinct values across calls (CSPRNG sanity)", () => {
      const samples = new Set<string>();
      for (let i = 0; i < 50; i++) {
        samples.add(generatePin());
      }
      // 50 draws from 1M space — collisions essentially impossible (<0.2%)
      expect(samples.size).toBeGreaterThanOrEqual(49);
    });
  });

  describe("hashPin + verifyPinHash", () => {
    it("hash is not the plaintext PIN", async () => {
      const pin = "482931";
      const hash = await hashPin(pin);
      expect(hash).not.toBe(pin);
      expect(hash).not.toContain(pin);
      expect(hash.length).toBeGreaterThan(40); // bcrypt hashes are 60 chars
    });

    it("verifyPinHash returns true for the correct PIN", async () => {
      const pin = "123456";
      const hash = await hashPin(pin);
      await expect(verifyPinHash(pin, hash)).resolves.toBe(true);
    });

    it("verifyPinHash returns false for a wrong PIN", async () => {
      const hash = await hashPin("123456");
      await expect(verifyPinHash("000000", hash)).resolves.toBe(false);
      await expect(verifyPinHash("123457", hash)).resolves.toBe(false);
    });

    it("two hashes of the same PIN differ (per-hash salt)", async () => {
      const pin = "999999";
      const a = await hashPin(pin);
      const b = await hashPin(pin);
      expect(a).not.toBe(b);
      // both still verify
      await expect(verifyPinHash(pin, a)).resolves.toBe(true);
      await expect(verifyPinHash(pin, b)).resolves.toBe(true);
    });
  });
});
