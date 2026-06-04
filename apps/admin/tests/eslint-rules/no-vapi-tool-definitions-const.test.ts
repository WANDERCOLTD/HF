/**
 * Tests for eslint-rules/hf-voice/no-vapi-tool-definitions-const.mjs
 * (AnyVoice #1024). Pins: VAPI_TOOL_DEFINITIONS const declaration fires;
 * other identifier patterns including the canonical replacement
 * (loadToolDefinitions) do NOT.
 */

import { RuleTester } from "eslint";
import rule from "../../eslint-rules/hf-voice/no-vapi-tool-definitions-const.mjs";

// See sibling no-vapi-column-ref.test.ts for why RuleTester.run sits at
// module top level and why the rule object is cast.
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-vapi-tool-definitions-const", rule as never, {
      valid: [
        // Canonical replacement — pass through
        {
          code: `
            import { loadToolDefinitions } from "@/lib/voice/load-tool-definitions";
            const tools = await loadToolDefinitions();
          `,
        },
        // Differently-named constants — pass through (rule is exact-name)
        {
          code: `const VOICE_TOOL_DEFINITIONS = [];`,
        },
        {
          code: `const MY_CUSTOM_TOOLS = [];`,
        },
        // Importing the symbol (not declaring it) — pass through. The
        // rule blocks the DECLARATION; an import would fail at runtime
        // anyway since the symbol no longer exists.
        {
          code: `import { someUnrelated } from "./other";`,
        },
      ],
      invalid: [
        // Bare const declaration
        {
          code: `const VAPI_TOOL_DEFINITIONS = [];`,
          errors: [{ messageId: "hardcodedConstant" }],
        },
        // Exported const declaration
        {
          code: `export const VAPI_TOOL_DEFINITIONS = [{ type: "function" }];`,
          errors: [{ messageId: "hardcodedConstant" }],
        },
        // `let` is also forbidden — same name, same intent
        {
          code: `let VAPI_TOOL_DEFINITIONS = [];`,
          errors: [{ messageId: "hardcodedConstant" }],
        },
      ],
});
