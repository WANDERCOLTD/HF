import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-undeclared-field-require.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-undeclared-field-require", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-undeclared-field-require", rule as never);
  });
});
