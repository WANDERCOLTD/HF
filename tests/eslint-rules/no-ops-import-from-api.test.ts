import { describe, it } from "vitest";
import rule from "../../apps/admin/eslint-rules/no-ops-import-from-api.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-ops-import-from-api", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-ops-import-from-api", rule as never);
  });
});
