/**
 * Curriculum Structure Extraction
 *
 * Takes assertions extracted from a syllabus document and uses AI to generate
 * a structured curriculum: modules, learning outcomes, assessment criteria,
 * teaching order.
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import type { ExtractedAssertion } from "./extract-assertions";
import { getPromptTemplate } from "@/lib/prompts/prompt-settings";
import { sanitizeModuleTitle } from "./sanitize-module";

// ------------------------------------------------------------------
// Meta-pedagogical module guard (epic #131)
// ------------------------------------------------------------------

/**
 * Patterns that identify AI-generated modules describing tutor methodology
 * rather than student-facing learning. Defence in depth: even if the
 * curriculum-extraction prompt's SCOPE rule is ignored, these patterns catch
 * the leak before garbage reaches the DB.
 *
 * Why: on PW: Secret Garden, the AI produced modules like "Session Structure
 * and Flow Management" and "Assessment Framework and Success Metrics" — neither
 * is a student outcome, both belong in the tutor instruction layer.
 */
const META_PEDAGOGICAL_PATTERNS: RegExp[] = [
  /\btutor\b/i,
  /\bsession (?:structure|flow|management)\b/i,
  /\bflow management\b/i,
  /\bteaching (?:practice|methodology|method)\b/i,
  /\bassessment (?:framework|strategy|approach|methodology)\b/i,
  /\bsuccess metrics?\b/i,
  /\bscaffolding technique/i,
  /\bdifferentiation strateg/i,
  /\bcommunication rule/i,
  /\bpedagogical (?:approach|framework)\b/i,
  /\bhow to teach\b/i,
];

/**
 * Filter AI-generated modules, rejecting any whose title or description
 * matches a meta-pedagogical pattern. Mutates the passed warnings array
 * with a human-readable note for each rejection so they surface in the
 * Curriculum tab's scorecard banner.
 */
function filterMetaPedagogicalModules(
  modules: any[],
  warnings: string[],
): any[] {
  if (!Array.isArray(modules)) return [];
  const rejectedTitles: string[] = [];
  const kept = modules.filter((m) => {
    const title = String(m?.title || "").trim();
    const desc = String(m?.description || "").trim();
    const combined = `${title} ${desc}`;
    for (const pattern of META_PEDAGOGICAL_PATTERNS) {
      if (pattern.test(combined)) {
        rejectedTitles.push(title || "(untitled)");
        return false;
      }
    }
    return true;
  });
  if (rejectedTitles.length > 0) {
    const msg = `Rejected ${rejectedTitles.length} meta-pedagogical module(s) from AI output: ${rejectedTitles.map((t) => `"${t}"`).join(", ")}. These describe tutor behaviour, not student learning — they belong in the tutor instruction layer.`;
    console.warn(`[extract-curriculum] ${msg}`);
    warnings.push(msg);
  }
  return kept;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

// Re-export canonical legacy JSON type (AI output shape)
export type { LegacyCurriculumModuleJSON as CurriculumModule } from "@/lib/types/json-fields";

export interface CurriculumIntents {
  sessionCount?: number;    // target number of sessions
  durationMins?: number;    // target minutes per session
  emphasis?: string;        // "breadth" | "balanced" | "depth"
  assessments?: string;     // "formal" | "light" | "none"
}

export interface ExtractedCurriculum {
  ok: boolean;
  name: string;
  description: string;
  modules: CurriculumModule[];
  deliveryConfig: {
    sessionStructure?: string[];
    assessmentStrategy?: string;
    pedagogicalNotes?: string[];
  };
  warnings: string[];
  error?: string;
}

// ------------------------------------------------------------------
// JSON repair helpers
// ------------------------------------------------------------------

/** Strip markdown code fences and attempt common JSON repairs */
function repairJSON(raw: string): string {
  let s = raw.trim();
  // Strip markdown fences: ```json ... ``` or ``` ... ```
  s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, "$1");
  // Fix missing commas between } { or ] [ in arrays (e.g. "}\n  {" → "},\n  {")
  s = s.replace(/\}(\s*)\{/g, "},$1{");
  s = s.replace(/\](\s*)\[/g, "],$1[");
  // Fix missing commas between "value" "key" patterns (e.g. `"foo"\n  "bar"`)
  s = s.replace(/"(\s*\n\s*)"/g, '",$1"');
  return s;
}

