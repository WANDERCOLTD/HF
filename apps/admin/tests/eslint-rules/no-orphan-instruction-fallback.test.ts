import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-orphan-instruction-fallback.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-orphan-instruction-fallback", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-orphan-instruction-fallback", rule as never);
  });
});
