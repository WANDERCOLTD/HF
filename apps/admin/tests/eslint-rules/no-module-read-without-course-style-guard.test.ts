import { describe, it } from "vitest";
import rule from "../../eslint-rules/no-module-read-without-course-style-guard.mjs";
import { smokeRule } from "./_helpers.js";

describe("no-module-read-without-course-style-guard", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("no-module-read-without-course-style-guard", rule as never);
  });
});
