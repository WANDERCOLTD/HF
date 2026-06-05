/**
 * #1117 — shared LO ref guard. Tested in isolation; the helper is
 * deliberately pure (no DB calls) so write-site call-graph tests stay
 * lightweight.
 *
 * Anchor-agnostic: CERTIFIED and UNCERTIFIED Curricula apply the same gate.
 */

import { describe, it, expect } from "vitest";
import {
  assertValidLoRef,
  assertValidLoRefBatch,
  isValidLoRef,
  InvalidLoRefError,
} from "@/lib/curriculum/validate-lo-refs";

describe("validate-lo-refs — #1117 shared guard", () => {
  describe("assertValidLoRef — single", () => {
    it("accepts module-scoped form {moduleSlug}-LO{N}", () => {
      expect(() => assertValidLoRef("standard-unit-04-LO1", "standard-unit-04")).not.toThrow();
      expect(() => assertValidLoRef("MOD-1-LO5")).not.toThrow();
    });

    it("accepts regulated body refs (IELTS OUT-NN, SIAS STD-{unit}-{lo}, AC*, R*-LO*)", () => {
      expect(() => assertValidLoRef("OUT-01")).not.toThrow();
      expect(() => assertValidLoRef("STD-04-01")).not.toThrow();
      expect(() => assertValidLoRef("AC1.2")).not.toThrow();
      expect(() => assertValidLoRef("R04-LO2")).not.toThrow();
      expect(() => assertValidLoRef("PSY-MEM-1")).not.toThrow();
    });

    it("rejects placeholder LO\\d+ pattern with operator-actionable suggestion", () => {
      let err: unknown;
      try {
        assertValidLoRef("LO1", "standard-unit-04");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(InvalidLoRefError);
      expect((err as InvalidLoRefError).ref).toBe("LO1");
      expect((err as InvalidLoRefError).message).toContain("standard-unit-04-LO1");
      expect((err as InvalidLoRefError).message).toContain("/^LO\\d+$/");
    });

    it("rejects non-string / empty values", () => {
      expect(() => assertValidLoRef("")).toThrow(InvalidLoRefError);
      expect(() => assertValidLoRef(null)).toThrow(InvalidLoRefError);
      expect(() => assertValidLoRef(undefined)).toThrow(InvalidLoRefError);
      expect(() => assertValidLoRef(42)).toThrow(InvalidLoRefError);
    });

    it("suggests the canonical form generically when no moduleSlug is supplied", () => {
      let err: unknown;
      try {
        assertValidLoRef("LO3");
      } catch (e) {
        err = e;
      }
      expect((err as InvalidLoRefError).message).toContain("{moduleSlug}-LO3");
    });
  });

  describe("assertValidLoRefBatch — many", () => {
    it("accepts a valid batch", () => {
      expect(() =>
        assertValidLoRefBatch(["STD-04-01", "STD-04-02", "STD-04-03"], "standard-unit-04"),
      ).not.toThrow();
    });

    it("rejects any single placeholder ref in the batch (first failure wins)", () => {
      let err: unknown;
      try {
        assertValidLoRefBatch(["STD-04-01", "LO2", "STD-04-03"], "standard-unit-04");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(InvalidLoRefError);
      expect((err as InvalidLoRefError).ref).toBe("LO2");
    });

    it("rejects duplicate refs within a batch (intra-module collision)", () => {
      let err: unknown;
      try {
        assertValidLoRefBatch(["STD-04-01", "STD-04-02", "STD-04-01"], "standard-unit-04");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(InvalidLoRefError);
      expect((err as InvalidLoRefError).ref).toBe("STD-04-01");
      expect((err as InvalidLoRefError).reason).toContain("duplicate");
    });

    it("empty batch is a no-op (legacy back-compat for empty learningObjectives)", () => {
      expect(() => assertValidLoRefBatch([], "any-slug")).not.toThrow();
    });
  });

  describe("isValidLoRef — pure boolean", () => {
    it("mirrors the throwing API for callers that want a fall-through", () => {
      expect(isValidLoRef("OUT-01")).toBe(true);
      expect(isValidLoRef("LO1")).toBe(false);
      expect(isValidLoRef("")).toBe(false);
      expect(isValidLoRef(null)).toBe(false);
      expect(isValidLoRef(undefined)).toBe(false);
    });
  });

  describe("CERTIFIED vs UNCERTIFIED — anchor-agnostic", () => {
    // The guard does NOT discriminate by qualificationAnchor. CERTIFIED
    // courses (CIO/CTO Standard with anchor sias-cio-cto-v6) and
    // UNCERTIFIED courses (Big Five, Psychology, IELTS Speaking) both
    // pass when refs are well-formed and both fail equally when refs
    // are placeholders. The check is on ref SHAPE, not certification
    // state. This test pins the contract.
    it("CERTIFIED Standard's refs pass the same gate as UNCERTIFIED Big Five's refs", () => {
      // Certified (anchored Curriculum on sandbox):
      expect(() =>
        assertValidLoRefBatch(["STD-04-01", "STD-04-02", "STD-09-01"]),
      ).not.toThrow();
      // Uncertified (no anchor):
      expect(() =>
        assertValidLoRefBatch(["OUT-01", "OUT-02", "OUT-03"]),
      ).not.toThrow();
    });

    it("CERTIFIED course with placeholder refs fails the gate (same as uncertified)", () => {
      expect(() =>
        assertValidLoRefBatch(["LO1", "LO2", "LO3"], "standard-unit-04"),
      ).toThrow(InvalidLoRefError);
      expect(() =>
        assertValidLoRefBatch(["LO1", "LO2", "LO3"], "big-five-foundations"),
      ).toThrow(InvalidLoRefError);
    });
  });
});
