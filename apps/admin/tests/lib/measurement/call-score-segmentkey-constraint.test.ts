/**
 * Critical PR-time flag for #1700 Theme 6 / story #1702.
 *
 * `CallScore.segmentKey` is an ANNOTATION column — it records which Mock
 * part produced a score. Epic #1700 decision 1 is explicit: the
 * `(callId, parameterId, moduleId)` unique key MUST stay untouched.
 *
 * Widening it to include `segmentKey` would let one PROSODY / per-segment
 * pass write multiple rows per criterion for the same module, breaking the
 * idempotence `writeCallScore` relies on. This test pins the constraint
 * shape so a future migration that widens it fails the bank before it
 * reaches hf-staging.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
);

/** Extract the `model CallScore { ... }` block from the schema text. */
function callScoreBlock(): string {
  const start = schema.indexOf("model CallScore {");
  expect(start).toBeGreaterThan(-1);
  // Find the matching closing brace at column 0 (`\n}`).
  const end = schema.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return schema.slice(start, end);
}

describe("CallScore.segmentKey — annotation, not idempotence key (#1702)", () => {
  const block = callScoreBlock();

  it("declares segmentKey as a nullable String annotation column", () => {
    expect(block).toMatch(/\n\s+segmentKey\s+String\?/);
  });

  it("keeps the unique key exactly (callId, parameterId, moduleId)", () => {
    expect(block).toContain("@@unique([callId, parameterId, moduleId])");
  });

  it("never widens the unique key to include segmentKey", () => {
    // Any @@unique line in the CallScore block that mentions segmentKey is a
    // regression of epic #1700 decision 1.
    const uniqueLines = block
      .split("\n")
      .filter((l) => l.includes("@@unique"));
    for (const line of uniqueLines) {
      expect(line).not.toContain("segmentKey");
    }
  });
});
