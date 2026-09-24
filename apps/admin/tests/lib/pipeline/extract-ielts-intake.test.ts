/**
 * Tests for IELTS-INTAKE-001 EXTRACT spec (epic #2277 Path A, Item #6).
 *
 * Pins the structural shape of the spec JSON: it MUST advertise the
 * canonical (outputType=LEARN, specRole=EXTRACT, specType=SYSTEM) tuple
 * so the spec-driven extractMemories runner picks it up, and the prompt
 * surface MUST encode the four IELTS intake facts + STRICT GROUNDING
 * CONTRACT so the LLM never fabricates a band, date, or reason.
 *
 * The runner that consumes this spec lives at lib/ops/memory-extract.ts
 * (extractWithSpec). It reads:
 *   - spec.outputType === "LEARN" + isActive: true   → spec is loaded.
 *   - spec.config.llmConfig.systemPrompt              → system message.
 *   - spec.promptTemplate (compiled from parameters)  → user message,
 *     {{transcript}} is substituted in.
 *   - spec.config.promptGuidance                       → appended to user.
 *   - spec.config.confidenceThreshold                  → memory floor.
 *
 * Per the operator brief (Item #6, Path A): no runtime / runner / consumer
 * changes — this is a DATA-only edit. Consumer side (memoryDeltas loader
 * → composed prompt) is already wired by PR #1644.
 *
 * Story: #2277. Spec file: docs-archive/bdd-specs/IELTS-INTAKE-001-*.spec.json
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const SPEC_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "docs-archive",
  "bdd-specs",
  "IELTS-INTAKE-001-ielts-intake-profile.spec.json",
);

interface IeltsIntakeSpec {
  id: string;
  title: string;
  status: string;
  domain: string;
  specType: string;
  specRole: string;
  outputType: string;
  profileCondition: string[];
  config: {
    profileCondition: string[];
    llmConfig: {
      maxTokens: number;
      temperature: number;
      engine: string;
      systemPrompt: string;
    };
    confidenceThreshold: number;
    defaultExtractConfidence: number;
    transcriptTruncateLength: number;
    promptGuidance: string;
    defaultCategory: string;
  };
  story: { asA: string; iWant: string; soThat: string };
  context: { applies: string; dependsOn: string[]; assumptions: string[] };
  acceptanceCriteria: Array<{ id: string; title: string }>;
  constraints: Array<{ id: string; type: string; description: string; severity: string }>;
  parameters: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

function loadSpec(): IeltsIntakeSpec {
  const raw = fs.readFileSync(SPEC_PATH, "utf8");
  return JSON.parse(raw) as IeltsIntakeSpec;
}

describe("IELTS-INTAKE-001 spec — Path A DATA-only edit, epic #2277 Item #6", () => {
  const spec = loadSpec();

  describe("dispatch shape — runner picks up the spec", () => {
    it("declares the canonical LEARN-spec tuple so extractMemories loads it", () => {
      // The runner at lib/ops/memory-extract.ts filters
      // `prisma.analysisSpec.findMany({ where: { outputType: "LEARN", isActive: true } })`
      // and routes each spec through extractWithSpec.
      expect(spec.outputType).toBe("LEARN");
      expect(spec.specRole).toBe("EXTRACT");
      expect(spec.specType).toBe("SYSTEM");
      expect(spec.status).toBe("Approved");
    });

    it("declares the IELTS profileCondition for downstream surfaces that scope per playbook", () => {
      // IELTS-MEASURE-001 uses the same shape — playbook gating via
      // BehaviorTarget presence + profileCondition. The memory-extract
      // runner does not yet honour this gate (per the operator brief —
      // grounding contract IS the gate today), but the marker is in
      // the spec so a future runner extension can adopt it.
      expect(spec.profileCondition).toEqual(["ielts-speaking"]);
      expect(spec.config.profileCondition).toEqual(["ielts-speaking"]);
    });

    it("targets domain 'ielts-intake-profile' so seed-from-specs.ts seeds it under that namespace", () => {
      expect(spec.domain).toBe("ielts-intake-profile");
    });
  });

  describe("LLM config — system prompt enforces the grounding contract", () => {
    it("system prompt enumerates the four facts and forbids fabrication", () => {
      const sp = spec.config.llmConfig.systemPrompt;
      expect(sp).toMatch(/four/i);
      expect(sp).toMatch(/IELTS/i);
      expect(sp).toMatch(/explicitly stated/i);
      expect(sp).toMatch(/NEVER infer/i);
      expect(sp).toMatch(/NEVER guess/i);
      expect(sp).toMatch(/NEVER use plausible defaults/i);
      expect(sp).toMatch(/OMIT/i);
    });

    it("uses a low LLM temperature so extractions are deterministic", () => {
      // Higher temperatures invite the LLM to "fill in" missing facts —
      // exactly what the grounding contract forbids.
      expect(spec.config.llmConfig.temperature).toBeLessThanOrEqual(0.2);
      expect(spec.config.llmConfig.temperature).toBeGreaterThanOrEqual(0);
    });

    it("sets confidenceThreshold high enough to reject low-evidence extractions", () => {
      // The runner drops memories below this threshold. 0.7 means the
      // LLM must declare evidence-supported confidence.
      expect(spec.config.confidenceThreshold).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("promptGuidance — the four facts are canonically specified", () => {
    const guidance = spec.config.promptGuidance;

    it("specifies all four canonical CallerMemory keys", () => {
      expect(guidance).toMatch(/ielts:target_band/);
      expect(guidance).toMatch(/ielts:self_assessment_band/);
      expect(guidance).toMatch(/ielts:exam_date_iso/);
      expect(guidance).toMatch(/ielts:reason/);
    });

    it("pins the band normalisation rules (0.5 increments, IELTS 0-9)", () => {
      // The LLM must coerce 'I want a 7' / 'Band 6.5' to canonical
      // '7.0' / '6.5' strings — downstream consumers depend on this
      // canonical form.
      expect(guidance).toMatch(/0\.5 increments/i);
      expect(guidance).toMatch(/'7\.0'/);
      expect(guidance).toMatch(/'6\.5'/);
    });

    it("pins the ISO 8601 date format for exam_date_iso", () => {
      expect(guidance).toMatch(/ISO 8601/);
      expect(guidance).toMatch(/YYYY-MM-DD/);
    });

    it("pins the reason format and category enum", () => {
      // Reason values must be '<category>: <free text>' — the five
      // categories are the enumerated set the spec depends on for
      // structured filtering.
      expect(guidance).toMatch(/<category>:\s*<free text/);
      expect(guidance).toMatch(/university/);
      expect(guidance).toMatch(/work/);
      expect(guidance).toMatch(/visa/);
      expect(guidance).toMatch(/residency/);
      expect(guidance).toMatch(/professional-registration/);
    });

    it("instructs the LLM to OMIT missing facts (no nulls, no placeholders)", () => {
      // This is the load-bearing grounding-contract clause. Per
      // .claude/rules/verify-before-fix.md + the 2026-06-21 operator
      // rule against hardcoded score backfill — honest empty bands
      // surface real gaps; fabricated values corrupt the adaptive
      // cascade.
      expect(guidance).toMatch(/OMIT/);
      expect(guidance).toMatch(/empty array/i);
      expect(guidance).toMatch(/expiresInDays.*null/);
    });

    it("requires evidence (transcript quote) on every extracted fact", () => {
      // Evidence is the mechanism that makes grounding inspectable
      // post-hoc. Memories without evidence are rejected by the
      // confidence-threshold gate.
      expect(guidance).toMatch(/evidence/);
      expect(guidance).toMatch(/direct quote/);
    });
  });

  describe("parameters — the compiled promptTemplate substitutes {{transcript}}", () => {
    it("has at least one parameter so compileLearnSpec produces a non-empty template", () => {
      // The seed-from-specs.ts pipeline calls compileSpecToTemplate
      // on every spec; for LEARN specs it walks parameters[] and
      // emits the descriptive template that becomes the user-message
      // prompt for the runner's LLM call.
      expect(spec.parameters.length).toBeGreaterThanOrEqual(1);
    });

    it("includes {{transcript}} placeholder so the runner substitutes the call transcript in", () => {
      // The runner at extractWithSpec does:
      //   renderedPrompt = promptTemplate.replace(/\{\{transcript\}\}/g, transcript)
      // If no {{transcript}} marker exists in the compiled template,
      // the LLM never sees the transcript and extraction is impossible.
      const allDescriptions = spec.parameters.map((p) => p.description).join("\n");
      expect(allDescriptions).toMatch(/\{\{transcript\}\}/);
    });
  });

  describe("acceptance criteria — every fact has its AC + grounding AC pins fabrication ban", () => {
    it("declares 5 acceptance criteria (one per fact + one for the grounding contract)", () => {
      expect(spec.acceptanceCriteria.length).toBeGreaterThanOrEqual(5);
      const ids = spec.acceptanceCriteria.map((ac) => ac.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          "AC-IELTS-INTAKE-001", // target_band
          "AC-IELTS-INTAKE-002", // self_assessment_band
          "AC-IELTS-INTAKE-003", // exam_date_iso
          "AC-IELTS-INTAKE-004", // reason
          "AC-IELTS-INTAKE-005", // grounding contract (no fabrication)
        ]),
      );
    });
  });

  describe("constraints — every load-bearing invariant is declared", () => {
    it("declares the grounding constraint at critical severity", () => {
      const grounding = spec.constraints.find((c) => c.type === "grounding");
      expect(grounding).toBeDefined();
      expect(grounding!.severity).toBe("critical");
    });

    it("declares the no-fabrication constraint at critical severity", () => {
      const noFab = spec.constraints.find((c) => c.type === "no_fabrication");
      expect(noFab).toBeDefined();
      expect(noFab!.severity).toBe("critical");
    });

    it("declares the value-normalisation constraint at critical severity", () => {
      const norm = spec.constraints.find((c) => c.type === "value_normalisation");
      expect(norm).toBeDefined();
      expect(norm!.severity).toBe("critical");
    });

    it("declares the permanent-facts constraint (expiresAt=null, decayFactor=1.0)", () => {
      const perm = spec.constraints.find((c) => c.type === "permanent_facts");
      expect(perm).toBeDefined();
      // The runner stamps decayFactor by default (1.0); expiresAt is set
      // only when the LLM emits expiresInDays > 0. The spec's prompt
      // tells the LLM to ALWAYS emit expiresInDays: null for these facts.
      expect(perm!.description).toMatch(/expiresInDays.*null|null.*expiresAt/i);
    });
  });
});
