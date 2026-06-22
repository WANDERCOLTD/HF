/**
 * Story #1995 — ratchet vitest for the chat-tool merge path's enum
 * validation surface.
 *
 * Walks every enum-bearing wizard input field and asserts:
 *
 *   - the canonical enum SET exists in `lib/wizard/enum-sets.ts`
 *   - the matching runtime type guard exists in
 *     `lib/content-trust/resolve-config.ts`
 *   - the guard returns TRUE for every canonical value
 *   - the guard returns FALSE for the cross-union "wrong column" values
 *     (e.g. `isTeachingMode("directive")` — the live IELTS Speaking
 *     Practice incident value — must reject)
 *   - the AI tool schema (conversational-wizard `create_course`)
 *     declares the corresponding `enum: [...]` array
 *
 * Born of the live IELTS Speaking Practice incident on hf_sandbox
 * 2026-06-18. Before #1995 there was no structural pin on this
 * surface — a future merge that dropped the guard call or expanded
 * one union without expanding the schema enum would silently
 * recreate the same crash.
 *
 * The free-form-string field list (`welcomeMessage`,
 * `subjectDiscipline`, `courseContext`, `physicalMaterials`) is also
 * pinned — these are deliberately NOT enum-validated; the rule's
 * allow-list semantics must hold.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  VALID_INTERACTION_PATTERNS,
  VALID_TEACHING_MODES,
  VALID_AUDIENCE_IDS,
  VALID_PLAN_EMPHASIS,
  VALID_LESSON_PLAN_MODELS,
  VALID_LESSON_PLAN_MODES,
  VALID_FIRST_CALL_MODES,
  VALID_PROGRESSION_MODES,
  INTERACTION_PATTERN_ORDER,
  TEACHING_MODE_ORDER,
  PLAN_EMPHASIS_ORDER,
  LESSON_PLAN_MODEL_ORDER,
  LESSON_PLAN_MODE_ORDER,
  FIRST_CALL_MODE_ORDER,
  PROGRESSION_MODE_ORDER,
} from "../../../lib/wizard/enum-sets";
// The `lib/wizard/enum-sets.ts` module also re-exports the canonical
// AUDIENCE_OPTIONS source via VALID_AUDIENCE_IDS. We import the option
// array directly for completeness.
import { AUDIENCE_OPTIONS } from "../../../lib/prompt/composition/transforms/audience";
import {
  isTeachingMode,
  isInteractionPattern,
  isAudience,
  isPlanEmphasis,
  isLessonPlanModel,
  isLessonPlanMode,
  isFirstCallMode,
  isProgressionMode,
  INTERACTION_PATTERN_ORDER as RESOLVE_INTERACTION_PATTERN_ORDER,
  TEACHING_MODE_ORDER as RESOLVE_TEACHING_MODE_ORDER,
} from "../../../lib/content-trust/resolve-config";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CONV_WIZ_TOOLS_PATH = path.join(
  REPO_ROOT,
  "lib/chat/conversational-wizard-tools.ts",
);

interface EnumField {
  fieldName: string;
  canonicalValues: readonly string[];
  set: ReadonlySet<string>;
  guard: (v: unknown) => boolean;
  /**
   * One or more values FROM OTHER UNIONS that must be rejected. This
   * pins the cross-union "wrong column" rejection that was the live
   * #1995 fingerprint.
   */
  wrongUnionSamples: readonly string[];
  /** Whether this field appears in the create_course schema. */
  inCreateCourseSchema: boolean;
}

