import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-direct-playbook-config-write.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-direct-playbook-config-write", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-direct-playbook-config-write", rule as never);
  });
});
