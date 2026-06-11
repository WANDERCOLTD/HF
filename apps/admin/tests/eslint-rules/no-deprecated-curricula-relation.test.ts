import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-deprecated-curricula-relation.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-deprecated-curricula-relation", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-deprecated-curricula-relation", rule as never);
  });
});
