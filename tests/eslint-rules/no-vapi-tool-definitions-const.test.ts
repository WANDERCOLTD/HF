import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/hf-voice/no-vapi-tool-definitions-const.mjs";
import { smokeRule } from "./_helpers.js";

describe("hf-voice/no-vapi-tool-definitions-const", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-vapi-tool-definitions-const", rule as never);
  });
});
