import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-direct-domain-onboarding-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-direct-domain-onboarding-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-direct-domain-onboarding-write", rule as never);
  });
});
