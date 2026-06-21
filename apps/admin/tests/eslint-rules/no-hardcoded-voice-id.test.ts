/**
 * Behavioral + structural tests for `eslint-rules/no-hardcoded-voice-id.mjs` (#2184).
 *
 * smokeRule (HF-F: one location per rule, both checks here) + RuleTester
 * behavioural cases.
 *
 * Pins:
 *   - fires on a Deepgram Aura voice-ID literal in a chat handler (the
 *     #2184 fingerprint at `lib/chat/admin-tool-handlers.ts:2861`)
 *   - fires on a Cartesia Sonic voice-ID literal in non-voice runtime code
 *   - does NOT fire in `lib/voice/**` (provider initialisation)
 *   - does NOT fire in `lib/config.ts` (config.voice.defaults LIVES there)
 *   - does NOT fire in tests / scripts / prisma seed
 *   - does NOT fire on non-voice-ID-shaped strings
 *   - does NOT fire on `config.voice.defaults.<provider>.voiceId` reads
 *     (identifier, not literal)
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-hardcoded-voice-id.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-hardcoded-voice-id", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-hardcoded-voice-id", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const CHAT_HANDLER = "/repo/apps/admin/lib/chat/admin-tool-handlers.ts";
const LIB_GENERIC = "/repo/apps/admin/lib/chat/some-other-handler.ts";
const VOICE_DIR = "/repo/apps/admin/lib/voice/providers/deepgram/catalogue.ts";
const CONFIG = "/repo/apps/admin/lib/config.ts";
const TEST = "/repo/apps/admin/tests/lib/voice/sample.test.ts";
const SEED = "/repo/apps/admin/prisma/seed-from-specs.ts";
const SAMPLE_ROUTE =
  "/repo/apps/admin/app/api/voice-providers/[id]/sample/route.ts";

tester.run("no-hardcoded-voice-id", rule as never, {
  valid: [
    // Deepgram Aura voice-ID literal in lib/voice/** — provider catalogue surface.
    { filename: VOICE_DIR, code: `const x = "aura-asteria-en";` },
    // Voice-ID literal in config.ts — config.voice.defaults LIVES here.
    { filename: CONFIG, code: `const DEFAULT = "aura-asteria-en";` },
    // In a test file — fixtures are fine.
    { filename: TEST, code: `const x = "aura-asteria-en";` },
    // In seed — seed data is allowed.
    { filename: SEED, code: `const v = "aura-helios-en";` },
    // Voice-provider sample route constructs catalogue model names.
    { filename: SAMPLE_ROUTE, code: `const x = "aura-asteria-en";` },
    // config.voice.defaults.<provider>.voiceId — identifier access, not a literal.
    {
      filename: LIB_GENERIC,
      code: `const x = config.voice.defaults.deepgram.voiceId;`,
    },
    // Non-voice-ID-shaped string in runtime code — should not fire.
    { filename: LIB_GENERIC, code: `const x = "hello-world";` },
    // Looks similar but no language suffix — not the Aura shape.
    { filename: LIB_GENERIC, code: `const x = "aura-asteria";` },
  ],
  invalid: [
    // The #2184 fingerprint: bare Aura voice-ID in admin-tool-handlers.ts.
    {
      filename: CHAT_HANDLER,
      code: `const voiceId = somethingElse || "aura-asteria-en";`,
      errors: [{ messageId: "hardcoded" }],
    },
    // Aura with a different voice — same shape, same rule.
    {
      filename: LIB_GENERIC,
      code: `const v = "aura-helios-en";`,
      errors: [{ messageId: "hardcoded" }],
    },
    // Cartesia Sonic voice-ID shape in non-voice runtime code.
    {
      filename: LIB_GENERIC,
      code: `const v = "sonic-amelia-en-female";`,
      errors: [{ messageId: "hardcoded" }],
    },
  ],
});
