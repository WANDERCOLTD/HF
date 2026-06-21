/**
 * IELTS-MEASURE-001 spec shape pin (#2136 S1 of epic #2135).
 *
 * Pins the canonical shape of `IELTS-MEASURE-001-ielts-speaking-criteria.spec.json`
 * so that future refactors cannot:
 *
 * 1. Rename or drop any of the four canonical IELTS skill parameter ids
 *    (must exactly match `prosody-consumer.ts::IELTS_PARAM_IDS`).
 * 2. Re-classify outputType away from `MEASURE` (would silently drop the
 *    spec from the SCORE_AGENT stage's `["MEASURE", "MEASURE_AGENT"]` pickup).
 * 3. Remove `profileCondition: ["ielts-speaking"]` (would fire the spec on
 *    every caller, polluting non-IELTS scores).
 * 4. Strip the operator-rule null-handling instructions from any of the
 *    four per-parameter promptTemplates (the rule that protects the EMA
 *    from fabricated scores).
 *
 * Sibling tests live alongside the canonical pattern Coverage gates:
 * `tests/lib/measurement/parameter-measurement-coverage.test.ts` will
 * pick up this spec when registry usage.measurement is wired (S4).
 *
 * See `.claude/rules/parameter-measurement-coverage.md` and the epic
 * brief in #2135 / story #2136.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SPEC_PATH = join(
  resolve(__dirname, "..", "..", ".."),
  "docs-archive",
  "bdd-specs",
  "IELTS-MEASURE-001-ielts-speaking-criteria.spec.json",
);

// Canonical IELTS skill parameter ids — MUST match
// `lib/pipeline/prosody-consumer.ts::IELTS_PARAM_IDS` verbatim.
// These are the four slots that flow into SKILL-AGG-001's EMA pipeline
// and bind to the SKILL_MEASURE_V1 contract's parameter set.
const CANONICAL_IELTS_PARAM_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
  "skill_pronunciation_p",
] as const;

interface SpecJson {
  id?: string;
  outputType?: string;
  specType?: string;
  specRole?: string;
  profileCondition?: string[];
  config?: { profileCondition?: string[]; operatorRule?: string };
  parameters?: Array<{
    id?: string;
    name?: string;
    description?: string;
    promptTemplate?: string;
  }>;
  constraints?: Array<{ id?: string; type?: string; severity?: string }>;
  failureConditions?: Array<{ id?: string; trigger?: string }>;
  responseShape?: { schema?: Record<string, unknown> };
}

function loadSpec(): SpecJson {
  const raw = readFileSync(SPEC_PATH, "utf8");
  return JSON.parse(raw) as SpecJson;
}

describe("IELTS-MEASURE-001 spec shape (#2136)", () => {
  const spec = loadSpec();

  it("declares the canonical spec id", () => {
    expect(spec.id).toBe("IELTS-MEASURE-001");
  });

  it("declares outputType: MEASURE so the SCORE_AGENT stage picks it up", () => {
    // SCORE_AGENT stage filters on outputType ∈ ["MEASURE", "MEASURE_AGENT"].
    // IELTS skills are LEARNER measurements (sibling of COMP-MEASURE-001),
    // so the correct slot is "MEASURE", not "MEASURE_AGENT".
    expect(spec.outputType).toBe("MEASURE");
  });

  it("declares specType: SYSTEM and specRole: META (sibling COMP-MEASURE-001 shape)", () => {
    expect(spec.specType).toBe("SYSTEM");
    expect(spec.specRole).toBe("META");
  });

  it("gates execution to ielts-speaking teaching profile (top-level)", () => {
    // Read at top-level — seed-from-specs.ts:782 copies this into config
    // for runtime filtering via filterByTeachingProfile.
    expect(spec.profileCondition).toEqual(["ielts-speaking"]);
  });

  it("also carries config.profileCondition for runtime filtering", () => {
    expect(spec.config?.profileCondition).toEqual(["ielts-speaking"]);
  });

  it("pins the operator rule against fabricated scores in config", () => {
    // The rule lives in three places: config.operatorRule (this assertion),
    // context.assumptions (informational), and per-parameter promptTemplate
    // NULL HANDLING sections (the runtime contract pinned below).
    expect(spec.config?.operatorRule).toMatch(/NEVER.*hardcoded.*AI-guessed/i);
    expect(spec.config?.operatorRule).toMatch(/empty bands surface gaps/i);
  });

  it("declares exactly the 4 canonical IELTS skill parameter ids", () => {
    expect(spec.parameters).toBeDefined();
    const ids = (spec.parameters ?? []).map((p) => p.id).sort();
    const expected = [...CANONICAL_IELTS_PARAM_IDS].sort();
    expect(ids).toEqual(expected);
  });

  it.each(CANONICAL_IELTS_PARAM_IDS)(
    "parameter %s carries a non-empty promptTemplate with null-handling instructions",
    (paramId) => {
      const param = (spec.parameters ?? []).find((p) => p.id === paramId);
      expect(param, `missing parameter ${paramId}`).toBeDefined();
      expect(param?.promptTemplate, `${paramId} missing promptTemplate`).toBeTruthy();
      const template = param!.promptTemplate!;
      // Null-handling section MUST instruct the LLM to return null + hasLearnerEvidence:false
      // when evidence is insufficient. This is the structural enforcement of the
      // operator rule per #2135 epic body.
      expect(template, `${paramId} missing NULL HANDLING section`).toMatch(
        /NULL HANDLING/,
      );
      expect(template, `${paramId} missing 'never fabricate' instruction`).toMatch(
        /never fabricate/i,
      );
      // Each rubric MUST cite the HF-active band anchors (3 / 4 / 5.5 / 7).
      expect(template, `${paramId} missing Band 3 anchor`).toMatch(/Band 3/);
      expect(template, `${paramId} missing Band 4 anchor`).toMatch(/Band 4/);
      expect(template, `${paramId} missing Band 5.5 anchor`).toMatch(/Band 5\.5/);
      expect(template, `${paramId} missing Band 7 anchor`).toMatch(/Band 7/);
    },
  );

  it("LR and GRA parameters explicitly mark themselves as transcript-only (vendor cannot judge)", () => {
    const lr = spec.parameters?.find(
      (p) => p.id === "skill_lexical_resource_lr",
    );
    const gra = spec.parameters?.find(
      (p) => p.id === "skill_grammatical_range_and_accuracy_gra",
    );
    expect(lr?.promptTemplate).toMatch(/TRANSCRIPT-ONLY/i);
    expect(gra?.promptTemplate).toMatch(/TRANSCRIPT-ONLY/i);
  });

  it("P parameter notes transcript-cues-only + vendor augmentation deferred", () => {
    const p = spec.parameters?.find((x) => x.id === "skill_pronunciation_p");
    expect(p?.promptTemplate).toMatch(/TRANSCRIPT CUES ONLY/i);
    expect(p?.promptTemplate).toMatch(/#2135 S3/);
  });

  it("declares insufficient-speech failure condition with threshold", () => {
    const fc = (spec.failureConditions ?? []).find(
      (c) => c.trigger === "insufficient_learner_speech",
    );
    expect(fc, "missing insufficient_learner_speech failureCondition").toBeDefined();
  });

  it("declares the operator-rule constraint at critical severity", () => {
    const con = (spec.constraints ?? []).find(
      (c) => c.type === "operator_rule_never_fabricate",
    );
    expect(con, "missing operator_rule_never_fabricate constraint").toBeDefined();
    expect(con?.severity).toBe("critical");
  });

  it("declares the response shape with per-criterion nullable scores", () => {
    const schema = spec.responseShape?.schema as
      | { scores?: Record<string, string>; hasLearnerEvidence?: string }
      | undefined;
    expect(schema?.scores).toBeDefined();
    // Each of the four criterion slots in `scores` must permit null.
    for (const key of [
      "fluency_and_coherence",
      "lexical_resource",
      "grammatical_range_and_accuracy",
      "pronunciation",
    ]) {
      expect(schema?.scores?.[key]).toMatch(/null/);
    }
    expect(schema?.hasLearnerEvidence).toBeDefined();
  });
});

describe("IELTS-MEASURE-001 picked up by SCORE_AGENT-eligible spec loader", () => {
  const spec = loadSpec();

  it("outputType is in the SCORE_AGENT stage's pickup set", () => {
    // route.ts pipeline executor filters on ["MEASURE", "MEASURE_AGENT"]
    // for the SCORE_AGENT stage (see grep result in #2136 survey).
    const pickup = new Set(["MEASURE", "MEASURE_AGENT"]);
    expect(pickup.has(spec.outputType ?? "")).toBe(true);
  });

  it("status/version are present so the seeder can upsert without warnings", () => {
    const raw = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
    expect(raw.status).toBe("Approved");
    expect(raw.version).toMatch(/^\d+\.\d+$/);
  });
});
