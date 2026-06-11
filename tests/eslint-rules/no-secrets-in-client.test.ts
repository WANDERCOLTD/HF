import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-secrets-in-client.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-secrets-in-client", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-secrets-in-client", rule as never);
  });
});
