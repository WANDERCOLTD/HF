import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-hardcoded-greeting-in-composition.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-hardcoded-greeting-in-composition", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-hardcoded-greeting-in-composition", rule as never);
  });
});
