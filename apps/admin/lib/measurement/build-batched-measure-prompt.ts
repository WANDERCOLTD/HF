/**
 * Builds the batched MEASURE prompt for `runBatchedCallerAnalysis`.
 *
 * #1539 — replaces the inline `buildBatchedCallerPrompt` that used to
 * live in `app/api/calls/[callId]/pipeline/route.ts`. The old builder
 * sent only `parameterId:name` pairs to the LLM; it never injected the
 * `AnalysisSpec.promptTemplate` rubric. The LLM scored `IELTS-FLUENCY`
 * based on its own internalised idea of "fluency" instead of the IELTS
 * band 1-9 descriptors stored in the spec.
 *
 * This builder interpolates each parameter's `promptTemplate` verbatim
 * as a `RUBRIC[<parameterId>]:\n<template>` block. Parameters whose
 * spec has `promptTemplate = null` (legacy / under-specced) fall back
 * to the name+definition shape AND log an `[measure] unspecced
 * parameter` warning, so the gap is visible in operator dashboards.
 *
 * The shape of the LLM's JSON response is unchanged — adding rubric
 * blocks does not change the contract the response parser depends on.
 */

import type { ParameterWithSpec } from "./parameter-spec-map";

export interface BuildBatchedMeasurePromptInput {
  transcript: string;
  measureParams: ParameterWithSpec[];
  learnActions: Array<{
    category: string;
    keyPrefix: string;
    keyHint: string;
    description: string;
  }>;
  transcriptLimit?: number;
  moduleContext?: {
    moduleId: string;
    moduleName: string;
    learningOutcomes: string[];
  } | null;
  assessmentPromptInstructions?: string | null;
  /** Logger for unspecced-parameter warnings. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

const DEFAULT_TRANSCRIPT_LIMIT = 4000;

export function buildBatchedMeasurePrompt({
  transcript,
  measureParams,
  learnActions,
  transcriptLimit = DEFAULT_TRANSCRIPT_LIMIT,
  moduleContext,
  assessmentPromptInstructions,
  log,
}: BuildBatchedMeasurePromptInput): string {
  const paramList = measureParams
    .map((p) => `${p.parameterId}:${p.name}`)
    .join("|");

  const rubricBlocks: string[] = [];
  const unspecced: Array<{ parameterId: string; specSlug: string }> = [];
  for (const p of measureParams) {
    if (p.promptTemplate && p.promptTemplate.trim().length > 0) {
      rubricBlocks.push(
        `RUBRIC[${p.parameterId}] (from spec ${p.specSlug}):\n${p.promptTemplate.trim()}`,
      );
    } else {
      unspecced.push({ parameterId: p.parameterId, specSlug: p.specSlug });
      const defLine = p.definition
        ? ` Definition: ${p.definition.trim()}`
        : "";
      rubricBlocks.push(
        `RUBRIC[${p.parameterId}] (from spec ${p.specSlug}, no promptTemplate set — fall back to definition):\n${p.name}.${defLine}`,
      );
    }
  }

  if (unspecced.length > 0 && log) {
    log(
      `[measure] ${unspecced.length} parameter(s) lack a promptTemplate; ` +
        `fell back to name+definition. #1539 — populate the spec's ` +
        `promptTemplate to ground the LLM.`,
      { unspecced },
    );
  }

  const learnList = learnActions
    .map((a) => {
      const keys = a.keyHint || `${a.keyPrefix}item`;
      return `- ${a.category}: ${a.description}. Use keys like: ${keys}`;
    })
    .join("\n");

  let learningSection = "";
  let learningJsonHint = "";
  if (moduleContext?.learningOutcomes?.length) {
    const loList = moduleContext.learningOutcomes
      .map((lo) => `- ${JSON.stringify(lo)}`)
      .join("\n");
    const exampleRef = moduleContext.learningOutcomes[0];
    const exampleOutcomes = JSON.stringify({ [exampleRef]: 0.6 });
    const instructions =
      assessmentPromptInstructions ||
      "Score caller's demonstrated understanding of each outcome 0-1 (0=no evidence, 0.5=partial, 1=full mastery).";
    learningSection = `\n\nLEARNING OUTCOMES TO ASSESS (module "${moduleContext.moduleName}"):\n${loList}\n\nCRITICAL: Use the EXACT strings above as keys in "outcomes" — copy them verbatim. Do NOT invent placeholders like "LO1", "LO2".\n\n${instructions}`;
    learningJsonHint = `,"learning":{"moduleId":"${moduleContext.moduleId}","outcomes":${exampleOutcomes},"overallMastery":0.7}`;
  }

  return `Analyze transcript. Score caller 0-1 on params, extract ALL personal facts.

TRANSCRIPT (analyze this — read the ENTIRE transcript including the end):
${transcript.slice(0, transcriptLimit)}

PARAMS TO SCORE: ${paramList}

SCORING RUBRICS (use the matching rubric for each parameter — DO NOT guess from the parameter name alone):
${rubricBlocks.join("\n\n")}

FACTS TO EXTRACT (use the suggested keys, extract EVERY fact mentioned including names, pets, family, preferences):
${learnList}${learningSection}

For each param, also include EVIDENCE FIELDS:
- "he" (hasLearnerEvidence): true if the LEARNER's own utterances contain scoreable evidence for this param. false if the score is inferred from the tutor's prose only.
- "eq" (evidenceQuality): 0-1 confidence that the LEARNER produced enough material to score this param. 0 = nothing scoreable, 1 = abundant evidence.

Return compact JSON:
{"scores":{"PARAM-ID":{"s":0.75,"c":0.8,"he":true,"eq":0.7},...},"memories":[{"cat":"RELATIONSHIP","key":"family_pet","val":"dog called Fred","c":0.9,"e":"my dog is called Fred"},...]${learningJsonHint}}`;
}
