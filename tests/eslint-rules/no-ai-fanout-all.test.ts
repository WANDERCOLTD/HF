import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-ai-fanout-all.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-ai-fanout-all", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-ai-fanout-all", rule as never);
  });
});