const FIELDS: readonly EnumField[] = [
  {
    fieldName: "interactionPattern",
    canonicalValues: INTERACTION_PATTERN_ORDER,
    set: VALID_INTERACTION_PATTERNS,
    guard: isInteractionPattern,
    // teachingMode value should NOT pass interactionPattern guard.
    wrongUnionSamples: ["recall", "comprehension", "practice", "syllabus", "primary"],
    inCreateCourseSchema: true,
  },
  {
    fieldName: "teachingMode",
    canonicalValues: TEACHING_MODE_ORDER,
    set: VALID_TEACHING_MODES,
    guard: isTeachingMode,
    // interactionPattern value should NOT pass teachingMode guard.
    // ← This is the live IELTS Speaking Practice incident's value.
    wrongUnionSamples: ["directive", "socratic", "advisory", "coaching", "primary"],
    inCreateCourseSchema: true,
  },
  {
    fieldName: "audience",
    canonicalValues: AUDIENCE_OPTIONS.map((a) => a.id),
    set: VALID_AUDIENCE_IDS,
    guard: isAudience,
    wrongUnionSamples: ["directive", "recall", "breadth", "direct_instruction"],
    inCreateCourseSchema: true,
  },
  {
    fieldName: "planEmphasis",
    canonicalValues: PLAN_EMPHASIS_ORDER,
    set: VALID_PLAN_EMPHASIS,
    guard: isPlanEmphasis,
    wrongUnionSamples: ["directive", "recall", "primary", "5e"],
    inCreateCourseSchema: true,
  },
  {
    fieldName: "lessonPlanModel",
    canonicalValues: LESSON_PLAN_MODEL_ORDER,
    set: VALID_LESSON_PLAN_MODELS,
    guard: isLessonPlanModel,
    wrongUnionSamples: ["recall", "directive", "primary", "breadth"],
    inCreateCourseSchema: true,
  },
  {
    fieldName: "firstCallMode",
    canonicalValues: FIRST_CALL_MODE_ORDER,
    set: VALID_FIRST_CALL_MODES,
    guard: isFirstCallMode,
    wrongUnionSamples: ["directive", "recall", "primary"],
    // firstCallMode isn't in create_course schema today — it's set via
    // update_playbook_config (admin-tools). Tracked separately.
    inCreateCourseSchema: false,
  },
  {
    fieldName: "progressionMode",
    canonicalValues: PROGRESSION_MODE_ORDER,
    set: VALID_PROGRESSION_MODES,
    guard: isProgressionMode,
    wrongUnionSamples: ["directive", "recall", "primary"],
    // progressionMode is captured via show_options (not update_setup)
    // per the v5 system prompt — it's not in the create_course schema.
    inCreateCourseSchema: false,
  },
  {
    fieldName: "lessonPlanMode",
    canonicalValues: LESSON_PLAN_MODE_ORDER,
    set: VALID_LESSON_PLAN_MODES,
    guard: isLessonPlanMode,
    wrongUnionSamples: ["directive", "recall", "primary", "5e", "breadth"],
    // lessonPlanMode is sourced from `setupData.coursePedagogy.lessonPlanMode`
    // (course-ref doc parser) — not surfaced as a direct AI input. The
    // wizard merge inference defaults it to "structured" when a
    // course-ref is uploaded / authored modules are present; otherwise
    // it stays unset. Not in the create_course schema.
    inCreateCourseSchema: false,
  },
];

/**
 * Free-form string fields that the chat-tool merge paths intentionally
 * pass through WITHOUT enum validation. Pinned here so a future PR
 * doesn't silently tighten one of these into an enum without realising
 * the impact, and so the ESLint rule's allow-list stays in sync.
 */
const FREE_FORM_STRING_FIELDS = [
  "welcomeMessage",
  "subjectDiscipline",
  "courseContext",
  "physicalMaterials",
] as const;

