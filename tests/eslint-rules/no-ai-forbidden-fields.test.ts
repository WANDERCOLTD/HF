import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-ai-forbidden-fields.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-ai-forbidden-fields", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-ai-forbidden-fields", rule as never);
  });
});
