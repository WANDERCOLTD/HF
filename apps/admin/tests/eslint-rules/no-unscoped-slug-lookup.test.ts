import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-unscoped-slug-lookup.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-unscoped-slug-lookup", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-unscoped-slug-lookup", rule as never);
  });
});
