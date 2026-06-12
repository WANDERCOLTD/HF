import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-bare-call-create.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-call-create", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-call-create", rule as never);
  });
});
