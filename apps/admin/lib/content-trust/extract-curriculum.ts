/**
 * Curriculum Structure Extraction
 *
 * Takes assertions extracted from a syllabus document and uses AI to generate
 * a structured curriculum: modules, learning outcomes, assessment criteria,
 * teaching order.
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import type { ExtractedAssertion } from "./extract-assertions";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface CurriculumModule {
  id: string; // "MOD-1", "MOD-2", etc.
  title: string;
  description: string;
  learningOutcomes: string[];
  assessmentCriteria?: string[];
  keyTerms?: string[];
  estimatedDurationMinutes?: number;
  sortOrder: number;
}

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

const CURRICULUM_SYSTEM_PROMPT = `You are a curriculum design specialist. Given a set of teaching assertions extracted from a syllabus or educational document, your job is to organize them into a structured curriculum with modules, learning outcomes, and assessment criteria.

Rules:
1. Group related assertions into logical modules
2. Each module should have 3-8 learning outcomes
3. Order modules from foundational to advanced
4. Use clear, measurable learning outcome language ("Identify...", "Explain...", "Apply...")
5. Preserve the source material's own structure if it has chapters/sections
6. Generate practical module IDs (MOD-1, MOD-2, etc.)

Return valid JSON only with this structure:
{
  "name": "Curriculum title",
  "description": "Brief description of what this curriculum covers",
  "modules": [
    {
      "id": "MOD-1",
      "title": "Module title",
      "description": "What this module covers",
      "learningOutcomes": ["LO1: Identify...", "LO2: Explain..."],
      "assessmentCriteria": ["Can define X", "Can list Y"],
      "keyTerms": ["term1", "term2"],
      "estimatedDurationMinutes": 30,
      "sortOrder": 1
    }
  ],
  "deliveryConfig": {
    "sessionStructure": ["Opening review", "New content", "Practice activity", "Summary check"],
    "assessmentStrategy": "Spaced repetition with formative checks per module",
    "pedagogicalNotes": ["Start with real-world examples", "Use misconception correction"]
  }
}`;

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

  const systemPrompt = intentRules
    ? CURRICULUM_SYSTEM_PROMPT.replace(
        "6. Generate practical module IDs (MOD-1, MOD-2, etc.)",
        `6. Generate practical module IDs (MOD-1, MOD-2, etc.)\n${intentRules}`,
      )
    : CURRICULUM_SYSTEM_PROMPT;

  try {
    // @ai-call content-trust.curriculum — Generate structured curriculum from assertions | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "content-trust.curriculum",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      timeoutMs: 90000, // Assertion-based curriculum can process 300+ assertions into modules
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

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: (parsed.modules || []).map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: m.title || `Module ${i + 1}`,
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

const SKELETON_FROM_ASSERTIONS_PROMPT = `You are a curriculum designer. Given teaching assertions from a syllabus, group them into logical modules.
Output ONLY module titles and one-sentence descriptions. Do NOT generate learning outcomes, assessment criteria, or key terms.

Return valid JSON only:
{
  "name": "Curriculum title",
  "description": "One-sentence summary",
  "modules": [
    { "id": "MOD-1", "title": "Module title", "description": "One sentence", "sortOrder": 1 }
  ]
}

Rules:
- Group related assertions into 4-8 modules
- Order from foundational to advanced
- Preserve the source material's chapter/section structure if present
- Use module IDs: MOD-1, MOD-2, etc.
- Return ONLY valid JSON, no explanation`;

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
        { role: "system", content: SKELETON_FROM_ASSERTIONS_PROMPT },
        {
          role: "user",
          content: `Subject: ${subjectName}${qualificationRef ? `\nQualification: ${qualificationRef}` : ""}${intentHints}\n\n${assertions.length} assertions:\n${assertionText}`,
        },
      ],
      timeoutMs: 15000,
    });

    const parsed = parseAIJSON(response.content || "");
    if (!parsed) {
      return { ok: false, name: subjectName, description: "", modules: [], deliveryConfig: {}, warnings: [], error: "No JSON in skeleton response" };
    }

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: (parsed.modules || []).map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: m.title || `Module ${i + 1}`,
        description: m.description || "",
        learningOutcomes: [],
        assessmentCriteria: [],
        keyTerms: [],
        estimatedDurationMinutes: null,
        sortOrder: m.sortOrder || i + 1,
      })),
      deliveryConfig: {},
      warnings: [],
    };
  } catch (error: any) {
    return { ok: false, name: subjectName, description: "", modules: [], deliveryConfig: {}, warnings: [], error: `Skeleton extraction failed: ${error.message}` };
  }
}

// ------------------------------------------------------------------
// Goals-based curriculum generation (no document required)
// ------------------------------------------------------------------

const GOALS_CURRICULUM_SYSTEM_PROMPT = `You are a curriculum design specialist. Given a subject, teaching style, and optional learning goals, generate a structured curriculum with modules, learning outcomes, and assessment criteria.

Rules:
1. Generate 4-8 modules progressing from foundational to advanced
2. Each module should have 3-8 clear, measurable learning outcomes ("Identify...", "Explain...", "Apply...")
3. Include practical assessment criteria for each module
4. Adapt the pedagogical approach to the teaching style (e.g. tutor = structured, coach = goal-oriented, mentor = reflective)
5. If learning goals are provided, ensure the curriculum covers them
6. If no learning goals are provided, infer sensible goals for the subject
7. Generate practical module IDs (MOD-1, MOD-2, etc.)

Return valid JSON only with this structure:
{
  "name": "Curriculum title",
  "description": "Brief description of what this curriculum covers",
  "modules": [
    {
      "id": "MOD-1",
      "title": "Module title",
      "description": "What this module covers",
      "learningOutcomes": ["LO1: Identify...", "LO2: Explain..."],
      "assessmentCriteria": ["Can define X", "Can list Y"],
      "keyTerms": ["term1", "term2"],
      "estimatedDurationMinutes": 30,
      "sortOrder": 1
    }
  ],
  "deliveryConfig": {
    "sessionStructure": ["Opening review", "New content", "Practice activity", "Summary check"],
    "assessmentStrategy": "Spaced repetition with formative checks per module",
    "pedagogicalNotes": ["Start with real-world examples", "Use misconception correction"]
  }
}`;

/**
 * Generate curriculum structure from subject, persona, and learning goals.
 * Used when no document is uploaded — AI creates the curriculum from scratch.
 */
export async function generateCurriculumFromGoals(
  subjectName: string,
  persona: string,
  learningGoals: string[],
  qualificationRef?: string,
): Promise<ExtractedCurriculum> {
  const warnings: string[] = [];

  const goalsSection = learningGoals.length > 0
    ? `\nLearning Goals:\n${learningGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}`
    : "\nNo specific learning goals provided — infer appropriate goals for this subject.";

  const userPrompt = `Subject: ${subjectName}
Teaching Style: ${persona}${qualificationRef ? `\nQualification Reference: ${qualificationRef}` : ""}${goalsSection}

Generate a structured curriculum for this subject.`;

  try {
    // @ai-call content-trust.curriculum-from-goals — Generate curriculum from subject + goals (no document) | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "content-trust.curriculum-from-goals",
      messages: [
        { role: "system", content: GOALS_CURRICULUM_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      timeoutMs: 60000, // Curriculum generation produces large structured JSON (4-8 modules)
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

    return {
      ok: true,
      name: parsed.name || subjectName,
      description: parsed.description || "",
      modules: (parsed.modules || []).map((m: any, i: number) => ({
        id: m.id || `MOD-${i + 1}`,
        title: m.title || `Module ${i + 1}`,
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
