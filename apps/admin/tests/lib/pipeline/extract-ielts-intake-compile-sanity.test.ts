/**
 * Compile-sanity test for IELTS-INTAKE-001.
 *
 * Pins that the spec parses through `parseJsonSpec` AND compiles through
 * `compileSpecToTemplate` AND the compiled template contains the
 * `{{transcript}}` placeholder (without which the LLM never sees the call
 * transcript and extraction is impossible).
 *
 * This test exists separately from the main pin (`extract-ielts-intake.test.ts`)
 * because compileSpecToTemplate pulls in heavier dependencies; isolating
 * it keeps the structural pin fast.
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { parseJsonSpec } from "@/lib/bdd/ai-parser";
import { compileSpecToTemplate } from "@/lib/bdd/compile-specs";

const SPEC_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "docs-archive",
  "bdd-specs",
  "IELTS-INTAKE-001-ielts-intake-profile.spec.json",
);

describe("IELTS-INTAKE-001 — compile sanity (parses + transcript placeholder survives)", () => {
  it("parses through parseJsonSpec without errors", () => {
    const raw = fs.readFileSync(SPEC_PATH, "utf8");
    const result = parseJsonSpec(raw);

    if (!result.success) {
      throw new Error(`parseJsonSpec failed: ${result.errors.join(", ")}`);
    }
    expect(result.success).toBe(true);
    expect(result.data.id).toBe("IELTS-INTAKE-001");
    expect(result.data.outputType).toBe("LEARN");
  });

  it("compiles through compileSpecToTemplate and the result includes {{transcript}}", () => {
    const raw = fs.readFileSync(SPEC_PATH, "utf8");
    const parsed = parseJsonSpec(raw);
    if (!parsed.success) {
      throw new Error(`parseJsonSpec failed: ${parsed.errors.join(", ")}`);
    }

    const compiled = compileSpecToTemplate(parsed.data);

    // The compiled template is what seed-from-specs.ts assigns to
    // AnalysisSpec.promptTemplate. At runtime, lib/ops/memory-extract.ts
    // does `promptTemplate.replace(/\{\{transcript\}\}/g, transcript...)`
    // — if the placeholder is missing, the LLM never sees the transcript
    // and extraction silently returns nothing.
    expect(compiled.promptTemplate).toMatch(/\{\{transcript\}\}/);
    expect(compiled.promptTemplate.length).toBeGreaterThan(100);
  });
});
