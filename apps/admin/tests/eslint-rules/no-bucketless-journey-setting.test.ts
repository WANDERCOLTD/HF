/**
 * Behavioural + structural tests for
 * `eslint-rules/no-bucketless-journey-setting.mjs` — #1738.
 *
 * Pins:
 *   - fires on a JourneySettingContract literal without `menuGroupKey`
 *   - does NOT fire when `menuGroupKey` is present (any string)
 *   - does NOT fire in voice-setting-contracts.ts (Settings tab sibling)
 *   - does NOT fire in test files / `__tests__/`
 *   - does NOT fire on nested objects (autoEnableLinks entries that also
 *     have an `id` field — the discriminator is `educatorLabel +
 *     storagePath` co-presence)
 *   - only runs on `lib/journey/setting-contracts.entries.ts`
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-bucketless-journey-setting.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bucketless-journey-setting", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bucketless-journey-setting", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const ENTRIES = "/repo/apps/admin/lib/journey/setting-contracts.entries.ts";
const VOICE = "/repo/apps/admin/lib/settings/voice-setting-contracts.ts";
const TEST = "/repo/apps/admin/tests/lib/journey/setting-contracts.test.ts";
const TESTS_DIR_TEST = "/repo/apps/admin/__tests__/journey.test.ts";
const UNRELATED = "/repo/apps/admin/lib/random/other-file.ts";

const VALID_WITH_BUCKET = `
const G2_WELCOME = {
  id: "welcomeMessage",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Welcome message",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: ["welcome"], kinds: ["section-content"], requiresReprompt: false },
  previewLocators: [{ section: "welcome" }],
};
`;

const INVALID_WITHOUT_BUCKET = `
const G2_WELCOME = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Welcome message",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: ["welcome"], kinds: ["section-content"], requiresReprompt: false },
  previewLocators: [{ section: "welcome" }],
};
`;

const NESTED_OBJ_WITH_ID_ONLY = `
const G2_WELCOME = {
  id: "welcomeMessage",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Welcome message",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: ["welcome"], kinds: ["section-content"], requiresReprompt: false },
  previewLocators: [{ section: "welcome" }],
  autoEnableLinks: [
    { targetId: "someOther", whenValue: true, enforce: true, decoupleAllowed: false, reason: "x" },
  ],
};
`;

tester.run("no-bucketless-journey-setting", rule as never, {
  valid: [
    // Has menuGroupKey — pass.
    { filename: ENTRIES, code: VALID_WITH_BUCKET },
    // Nested autoEnableLinks entry has no menuGroupKey but isn't a top-
    // level contract (missing educatorLabel + storagePath) — discriminator
    // skips it.
    { filename: ENTRIES, code: NESTED_OBJ_WITH_ID_ONLY },
    // Voice registry — allow-listed by path.
    { filename: VOICE, code: INVALID_WITHOUT_BUCKET },
    // Test files — allow-listed.
    { filename: TEST, code: INVALID_WITHOUT_BUCKET },
    { filename: TESTS_DIR_TEST, code: INVALID_WITHOUT_BUCKET },
    // Unrelated file — path guard short-circuits before the AST visit.
    { filename: UNRELATED, code: INVALID_WITHOUT_BUCKET },
  ],
  invalid: [
    // Top-level JourneySettingContract in the registry file lacking
    // menuGroupKey — fires.
    {
      filename: ENTRIES,
      code: INVALID_WITHOUT_BUCKET,
      errors: [{ messageId: "missingBucket", data: { id: "welcomeMessage" } }],
    },
  ],
});
