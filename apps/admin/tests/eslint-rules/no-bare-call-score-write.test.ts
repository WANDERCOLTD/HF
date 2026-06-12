import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-bare-call-score-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-bare-call-score-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-bare-call-score-write", rule as never);
  });
});