/** Close unclosed brackets/braces in truncated JSON */
function closeTruncatedJSON(json: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (const ch of json) {
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // If we ended inside a string, close it
  if (inString) json += '"';
  // Remove trailing comma before closing
  json = json.replace(/,\s*$/, "");
  // Close all open brackets/braces
  return json + stack.reverse().join("");
}

/** Parse JSON with repair fallback — uses error-position insertion for remaining issues */
function parseAIJSON(content: string): any {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  // Try direct parse first
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    // noop — fall through to repairs
  }

  // Apply regex-based bulk repairs
  let json = repairJSON(jsonMatch[0]);

  // Iteratively fix remaining missing commas using the parser's error position
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return JSON.parse(json);
    } catch (e: any) {
      const msg = e.message || "";
      const posMatch = msg.match(/position (\d+)/);

      if (msg.includes("Unexpected end of JSON")) {
        // Truncated response — close open brackets/braces and retry
        json = closeTruncatedJSON(json);
        continue;
      }

      if (!posMatch || !msg.includes("Expected ','")) throw e;
      const pos = parseInt(posMatch[1]);
      json = json.slice(0, pos) + "," + json.slice(pos);
    }
  }

  return JSON.parse(json);
}

// ------------------------------------------------------------------
// AI extraction
// ------------------------------------------------------------------

/**
 * Extract curriculum structure from assertions.
 * Takes the assertions from a syllabus-tagged source and organizes them into modules.
 */
export async function extractCurriculumFromAssertions(
  assertions: Array<{ assertion: string; category: string; chapter?: string | null; section?: string | null; tags?: string[] }>,
  subjectName: string,
  qualificationRef?: string,
  intents?: CurriculumIntents,
): Promise<ExtractedCurriculum> {
  const warnings: string[] = [];

  if (assertions.length === 0) {
    return {
      ok: false,
      name: subjectName,
      description: "",
      modules: [],
      deliveryConfig: {},
      warnings: ["No assertions provided — upload and extract a document first"],
      error: "No assertions to build curriculum from",
    };
  }

  // Build assertion summary for AI
  const assertionText = assertions
    .map((a, i) => {
      const loc = [a.chapter, a.section].filter(Boolean).join(" > ");
      return `[${i + 1}] ${loc ? `(${loc}) ` : ""}[${a.category}] ${a.assertion}`;
    })
    .join("\n");

  if (assertions.length > 300) {
    warnings.push(`Large document: ${assertions.length} assertions. Curriculum may be approximate.`);
  }

  const userPrompt = `Subject: ${subjectName}${qualificationRef ? `\nQualification: ${qualificationRef}` : ""}

Here are ${assertions.length} extracted teaching assertions from the syllabus:

${assertionText}

Generate a structured curriculum from these assertions.`;

  // Build intent-aware system prompt
  const intentRules = intents ? [
    intents.sessionCount
      ? `7. Target approximately ${intents.sessionCount} sessions total — size modules so each maps to roughly one session`
      : "",
    intents.durationMins
      ? `8. Target session duration: ${intents.durationMins} minutes — set estimatedDurationMinutes per module accordingly`
      : "",
    intents.emphasis === "breadth"
      ? "9. Teaching emphasis: BREADTH-FIRST — many smaller modules covering all topics at surface level first"
      : intents.emphasis === "depth"
        ? "9. Teaching emphasis: DEPTH-FIRST — fewer, deeper modules with more learning outcomes each"
        : "",
    intents.assessments === "formal"
      ? "10. Include formal assessment criteria for every module"
      : intents.assessments === "none"
        ? "10. Skip assessment criteria — focus on learning outcomes only"
        : "",
  ].filter(Boolean).join("\n") : "";

  const basePrompt = await getPromptTemplate("curriculum-extraction");
  const systemPrompt = intentRules
    ? basePrompt.replace(
        "6. Generate practical module IDs (MOD-1, MOD-2, etc.)",
        `6. Generate practical module IDs (MOD-1, MOD-2, etc.)\n${intentRules}`,
      )
    : basePrompt;

  try {
    // @ai-call content-trust.curriculum — Generate structured curriculum from assertions | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "content-trust.curriculum",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.content || "";

    // Parse JSON from response (with repair fallback for common AI mistakes)
    const parsed = parseAIJSON(content);
    if (!parsed) {
      return {
        ok: false,
        name: subjectName,
        description: "",
        modules: [],
        deliveryConfig: {},
        warnings,
        error: "AI did not return valid JSON",
      };
    }

    const keptModules = filterMetaPedagogicalModules(parsed.modules || [], warnings);

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: keptModules.map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: sanitizeModuleTitle(m.title, `Module ${i + 1}`),
        description: m.description || "",
        learningOutcomes: m.learningOutcomes || [],
        assessmentCriteria: m.assessmentCriteria || [],
        keyTerms: m.keyTerms || [],
        estimatedDurationMinutes: m.estimatedDurationMinutes || null,
        sortOrder: m.sortOrder || i + 1,
      })),
      deliveryConfig: parsed.deliveryConfig || {},
      warnings,
    };
  } catch (error: any) {
    return {
      ok: false,
      name: subjectName,
      description: "",
      modules: [],
      deliveryConfig: {},
      warnings,
      error: `AI extraction failed: ${error.message}`,
    };
  }
}

