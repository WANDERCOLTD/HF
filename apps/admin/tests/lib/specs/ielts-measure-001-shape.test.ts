/**
 * IELTS-MEASURE-001 spec shape pin (#2136 S1 of epic #2135).
 *
 * Pins the canonical shape of `IELTS-MEASURE-001-ielts-speaking-criteria.spec.json`
 * so that future refactors cannot:
 *
 * 1. Rename or drop any of the four canonical IELTS skill parameter ids.
 *    Post-#2138 (epic #2135 S3) the IELTS-MEASURE-001 LLM spec is the
 *    SOLE writer of these IDs via the canonical SCORE_AGENT path;
 *    prosody-consumer now writes its own disjoint `prosody_raw_*`
 *    namespace.
 * 2. Re-classify outputType away from `MEASURE` (would silently drop the
 *    spec from the SCORE_AGENT stage's `["MEASURE", "MEASURE_AGENT"]` pickup).
 * 3. Remove `profileCondition: ["ielts-speaking"]` (would fire the spec on
 *    every caller, polluting non-IELTS scores).
 * 4. Strip the operator-rule null-handling instructions from any of the
 *    four per-parameter promptTemplates (the rule that protects the EMA
 *    from fabricated scores).
 *
 * Post-IP-review (PR #2143):
 *
 * 5. (Decision 1) Pronunciation uses DUAL-CONFIDENCE scoring — the
 *    responseShape's `scores.pronunciation` is an object carrying both
 *    `value` and `confidence` ('low' | 'medium' | 'high').
 * 6. (Decision 3 anti-regression) The literal phrase "third conditional"
 *    must NOT appear anywhere in the spec — Band 7 is flexibility + accuracy
 *    across the structural inventory per the public IELTS descriptor; no
 *    single named structure is required.
 * 7. (Decision 4) The duplicate `operator_rule_never_fabricate` constraint
 *    is removed — the operator rule lives in `config.operatorRule` (canonical
 *    declaration) + per-parameter NULL HANDLING blocks (closest to where
 *    the LLM scores). Two places, not three.
 * 8. (Decision 2 anti-regression) The literal substring "idiom" must NOT
 *    appear inside any LR Band 5 / Band 5.5 anchor (interpretation-scale
 *    entry or scoring anchor rationale). Idiom is a Band 7 expectation per
 *    the RUB-LR descriptor.
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

// Canonical IELTS skill parameter ids. Post-#2138 (epic #2135 S3) these
// are written EXCLUSIVELY by IELTS-MEASURE-001 via SCORE_AGENT — prosody
// writes a disjoint `prosody_raw_*` namespace. These four slots flow into
// SKILL-AGG-001's EMA pipeline and bind to the SKILL_MEASURE_V1 contract's
// parameter set.
const CANONICAL_IELTS_PARAM_IDS = [
  "skill_fluency_and_coherence_fc",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
  "skill_pronunciation_p",
] as const;

interface ScoringAnchor {
  score?: number;
  example?: string;
  rationale?: string;
  isGold?: boolean;
}

interface InterpretationScaleEntry {
  min?: number;
  max?: number;
  label?: string;
  implication?: string;
}

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
    interpretationScale?: InterpretationScaleEntry[];
    scoringAnchors?: ScoringAnchor[];
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

  it("P parameter declares dual-confidence scoring + vendor augmentation deferred to S3 (Decision 1)", () => {
    const p = spec.parameters?.find((x) => x.id === "skill_pronunciation_p");
    expect(p?.promptTemplate).toMatch(/DUAL-CONFIDENCE/i);
    expect(p?.promptTemplate).toMatch(/confidence/i);
    expect(p?.promptTemplate).toMatch(/#2135 S3/);
    // The transcript-only confidence cap is the load-bearing part of the design.
    expect(p?.promptTemplate).toMatch(/cap.*medium|≤\s*medium|medium\.\s+Never\s+['']?high/i);
  });

  it("declares insufficient-speech failure condition with threshold", () => {
    const fc = (spec.failureConditions ?? []).find(
      (c) => c.trigger === "insufficient_learner_speech",
    );
    expect(fc, "missing insufficient_learner_speech failureCondition").toBeDefined();
  });

  it("(Decision 4) does NOT declare a duplicate operator_rule_never_fabricate constraint", () => {
    // Pre-IP-review, the operator rule was pinned in 3 places (config.operatorRule,
    // constraints[0], every per-parameter NULL HANDLING block). Decision 4 dropped
    // the middle duplication. The rule still lives in config.operatorRule (canonical
    // declaration) + per-parameter NULL HANDLING (closest to where LLM is scoring).
    const con = (spec.constraints ?? []).find(
      (c) => c.type === "operator_rule_never_fabricate",
    );
    expect(
      con,
      "operator_rule_never_fabricate constraint should be removed (Decision 4 — drop the 3-place redundancy to 2)",
    ).toBeUndefined();
  });

  it("retains the canonical operator rule in config.operatorRule (Decision 4 — the kept place)", () => {
    // The operator rule's canonical home is config.operatorRule. After Decision 4
    // dropped the constraints[] duplication, this stays as the SoT alongside the
    // per-parameter NULL HANDLING blocks (the runtime LLM-visible enforcement).
    expect(spec.config?.operatorRule).toMatch(/NEVER.*hardcoded.*AI-guessed/i);
  });

  it("(Decision 2 anti-regression) the literal substring 'idiom' does NOT appear in any LR Band 5 / Band 5.5 anchor", () => {
    // The RUB-LR descriptor places idiom at Band 7 (the lift from 5.5 → 7). The
    // Band 5/5.5 anchor language was previously contaminated with idiomatic content
    // ('catchy', 'in the zone') and prose framing that demanded idiom at 5.5. Post-
    // Decision-2 the Band 5/5.5 anchor describes successful-paraphrase emergence on
    // literal vocabulary; idiom enters at Band 7.
    const lr = spec.parameters?.find(
      (p) => p.id === "skill_lexical_resource_lr",
    );
    expect(lr, "missing LR parameter").toBeDefined();

    // interpretationScale: any entry whose label mentions Band 5 (or 5.5) must NOT
    // mention idiom in its implication text.
    for (const entry of lr?.interpretationScale ?? []) {
      if (entry.label && /Band\s*5/.test(entry.label)) {
        expect(
          entry.implication ?? "",
          `LR ${entry.label} interpretation must not contain 'idiom'`,
        ).not.toMatch(/idiom/i);
      }
    }

    // scoringAnchors: score 0.611 is the Band 5.5 slot (the band that previously
    // over-promised idiom). Lower bands (3, 4) are allowed to mention idiom in
    // their negative descriptors ("no idiomatic items at Band 4" is correct and
    // useful — it sets up the contrast). The contamination this test catches is
    // idiom showing up as a Band 5.5 expectation.
    const band55Anchor = lr?.scoringAnchors?.find(
      (a) => typeof a.score === "number" && a.score >= 0.5 && a.score < 0.65,
    );
    expect(
      band55Anchor,
      "LR Band 5.5 scoring anchor (score in [0.5, 0.65)) must exist",
    ).toBeDefined();
    expect(
      band55Anchor?.rationale ?? "",
      `LR Band 5.5 scoring anchor (score ${band55Anchor?.score}) must not contain 'idiom'`,
    ).not.toMatch(/idiom/i);
  });

  it("(Decision 3 anti-regression) the literal phrase 'third conditional' does NOT appear anywhere in the spec", () => {
    // Per the public IELTS GRA Band 7 descriptor, "a range of structures flexibly
    // used; error-free sentences frequent; both simple and complex used effectively
    // despite some errors" — NO specific structure (including third conditional)
    // is required. Anchoring Band 7 to third conditional would bias the LLM toward
    // a specific construction and miss flexible Band-7 performance on other forms.
    const raw = readFileSync(SPEC_PATH, "utf8");
    expect(raw, "spec must not anchor Band 7 GRA to 'third conditional'").not.toMatch(
      /third[- ]conditional/i,
    );
  });

  it("(Decision 1) declares the response shape with per-criterion nullable scores AND confidence on pronunciation", () => {
    const schema = spec.responseShape?.schema as
      | {
          scores?: Record<string, unknown>;
          hasLearnerEvidence?: string;
        }
      | undefined;
    expect(schema?.scores).toBeDefined();

    // FC / LR / GRA: nullable scalar scores (definitionally transcript-judged).
    for (const key of [
      "fluency_and_coherence",
      "lexical_resource",
      "grammatical_range_and_accuracy",
    ]) {
      const slot = schema?.scores?.[key];
      expect(typeof slot, `${key} should be a string description`).toBe("string");
      expect(slot as string).toMatch(/null/);
    }

    // Pronunciation: dual-confidence object with `value` (nullable) + `confidence`.
    const pronunciation = schema?.scores?.pronunciation as
      | { value?: string; confidence?: string }
      | undefined;
    expect(
      pronunciation,
      "scores.pronunciation must be an object carrying value + confidence (Decision 1)",
    ).toBeTypeOf("object");
    expect(pronunciation?.value, "scores.pronunciation.value must permit null").toMatch(/null/);
    expect(
      pronunciation?.confidence,
      "scores.pronunciation.confidence must declare the 'low' | 'medium' | 'high' enum (Decision 1)",
    ).toMatch(/low.*medium.*high|low.*\|.*medium.*\|.*high/i);

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
