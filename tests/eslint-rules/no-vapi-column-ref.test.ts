import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/hf-voice/no-vapi-column-ref.mjs";
import { smokeRule } from "./_helpers.js";

describe("hf-voice/no-vapi-column-ref", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-vapi-column-ref", rule as never);
  });
});
