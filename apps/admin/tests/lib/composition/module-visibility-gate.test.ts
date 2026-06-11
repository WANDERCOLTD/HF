import { describe, it, expect } from "vitest";
import {
  DEFAULT_FIRST_CALL_MODULE_VISIBILITY,
  FIRST_CALL_MODULE_VISIBILITY_VALUES,
  isFirstCallModuleVisibility,
  shouldSuppressModuleNames,
  SUPPRESSED_INTRODUCE_STEP,
  SUPPRESSED_NEW_MATERIAL_MODULE,
  SUPPRESSED_THIS_SESSION_COPY,
} from "@/lib/prompt/composition/transforms/module-visibility-gate";

describe("module-visibility-gate (#1405)", () => {
  describe("type guard + constants", () => {
    it("default is mention_from_call_1", () => {
      expect(DEFAULT_FIRST_CALL_MODULE_VISIBILITY).toBe("mention_from_call_1");
    });

    it("enumerates all three values in canonical order", () => {
      expect([...FIRST_CALL_MODULE_VISIBILITY_VALUES]).toEqual([
        "mention_from_call_1",
        "hide_until_call_2",
        "hide_until_learner_picks",
      ]);
    });

    it("isFirstCallModuleVisibility accepts every valid value", () => {
      for (const v of FIRST_CALL_MODULE_VISIBILITY_VALUES) {
        expect(isFirstCallModuleVisibility(v)).toBe(true);
      }
    });

    it("isFirstCallModuleVisibility rejects unknown / non-string values", () => {
      expect(isFirstCallModuleVisibility("bogus")).toBe(false);
      expect(isFirstCallModuleVisibility(null)).toBe(false);
      expect(isFirstCallModuleVisibility(undefined)).toBe(false);
      expect(isFirstCallModuleVisibility(42)).toBe(false);
      expect(isFirstCallModuleVisibility({})).toBe(false);
    });

    it("exports stable replacement copy that is NOT a greeting (hf-compose lint)", () => {
      const GREETING_REGEX =
        /^\s*(hi|hello|hey|welcome|good\s+(morning|afternoon|evening))(\s|[,!.?]|$)/i;
      for (const copy of [
        SUPPRESSED_THIS_SESSION_COPY,
        SUPPRESSED_NEW_MATERIAL_MODULE,
        SUPPRESSED_INTRODUCE_STEP,
      ]) {
        expect(GREETING_REGEX.test(copy)).toBe(false);
      }
    });
  });

  describe("shouldSuppressModuleNames — default / absent", () => {
    it("absent firstCallModuleVisibility ⇒ no suppression (back-compat)", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: undefined,
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: null,
        }),
      ).toBe(false);
    });

    it("explicit mention_from_call_1 ⇒ no suppression", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "mention_from_call_1",
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: null,
        }),
      ).toBe(false);
    });
  });

  describe("shouldSuppressModuleNames — hide_until_call_2", () => {
    it("isFirstCall=true + no pick ⇒ suppress", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "hide_until_call_2",
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: null,
        }),
      ).toBe(true);
    });

    it("isFirstCall=false (call 2+) ⇒ no suppression (resets after call 1)", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "hide_until_call_2",
          isFirstCall: false,
          callNumber: 2,
          lastSelectedModuleId: null,
        }),
      ).toBe(false);
    });

    it("isFirstCall=true + learner picked ⇒ no suppression (pick wins)", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "hide_until_call_2",
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: "mod_abc",
        }),
      ).toBe(false);
    });
  });

  describe("shouldSuppressModuleNames — hide_until_learner_picks", () => {
    it("isFirstCall=true + no pick ⇒ suppress", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "hide_until_learner_picks",
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: null,
        }),
      ).toBe(true);
    });

    it("isFirstCall=false + no pick on call 3 ⇒ still suppress (persists past call 2)", () => {
      expect(
        shouldSuppressModuleNames({
          firstCallModuleVisibility: "hide_until_learner_picks",
          isFirstCall: false,
          callNumber: 3,
          lastSelectedModuleId: null,
        }),
      ).toBe(true);
    });

    it("learner picked ⇒ no suppression (any call number)", () => {
      for (const callNumber of [1, 2, 5, 17]) {
        expect(
          shouldSuppressModuleNames({
            firstCallModuleVisibility: "hide_until_learner_picks",
            isFirstCall: callNumber === 1,
            callNumber,
            lastSelectedModuleId: "mod_xyz",
          }),
        ).toBe(false);
      }
    });
  });

  describe("shouldSuppressModuleNames — defensive default", () => {
    it("unknown enum value ⇒ no suppression (forward-compat)", () => {
      // Cast through `any` is the boundary we're guarding against — a
      // future enum entry written to the DB but not yet known to this
      // version of the helper should leave compose output untouched
      // rather than accidentally suppress.
      expect(
        shouldSuppressModuleNames({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          firstCallModuleVisibility: "future_mode" as any,
          isFirstCall: true,
          callNumber: 1,
          lastSelectedModuleId: null,
        }),
      ).toBe(false);
    });
  });
});
