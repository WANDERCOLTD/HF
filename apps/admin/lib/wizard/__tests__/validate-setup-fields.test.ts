/**
 * validate-setup-fields.test.ts
 *
 * Validates the wizard's update_setup field-name guard. The four cases
 * below correspond to the #318 follow-up brief — they prove that:
 *   1. Value-based redirects still auto-correct silently (no is_error)
 *   2. Pure-unknown keys still surface as an error with a suggestion
 *   3. KNOWN_AUTO_DROP keys (modulesAuthored, constraints) are dropped
 *      silently and reported in the `dropped` array
 *   4. The validator does NOT enforce the cross-field progressionMode
 *      gate — that lives in the executor and is covered by its own
 *      integration test elsewhere.
 */

import { describe, it, expect } from "vitest";
import { validateSetupFields } from "../validate-setup-fields";

describe("validateSetupFields — #318 follow-up", () => {
  it("auto-corrects interactionPattern=learner-picks → progressionMode (no error)", () => {
    const result = validateSetupFields({ interactionPattern: "learner-picks" });
    expect(result.errors).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toMatchObject({
      from: "interactionPattern",
      to: "progressionMode",
    });
    expect(result.validated).toEqual({ progressionMode: "learner-picks" });
  });

  it("pure-unknown key (bogusField) is rejected with a suggestion", () => {
    const result = validateSetupFields({ bogusField: "x", courseName: "Hello" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ key: "bogusField" });
    // Sanity: validated still contains the known good field
    expect(result.validated.courseName).toBe("Hello");
    // No drops, no spurious corrections
    expect(result.dropped).toEqual([]);
  });

  it("modulesAuthored is auto-dropped (no error, no validated entry)", () => {
    const result = validateSetupFields({ modulesAuthored: true });
    expect(result.errors).toEqual([]);
    expect(result.corrections).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toMatchObject({ key: "modulesAuthored" });
    expect(result.validated).toEqual({});
  });

  it("constraints is auto-dropped (no error, no validated entry)", () => {
    const result = validateSetupFields({ constraints: ["no swearing", "no medical advice"] });
    expect(result.errors).toEqual([]);
    expect(result.corrections).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toMatchObject({ key: "constraints" });
    expect(result.validated).toEqual({});
  });

  it("mixed payload: known + auto-drop + unknown → only unknown is an error", () => {
    const result = validateSetupFields({
      courseName: "X",
      modulesAuthored: true,
      bogusField: 1,
      interactionPattern: "ai-led", // → progressionMode
    });
    // Errors: only bogusField
    expect(result.errors.map((e) => e.key)).toEqual(["bogusField"]);
    // Drops: modulesAuthored
    expect(result.dropped.map((d) => d.key)).toEqual(["modulesAuthored"]);
    // Corrections: interactionPattern → progressionMode
    expect(result.corrections.map((c) => c.from)).toEqual(["interactionPattern"]);
    // Validated: courseName + progressionMode (NOT modulesAuthored, NOT bogusField)
    expect(result.validated).toEqual({ courseName: "X", progressionMode: "ai-led" });
  });

  it("moduleProgression → progressionMode (existing FIELD_NAME_CORRECTIONS path)", () => {
    const result = validateSetupFields({ moduleProgression: "ai-led" });
    expect(result.errors).toEqual([]);
    expect(result.corrections).toHaveLength(1);
    expect(result.validated).toEqual({ progressionMode: "ai-led" });
  });
});
