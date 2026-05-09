/**
 * Tests for validateUpdateSetupFields — the per-field enum validator
 * that guards `update_setup` against mis-routed values (#315).
 *
 * Today's incident: AI mis-routed value `"learner-picks"` (a
 * `progressionMode` option) into the `interactionPattern` field. The wrong
 * field silently accepted it, the right field never got set, create_course
 * BLOCKED, and the wizard hallucinated a success message.
 *
 * @see GitHub issue #315
 * @see lib/chat/wizard-tool-executor.ts
 */

import { describe, it, expect } from "vitest";
import { validateUpdateSetupFields } from "@/lib/chat/wizard-tool-executor";

describe("validateUpdateSetupFields — interactionPattern", () => {
  it("rejects a progressionMode value written to interactionPattern", () => {
    const result = validateUpdateSetupFields({ interactionPattern: "learner-picks" });
    expect(result).not.toBeNull();
    expect(result?.field).toBe("interactionPattern");
    expect(result?.value).toBe("learner-picks");
    expect(result?.suggestedField).toBe("progressionMode");
  });

  it("accepts each valid interactionPattern value", () => {
    const valid = [
      "socratic",
      "directive",
      "advisory",
      "coaching",
      "companion",
      "facilitation",
      "reflective",
      "open",
      "conversational-guide",
    ];
    for (const v of valid) {
      expect(validateUpdateSetupFields({ interactionPattern: v })).toBeNull();
    }
  });

  it("rejects a freeform/unknown string for interactionPattern", () => {
    const result = validateUpdateSetupFields({ interactionPattern: "warm-and-fuzzy" });
    expect(result?.field).toBe("interactionPattern");
    // No sibling field has "warm-and-fuzzy" — suggestedField undefined
    expect(result?.suggestedField).toBeUndefined();
  });
});

describe("validateUpdateSetupFields — progressionMode", () => {
  it("rejects an interactionPattern value written to progressionMode", () => {
    const result = validateUpdateSetupFields({ progressionMode: "socratic" });
    expect(result?.field).toBe("progressionMode");
    expect(result?.value).toBe("socratic");
    expect(result?.suggestedField).toBe("interactionPattern");
  });

  it("accepts ai-led", () => {
    expect(validateUpdateSetupFields({ progressionMode: "ai-led" })).toBeNull();
  });

  it("accepts learner-picks", () => {
    expect(validateUpdateSetupFields({ progressionMode: "learner-picks" })).toBeNull();
  });
});

describe("validateUpdateSetupFields — pass-through fields", () => {
  it("ignores fields not in the enum registry (free-text + computed bag keys)", () => {
    expect(
      validateUpdateSetupFields({
        institutionName: "IELTS Prep Lab",
        courseName: "IELTS Speaking Practice",
        existingDomainId: "176f6bc3-cbcd-4fb6-8076-2aa5039479fc",
        sessionCount: 12,
        durationMins: 20,
        welcomeGoals: false,
        uploadSourceIds: ["src-a", "src-b"],
      }),
    ).toBeNull();
  });

  it("ignores non-string values for enum-typed fields", () => {
    // A numeric or boolean value isn't a known mis-route — let it through
    // to the existing downstream validation path.
    expect(validateUpdateSetupFields({ interactionPattern: 42 })).toBeNull();
    expect(validateUpdateSetupFields({ progressionMode: null })).toBeNull();
  });

  it("returns the FIRST invalid pair when multiple bad values present", () => {
    const result = validateUpdateSetupFields({
      interactionPattern: "learner-picks",
      progressionMode: "directive",
    });
    expect(result).not.toBeNull();
    // Order is insertion order — interactionPattern first
    expect(result?.field).toBe("interactionPattern");
  });
});

describe("validateUpdateSetupFields — empty input", () => {
  it("returns null for an empty fields object", () => {
    expect(validateUpdateSetupFields({})).toBeNull();
  });
});