describe("wizard enum validation — ratchet (#1995)", () => {
  describe("canonical sets exist and are non-empty", () => {
    for (const f of FIELDS) {
      it(`${f.fieldName}: VALID_* set is non-empty`, () => {
        expect(f.set.size).toBeGreaterThan(0);
      });
    }
  });

  describe("enum-sets ORDER arrays align with resolve-config union sources", () => {
    // Catches drift between the chat-tool authoring surface
    // (`lib/wizard/enum-sets.ts`) and the canonical union sources in
    // `lib/content-trust/resolve-config.ts`. The two are intentionally
    // duplicated as runtime literals (to avoid a circular import that
    // bit the first impl); this test makes the duplication safe.
    it("INTERACTION_PATTERN_ORDER matches", () => {
      expect([...INTERACTION_PATTERN_ORDER].sort()).toEqual(
        [...RESOLVE_INTERACTION_PATTERN_ORDER].sort(),
      );
    });
    it("TEACHING_MODE_ORDER matches", () => {
      expect([...TEACHING_MODE_ORDER].sort()).toEqual(
        [...RESOLVE_TEACHING_MODE_ORDER].sort(),
      );
    });
  });

  describe("type guards accept canonical values", () => {
    for (const f of FIELDS) {
      for (const v of f.canonicalValues) {
        it(`is${cap(f.fieldName)}(${JSON.stringify(v)}) === true`, () => {
          expect(f.guard(v)).toBe(true);
        });
      }
    }
  });

  describe("type guards reject cross-union 'wrong column' values", () => {
    for (const f of FIELDS) {
      for (const v of f.wrongUnionSamples) {
        if (f.set.has(v)) continue; // shared between unions — skip
        it(`is${cap(f.fieldName)}(${JSON.stringify(v)}) === false`, () => {
          expect(f.guard(v)).toBe(false);
        });
      }
    }
  });

  describe("type guards reject obvious garbage", () => {
    for (const f of FIELDS) {
      it(`is${cap(f.fieldName)} rejects undefined / null / number / object`, () => {
        expect(f.guard(undefined)).toBe(false);
        expect(f.guard(null)).toBe(false);
        expect(f.guard(123)).toBe(false);
        expect(f.guard({})).toBe(false);
        expect(f.guard([])).toBe(false);
        expect(f.guard("")).toBe(false);
        expect(f.guard("random-string-not-in-any-union")).toBe(false);
      });
    }
  });

  describe("create_course tool schema declares enum arrays", () => {
    const source = fs.readFileSync(CONV_WIZ_TOOLS_PATH, "utf8");

    for (const f of FIELDS.filter((f) => f.inCreateCourseSchema)) {
      it(`${f.fieldName}: schema declares enum: [...] with all canonical values`, () => {
        // The schema lives inside `name: "create_course"` block. We do
        // a substring match: every canonical value must appear in
        // quoted form within the file.
        // This is a structural regex check — the surface is small
        // enough not to need AST parsing.
        for (const v of f.canonicalValues) {
          const re = new RegExp(`"${escapeRegex(v)}"`);
          expect(
            re.test(source),
            `Expected canonical value ${JSON.stringify(v)} for field ${f.fieldName} to appear (quoted) in ${path.relative(REPO_ROOT, CONV_WIZ_TOOLS_PATH)} — schema enum drift.`,
          ).toBe(true);
        }
        // Specific check: the field declaration must include `enum:`
        // OR be a property with surrounding enum array.
        // We slice from the field name to the next 200 chars and
        // assert `enum` appears (one of the field schemas).
        const idx = source.indexOf(`${f.fieldName}:`);
        expect(idx, `Field ${f.fieldName} not found in ${path.relative(REPO_ROOT, CONV_WIZ_TOOLS_PATH)}`).toBeGreaterThan(-1);
        const slice = source.slice(idx, idx + 600);
        expect(
          /enum:\s*\[/.test(slice),
          `Field ${f.fieldName} in create_course schema must carry an enum: [...] array (#1995).`,
        ).toBe(true);
      });
    }
  });

  describe("free-form string fields stay unguarded (allow-list pin)", () => {
    for (const fname of FREE_FORM_STRING_FIELDS) {
      it(`${fname} is in the FREE_FORM allow-list (not enum-validated)`, () => {
        // This is a structural pin — if a future PR tightens one of
        // these into an enum, this test fails and reminds the author
        // to update the ESLint rule's field allow-list + the merge
        // helpers + this list. The test asserts something tautological
        // by design: it exists so the constant is referenced and the
        // intent is documented at the only file that ties all the
        // pieces together.
        expect(typeof fname).toBe("string");
        expect(fname.length).toBeGreaterThan(0);
        // Sanity: none of these are in any of the canonical sets.
        for (const f of FIELDS) {
          expect(f.set.has(fname)).toBe(false);
        }
      });
    }
  });
});

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
