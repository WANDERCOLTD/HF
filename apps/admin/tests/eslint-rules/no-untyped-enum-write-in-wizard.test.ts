/**
 * Behavioural tests for
 * `eslint-rules/no-untyped-enum-write-in-wizard.mjs` — story #1995.
 *
 * The rule blocks bare `as string` casts on enum-bearing wizard config
 * fields inside `lib/chat/wizard-tool-executor/**` and `admin-tools.ts`
 * / `admin-tool-handlers.ts`. Born of the live IELTS Speaking Practice
 * incident on hf_sandbox 2026-06-18: `teachingMode = "directive"` (an
 * `interactionPattern` value) reached the DB via this exact bare-cast
 * pattern.
 *
 * Pairs with the runtime type guards in
 * `lib/content-trust/resolve-config.ts` (`isTeachingMode`,
 * `isInteractionPattern`, …) and the enum sets in
 * `lib/wizard/enum-sets.ts`.
 *
 * Pins:
 *   - fires on `obj.teachingMode = (x as string)` inside guarded file
 *   - fires on `{ teachingMode: x as string }` inside guarded file
 *   - fires on `const t = (input.teachingMode as string) || ...`
 *   - fires for every enum-bearing field name
 *   - does NOT fire outside the guarded fragments
 *   - does NOT fire on free-form string fields (`welcomeMessage`,
 *     `subjectDiscipline`, `courseContext`, `physicalMaterials`)
 *   - does NOT fire in test files (sub-fragment)
 *   - does NOT fire when value is not a cast (already typed correctly)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "../../eslint-rules/no-untyped-enum-write-in-wizard.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-untyped-enum-write-in-wizard", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-untyped-enum-write-in-wizard", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser as never,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

const NEW_MERGE =
  "/repo/apps/admin/lib/chat/wizard-tool-executor/tools/create_course/_new-config-merge.ts";
const REUSE_MERGE =
  "/repo/apps/admin/lib/chat/wizard-tool-executor/tools/create_course/_reuse-config-merge.ts";
const ADMIN_TOOLS = "/repo/apps/admin/lib/chat/admin-tools.ts";
const ADMIN_HANDLERS = "/repo/apps/admin/lib/chat/admin-tool-handlers.ts";
const OTHER_FILE = "/repo/apps/admin/lib/some-unrelated-helper.ts";
const TEST_FILE =
  "/repo/apps/admin/tests/lib/wizard/something.test.ts";

tester.run("no-untyped-enum-write-in-wizard", rule as never, {
  valid: [
    // Outside guarded fragment — no enforcement.
    {
      filename: OTHER_FILE,
      code: `const x = (input.teachingMode as string) || "fallback";`,
    },
    // Test files — no enforcement (allow-list).
    {
      filename: TEST_FILE,
      code: `const x = (input.teachingMode as string) || "fallback";`,
    },
    // Guarded file but no cast — already typed correctly.
    {
      filename: NEW_MERGE,
      code: `if (input.teachingMode) configUpdate.teachingMode = input.teachingMode;`,
    },
    // Free-form string field — bare cast is fine.
    {
      filename: NEW_MERGE,
      code: `const w = (input.welcomeMessage as string) || "";`,
    },
    {
      filename: REUSE_MERGE,
      code: `configUpdate.subjectDiscipline = (input.subjectDiscipline as string) || "";`,
    },
    {
      filename: ADMIN_TOOLS,
      code: `const c = (input.courseContext as string) || "";`,
    },
    // Value is the result of a guard call — already validated.
    {
      filename: NEW_MERGE,
      code: `if (isTeachingMode(input.teachingMode)) { configUpdate.teachingMode = input.teachingMode; }`,
    },
    // Guarded file, enum field assignment with non-cast value (post-#1995 shape).
    {
      filename: NEW_MERGE,
      code: `if (isInteractionPattern(p)) configUpdate.interactionPattern = p;`,
    },
  ],
  invalid: [
    // Pattern A: assignment expression
    {
      filename: NEW_MERGE,
      code: `configUpdate.teachingMode = input.teachingMode as string;`,
      errors: [{ messageId: "bareEnumCast" }],
    },
    // Pattern B: object literal property
    {
      filename: REUSE_MERGE,
      code: `const c = { teachingMode: input.teachingMode as string };`,
      errors: [{ messageId: "bareEnumCast" }],
    },
    // Pattern C: VariableDeclarator with named binding, LogicalExpression init
    {
      filename: NEW_MERGE,
      code: `const newTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);`,
      errors: [
        { messageId: "bareEnumCast" },
        { messageId: "bareEnumCast" },
      ],
    },
    // Same pattern for interactionPattern
    {
      filename: REUSE_MERGE,
      code: `const ip = (input.interactionPattern as string) || (setupData?.interactionPattern as string);`,
      errors: [
        { messageId: "bareEnumCast" },
        { messageId: "bareEnumCast" },
      ],
    },
    // Audience
    {
      filename: NEW_MERGE,
      code: `const a = (input.audience as string) || (setupData?.audience as string);`,
      errors: [
        { messageId: "bareEnumCast" },
        { messageId: "bareEnumCast" },
      ],
    },
    // PlanEmphasis
    {
      filename: REUSE_MERGE,
      code: `const p = (input.planEmphasis as string);`,
      errors: [{ messageId: "bareEnumCast" }],
    },
    // LessonPlanModel
    {
      filename: NEW_MERGE,
      code: `const l = (input.lessonPlanModel as string);`,
      errors: [{ messageId: "bareEnumCast" }],
    },
    // FirstCallMode in admin-tool-handlers
    {
      filename: ADMIN_HANDLERS,
      code: `updates.firstCallMode = input.firstCallMode as string;`,
      errors: [{ messageId: "bareEnumCast" }],
    },
    // ProgressionMode
    {
      filename: NEW_MERGE,
      code: `const pm = (input.progressionMode as string) || (setupData?.progressionMode as string);`,
      errors: [
        { messageId: "bareEnumCast" },
        { messageId: "bareEnumCast" },
      ],
    },
  ],
});
