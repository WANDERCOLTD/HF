import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-hardcoded-spec-slug.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-hardcoded-spec-slug", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-hardcoded-spec-slug", rule as never);
  });
});