// ------------------------------------------------------------------
// Skeleton extraction from assertions (fast, Haiku)
// ------------------------------------------------------------------

/**
 * Fast skeleton extraction from assertions using Haiku.
 * Returns module titles + descriptions only (~3-5s).
 * Used as Phase 1 of two-phase curriculum generation.
 */
export async function extractSkeletonFromAssertions(
  assertions: Array<{ assertion: string; category: string; chapter?: string | null; section?: string | null }>,
  subjectName: string,
  qualificationRef?: string,
  intents?: CurriculumIntents,
): Promise<ExtractedCurriculum> {
  if (assertions.length === 0) {
    return { ok: false, name: subjectName, description: "", modules: [], deliveryConfig: {}, warnings: [], error: "No assertions provided" };
  }

  // Compact assertion format for skeleton (less detail = faster)
  const assertionText = assertions
    .map((a, i) => {
      const loc = [a.chapter, a.section].filter(Boolean).join(" > ");
      return `[${i + 1}] ${loc ? `(${loc}) ` : ""}${a.assertion}`;
    })
    .join("\n");

  // Add intent hints if provided
  const intentHints = intents?.sessionCount
    ? `\nTarget approximately ${intents.sessionCount} modules.`
    : "";

  try {
    // @ai-call content-trust.curriculum-skeleton — Fast skeleton from assertions (titles + descriptions only) | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "content-trust.curriculum-skeleton",
      messages: [
        { role: "system", content: await getPromptTemplate("curriculum-skeleton") },
        {
          role: "user",
          content: `Subject: ${subjectName}${qualificationRef ? `\nQualification: ${qualificationRef}` : ""}${intentHints}\n\n${assertions.length} assertions:\n${assertionText}`,
        },
      ],
    });

    const parsed = parseAIJSON(response.content || "");
    if (!parsed) {
      return { ok: false, name: subjectName, description: "", modules: [], deliveryConfig: {}, warnings: [], error: "No JSON in skeleton response" };
    }

    const skeletonWarnings: string[] = [];
    const keptSkeletonModules = filterMetaPedagogicalModules(parsed.modules || [], skeletonWarnings);

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: keptSkeletonModules.map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: sanitizeModuleTitle(m.title, `Module ${i + 1}`),
        description: m.description || "",
        learningOutcomes: [],
        assessmentCriteria: [],
        keyTerms: [],
        estimatedDurationMinutes: null,
        sortOrder: m.sortOrder || i + 1,
      })),
      deliveryConfig: {},
      warnings: skeletonWarnings,
    };
  } catch (error: any) {
    return { ok: false, name: subjectName, description: "", modules: [], deliveryConfig: {}, warnings: [], error: `Skeleton extraction failed: ${error.message}` };
  }
}

