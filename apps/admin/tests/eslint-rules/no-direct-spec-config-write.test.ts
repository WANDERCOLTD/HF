import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-direct-spec-config-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-direct-spec-config-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-direct-spec-config-write", rule as never);
  });
});
