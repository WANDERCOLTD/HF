/**
 * Behavioural tests for `lib/curriculum/derive-focus-area.ts` (#1955).
 *
 * Pins (Boaz/Eldar pre-voice gap analysis Unit 4.1 / 4.2 bar):
 *   - Returns lowest-scoring IELTS skill criterion when scores exist
 *   - Returns null when no scores exist (first-ever session)
 *   - Returns null when callerTargets is empty
 *   - Returns null when moduleSlug is empty
 *   - Ignores non-IELTS-skill parameter ids
 *   - Ignores rows with null / non-finite currentScore
 *   - Result carries the human-readable label for prompt + banner agreement
 */

import { describe, it, expect } from "vitest";
import {
  deriveFocusArea,
  IELTS_SKILL_LABELS,
} from "@/lib/curriculum/derive-focus-area";

const FC = "skill_fluency_and_coherence_fc";
const P = "skill_pronunciation_p";
const LR = "skill_lexical_resource_lr";
const GRA = "skill_grammatical_range_and_accuracy_gra";

describe("deriveFocusArea", () => {
  it("returns the lowest-scored IELTS skill criterion", () => {
    const result = deriveFocusArea(
      [
        { parameterId: FC, currentScore: 0.7 },
        { parameterId: P, currentScore: 0.6 },
        { parameterId: LR, currentScore: 0.4 },
        { parameterId: GRA, currentScore: 0.55 },
      ],
      "part3",
    );
    expect(result).not.toBeNull();
    expect(result!.parameterId).toBe(LR);
    expect(result!.label).toBe("Lexical Resource");
    expect(result!.paramSlug).toBe("lexical_resource");
    expect(result!.score).toBe(0.4);
    expect(result!.moduleSlug).toBe("part3");
    expect(result!.loRef).toBeNull();
  });

  it("picks a different focus when a different skill is weakest", () => {
    const result = deriveFocusArea(
      [
        { parameterId: FC, currentScore: 0.3 },
        { parameterId: P, currentScore: 0.7 },
        { parameterId: LR, currentScore: 0.8 },
        { parameterId: GRA, currentScore: 0.9 },
      ],
      "part3",
    );
    expect(result).not.toBeNull();
    expect(result!.parameterId).toBe(FC);
    expect(result!.label).toBe("Fluency and Coherence");
  });

  it("returns null when no scores exist (first-ever session)", () => {
    const result = deriveFocusArea([], "part3");
    expect(result).toBeNull();
  });

  it("returns null when every IELTS row has null currentScore", () => {
    const result = deriveFocusArea(
      [
        { parameterId: FC, currentScore: null },
        { parameterId: P, currentScore: null },
        { parameterId: LR, currentScore: undefined as unknown as number },
      ],
      "part3",
    );
    expect(result).toBeNull();
  });

  it("returns null when moduleSlug is empty", () => {
    const result = deriveFocusArea(
      [{ parameterId: LR, currentScore: 0.4 }],
      "",
    );
    expect(result).toBeNull();
  });

  it("ignores non-IELTS-skill parameter ids", () => {
    const result = deriveFocusArea(
      [
        { parameterId: "BEH-WARMTH", currentScore: 0.1 },
        { parameterId: "BEH-PACE", currentScore: 0.2 },
        { parameterId: LR, currentScore: 0.6 },
      ],
      "part3",
    );
    expect(result).not.toBeNull();
    // LR is the only IELTS skill in the input, so it wins despite the
    // lower BEH-* scores.
    expect(result!.parameterId).toBe(LR);
  });

  it("ignores rows with non-finite currentScore (NaN / Infinity)", () => {
    const result = deriveFocusArea(
      [
        { parameterId: FC, currentScore: NaN },
        { parameterId: P, currentScore: Infinity },
        { parameterId: LR, currentScore: 0.5 },
      ],
      "part3",
    );
    expect(result).not.toBeNull();
    expect(result!.parameterId).toBe(LR);
  });

  it("score of 0 still counts (valid demonstrated score, just at the floor)", () => {
    const result = deriveFocusArea(
      [
        { parameterId: FC, currentScore: 0.6 },
        { parameterId: LR, currentScore: 0 },
      ],
      "part3",
    );
    expect(result).not.toBeNull();
    expect(result!.parameterId).toBe(LR);
    expect(result!.score).toBe(0);
  });

  it("label table covers all 4 canonical IELTS skill parameter ids", () => {
    expect(IELTS_SKILL_LABELS[FC]).toBe("Fluency and Coherence");
    expect(IELTS_SKILL_LABELS[P]).toBe("Pronunciation");
    expect(IELTS_SKILL_LABELS[LR]).toBe("Lexical Resource");
    expect(IELTS_SKILL_LABELS[GRA]).toBe("Grammatical Range and Accuracy");
  });
});