// ------------------------------------------------------------------
// Goals-based curriculum generation (no document required)
// ------------------------------------------------------------------

/**
 * Generate curriculum structure from subject, persona, and learning goals.
 * Used when no document is uploaded — AI creates the curriculum from scratch.
 */
export async function generateCurriculumFromGoals(
  subjectName: string,
  persona: string,
  learningGoals: string[],
  qualificationRef?: string,
  sessionCount?: number | null,
): Promise<ExtractedCurriculum> {
  const warnings: string[] = [];

  const goalsSection = learningGoals.length > 0
    ? `\nLearning Goals:\n${learningGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}`
    : "\nNo specific learning goals provided — infer appropriate goals for this subject.";

  // Cap modules based on session count — leave room for onboarding + consolidate
  const maxModules = sessionCount ? Math.max(2, sessionCount - 2) : 8;
  const moduleCountRule = sessionCount
    ? `\nIMPORTANT: The educator has requested ${sessionCount} total sessions. Generate NO MORE than ${maxModules} modules. Merge related topics into fewer, broader modules to fit this constraint. Do NOT exceed ${maxModules} modules under any circumstances.`
    : "";

  const userPrompt = `Subject: ${subjectName}
Teaching Style: ${persona}${qualificationRef ? `\nQualification Reference: ${qualificationRef}` : ""}${goalsSection}${moduleCountRule}

Generate a structured curriculum for this subject.`;

  // Build session-aware system prompt
  const goalsBasePrompt = await getPromptTemplate("curriculum-from-goals");
  const systemPrompt = sessionCount
    ? goalsBasePrompt.replace(
        "1. Generate 4-8 modules progressing from foundational to advanced",
        `1. Generate ${Math.max(2, maxModules - 1)}-${maxModules} modules progressing from foundational to advanced (HARD LIMIT: max ${maxModules} modules)`,
      )
    : goalsBasePrompt;

  try {
    // @ai-call content-trust.curriculum-from-goals — Generate curriculum from subject + goals (no document) | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "content-trust.curriculum-from-goals",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.content || "";

    const parsed = parseAIJSON(content);
    if (!parsed) {
      return {
        ok: false,
        name: subjectName,
        description: "",
        modules: [],
        deliveryConfig: {},
        warnings,
        error: "AI did not return valid JSON",
      };
    }

    if (learningGoals.length === 0) {
      warnings.push("No goals provided — curriculum is based on AI inference for this subject");
    }

    const keptGoalModules = filterMetaPedagogicalModules(parsed.modules || [], warnings);

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: keptGoalModules.map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: sanitizeModuleTitle(m.title, `Module ${i + 1}`),
        description: m.description || "",
        learningOutcomes: m.learningOutcomes || [],
        assessmentCriteria: m.assessmentCriteria || [],
        keyTerms: m.keyTerms || [],
        estimatedDurationMinutes: m.estimatedDurationMinutes || null,
        sortOrder: m.sortOrder || i + 1,
      })),
      deliveryConfig: parsed.deliveryConfig || {},
      warnings,
    };
  } catch (error: any) {
    return {
      ok: false,
      name: subjectName,
      description: "",
      modules: [],
      deliveryConfig: {},
      warnings,
      error: `AI curriculum generation failed: ${error.message}`,
    };
  }
}
