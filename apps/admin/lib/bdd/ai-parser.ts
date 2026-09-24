/**
 * AI-Powered BDD Parser
 *
 * Uses LLM to extract structured parameter/story data from XML or text/markdown files.
 * Also supports direct JSON parsing for well-formed spec files.
 * More flexible than regex-based parsing - handles variations in format.
 */

import { AIEngine } from "../ai/client";
import { getConfiguredMeteredAICompletion } from "../metering";

// ============================================================================
// JSON Spec Types (matching feature-spec-schema.json)
// ============================================================================

export interface JsonFeatureSpec {
  id: string;
  title: string;
  version: string;
  status?: "Draft" | "Review" | "Approved" | "Deprecated";
  date?: string;
  domain?: string;
  specType?: "SYSTEM" | "DOMAIN" | "ADAPT" | "SUPERVISE";
  specRole?: "IDENTITY" | "CONTENT" | "VOICE" | "MEASURE" | "ADAPT" | "REWARD" | "GUARDRAIL";
  outputType?: "MEASURE" | "LEARN" | "ADAPT" | "MEASURE_AGENT" | "REWARD" | "COMPOSE" | "AGGREGATE";
  agentScope?: "SYSTEM" | "DOMAIN"; // For IDENTITY specs
  extendsAgent?: string; // For agent inheritance (e.g., "TUT-001")
  story: {
    asA: string;
    iWant: string;
    soThat: string;
  };
  context?: {
    applies?: string;
    dependsOn?: string[];
    assumptions?: string[];
  };
  acceptanceCriteria?: JsonAcceptanceCriterion[];
  constraints?: JsonConstraint[];
  failureConditions?: JsonFailureCondition[];
  parameters: JsonParameter[];
  workedExamples?: JsonWorkedExample[];
  related?: JsonRelation[];
  metadata?: {
    curriculum?: {
      type: string;
      trackingMode: string;
      moduleSelector: string;
      moduleOrder: string;
      progressKey: string;
      masteryThreshold: number;
    };
  };
}

export interface JsonAcceptanceCriterion {
  id: string;
  title: string;
  given: string;
  when: string;
  then: string;
  rationale?: string;
  measuredBy?: string[];
  thresholds?: Record<string, { value: number; operator: string; basis?: string }>;
  gherkin?: string;
}

export interface JsonConstraint {
  id: string;
  type?: string;
  description: string;
  severity?: "critical" | "warning" | "info";
}

export interface JsonFailureCondition {
  id: string;
  trigger: string;
  threshold?: { operator: string; value: number };
  implication?: string;
  severity?: "critical" | "warning";
}

export interface JsonParameter {
  id: string;
  name: string;
  description: string;
  section?: string;
  isAdjustable?: boolean;
  targetRange?: { min: number; max: number };
  config?: Record<string, any>;
  formula?: string;
  subMetrics?: JsonSubMetric[];
  interpretationScale?: JsonInterpretationRange[];
  scoringAnchors?: JsonScoringAnchor[];
  promptGuidance?: JsonPromptGuidance;
  usedBy?: string[];
  learningOutcomes?: string[];
}

export interface JsonSubMetric {
  id: string;
  name: string;
  weight: number;
  description?: string;
  formula?: string;
  definitions?: { high?: string; low?: string };
}

export interface JsonInterpretationRange {
  min: number;
  max: number;
  label: string;
  implication?: string;
}

export interface JsonScoringAnchor {
  score: number;
  example: string;
  rationale?: string;
  isGold?: boolean;
}

export interface JsonPromptGuidance {
  whenHigh?: string;
  whenLow?: string;
  whenMedium?: string;
  promptTemplate?: string;
}

export interface JsonWorkedExample {
  paramId: string;
  description: string;
  input: string;
  calculations: { subMetric: string; formula: string; result: number }[];
  finalResult: { value: number; interpretation: string };
}

export interface JsonRelation {
  id: string;
  title: string;
  relationship: string;
}

export interface ParsedBDDResult {
  success: boolean;
  fileType: "STORY" | "PARAMETER" | "HYBRID";
  data: ParsedStoryData | ParsedParameterData | null;
  errors?: string[];
  warnings?: string[];
}

// Hybrid result contains both parameter and story data
export interface ParsedHybridResult {
  success: boolean;
  fileType: "HYBRID";
  parameterData: ParsedParameterData | null;
  storyData: ParsedStoryData | null;
  specType?: "SYSTEM" | "DOMAIN" | "ADAPT" | "SUPERVISE";
  specRole?: "IDENTITY" | "CONTENT" | "VOICE" | "MEASURE" | "ADAPT" | "REWARD" | "GUARDRAIL";
  outputType?: "MEASURE" | "LEARN" | "ADAPT" | "MEASURE_AGENT" | "REWARD" | "COMPOSE" | "AGGREGATE";
  errors?: string[];
  warnings?: string[];
}

export interface ParsedStoryData {
  storyId: string;
  title: string;
  userStory: {
    asA: string;
    iWant: string;
    soThat: string;
  };
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: Constraint[];
  failureConditions: FailureCondition[];
  parameterRefs: string[];
}

export interface AcceptanceCriterion {
  id: string;
  title?: string;
  given: string;
  when: string;
  then: string;
  thresholds?: Record<string, ThresholdDef>;
  gherkin?: string;
}

export interface Constraint {
  id: string;
  type?: string;
  description: string;
  severity?: "critical" | "warning";
}

export interface FailureCondition {
  id: string;
  severity: string;
  trigger: string;
  threshold?: { operator: string; value: number };
  implication?: string;
}

export interface ParsedParameterData {
  parameters: ParsedParameter[];
}

export interface ScoringAnchor {
  score: number;
  example: string;
  rationale?: string;
  isGold?: boolean;
}

export interface PromptGuidanceItem {
  id: string;
  parameterId: string;
  term: string;
  definition?: string;
  whenHigh?: string;
  whenLow?: string;
  whenMedium?: string;
  promptTemplate?: string;
}

export interface ParsedParameter {
  id: string;
  name: string;
  description: string;
  section?: string;
  targetRange?: { min: number; max: number };
  formula?: string;
  submetrics: Submetric[];
  interpretationScale?: InterpretationRange[];
  actionThresholds?: ActionThreshold[];
  workedExample?: WorkedExample;
  scoringAnchors?: ScoringAnchor[];
  promptGuidance?: PromptGuidanceItem[];
  isAdjustable?: boolean;
}

export interface Submetric {
  id: string;
  name: string;
  weight: number;
  description: string;
  formula?: string;
  inputs?: SubmetricInput[];
  thresholds?: Record<string, ThresholdDef>;
  definitions?: Record<string, string>;
  assumptions?: string[];
}

export interface SubmetricInput {
  name: string;
  source: string;
  required: boolean;
  description?: string;
}

export interface ThresholdDef {
  value: number | string;
  operator?: string;
  basis?: string;
}

export interface InterpretationRange {
  min: number;
  max: number;
  label: string;
  implication?: string;
}

export interface ActionThreshold {
  value: number;
  operator: string;
  status: string;
  action: string;
}

export interface WorkedExample {
  description: string;
  inputs: Record<string, number | string>;
  steps: { submetric: string; formula: string; result: string }[];
  finalResult: { value: string; interpretation: string };
}

const PARAMETER_PARSE_PROMPT = `You are a BDD specification parser. Extract structured parameter measurement data from the provided content.

The content may be XML, markdown, or plain text describing parameter measurement guides.

Extract ALL parameters found with their complete details. For each parameter, extract:
- id: The parameter identifier (e.g., "CP-004", "TONE_ASSERT", "B5-O")
- name: Human-readable name (e.g., "engagement_level", "assertiveness", "openness")
- description: What this parameter measures
- section: Category/section it belongs to
- targetRange: { min, max } if specified
- formula: The calculation formula
- submetrics: Array of submetrics with their weights, formulas, inputs, thresholds, definitions
- interpretationScale: Ranges with labels and implications
- actionThresholds: What actions to take at different values
- workedExample: Example calculation if provided
- scoringAnchors: IMPORTANT - calibration examples with scores (from <scoring_anchors> or similar)
- promptGuidance: IMPORTANT - guidance for prompts (from <prompt_guidance> or <guidance> elements)

Be thorough - extract ALL submetrics, ALL definitions, ALL thresholds, ALL scoring anchors, and ALL prompt guidance. These are critical for the scoring system.

Return a JSON object with this exact structure:
{
  "parameters": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "section": "string",
      "targetRange": { "min": number, "max": number },
      "formula": "string",
      "submetrics": [
        {
          "id": "string",
          "name": "string",
          "weight": number,
          "description": "string",
          "formula": "string",
          "inputs": [{ "name": "string", "source": "string", "required": boolean, "description": "string" }],
          "thresholds": { "threshold_name": { "value": number, "basis": "string" } },
          "definitions": { "term": "definition text" },
          "assumptions": ["assumption text"]
        }
      ],
      "interpretationScale": [
        { "min": number, "max": number, "label": "string", "implication": "string" }
      ],
      "actionThresholds": [
        { "value": number, "operator": "string", "status": "string", "action": "string" }
      ],
      "workedExample": {
        "description": "string",
        "inputs": { "name": value },
        "steps": [{ "submetric": "string", "formula": "string", "result": "string" }],
        "finalResult": { "value": "string", "interpretation": "string" }
      },
      "scoringAnchors": [
        { "score": number, "example": "quote or example text", "rationale": "why this score", "isGold": boolean }
      ],
      "promptGuidance": [
        {
          "id": "string",
          "parameterId": "string",
          "term": "guidance title",
          "definition": "what this guidance does",
          "whenHigh": "text to include when score is high (>=0.7)",
          "whenLow": "text to include when score is low (<=0.3)",
          "whenMedium": "text to include when score is moderate",
          "promptTemplate": "full template text if provided"
        }
      ]
    }
  ]
}

Return ONLY valid JSON, no markdown code blocks or extra text.`;

const STORY_PARSE_PROMPT = `You are a BDD specification parser. Extract structured story data from the provided content.

The content may be XML, markdown, or plain text describing a BDD user story with acceptance criteria.

Extract:
- storyId: The story identifier
- title: Story title
- userStory: { asA, iWant, soThat }
- acceptanceCriteria: Array of AC with id, title, given/when/then, thresholds, gherkin scenarios
- constraints: Business/technical constraints
- failureConditions: What triggers failure
- parameterRefs: IDs of parameters referenced in the story

Return a JSON object with this exact structure:
{
  "storyId": "string",
  "title": "string",
  "userStory": {
    "asA": "string",
    "iWant": "string",
    "soThat": "string"
  },
  "acceptanceCriteria": [
    {
      "id": "string",
      "title": "string",
      "given": "string",
      "when": "string",
      "then": "string",
      "thresholds": { "name": { "value": number, "operator": "string" } },
      "gherkin": "string"
    }
  ],
  "constraints": [
    { "id": "string", "type": "string", "description": "string", "severity": "critical|warning" }
  ],
  "failureConditions": [
    { "id": "string", "severity": "string", "trigger": "string", "threshold": { "operator": "string", "value": number }, "implication": "string" }
  ],
  "parameterRefs": ["string"]
}

Return ONLY valid JSON, no markdown code blocks or extra text.`;

/**
 * Detect content types present in a file
 */
export function detectContentTypes(content: string): { hasParameters: boolean; hasStory: boolean } {
  const lowerContent = content.toLowerCase();

  const hasParameters =
    lowerContent.includes("<parameter_measurement_guide") ||
    lowerContent.includes("<parameter id=") ||
    lowerContent.includes("parameter measurement guide") ||
    lowerContent.includes("<submetric") ||
    lowerContent.includes("<target_range") ||
    lowerContent.includes("<formula>") ||
    lowerContent.includes("<interpretation_scale");

  const hasStory =
    lowerContent.includes("<bdd_story") ||
    lowerContent.includes("<user_story") ||
    lowerContent.includes("<acceptance_criteria") ||
    lowerContent.includes("<constraints>") ||
    lowerContent.includes("<failure_conditions") ||
    lowerContent.includes("feature:") && lowerContent.includes("scenario:") ||
    (lowerContent.includes("<as_a>") && lowerContent.includes("<i_want>") && lowerContent.includes("<so_that>"));

  return { hasParameters, hasStory };
}

/**
 * Detect whether content is a story, parameter spec, or hybrid
 */
export function detectFileType(content: string, filename: string): "STORY" | "PARAMETER" | "HYBRID" {
  const { hasParameters, hasStory } = detectContentTypes(content);

  // If both types present, it's a hybrid file
  if (hasParameters && hasStory) {
    return "HYBRID";
  }

  // Check content first (more reliable than filename)
  if (hasParameters) {
    return "PARAMETER";
  }
  if (hasStory) {
    return "STORY";
  }

  // Fall back to filename patterns
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.includes(".param.") || lowerFilename.endsWith(".param.xml")) {
    return "PARAMETER";
  }
  if (lowerFilename.includes(".bdd.") || lowerFilename.endsWith(".bdd.xml")) {
    return "STORY";
  }

  // Default to STORY if unclear
  return "STORY";
}

/**
 * Parse BDD content using AI
 */
export async function parseWithAI(
  content: string,
  fileType: "STORY" | "PARAMETER",
  engine?: AIEngine
): Promise<ParsedBDDResult> {
  const systemPrompt = fileType === "PARAMETER" ? PARAMETER_PARSE_PROMPT : STORY_PARSE_PROMPT;

  // @ai-call bdd.parse — Parse BDD story/parameter files into structured data | config: /x/ai-config
  try {
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "bdd.parse",
      engineOverride: engine,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Parse this ${fileType === "PARAMETER" ? "parameter measurement guide" : "BDD story"}:\n\n${content}` },
      ],
      maxTokens: 8000,
      temperature: 0.1, // Low temperature for structured extraction
    }, { sourceOp: "bdd:parse" });

    // Parse the JSON response
    let parsed;
    try {
      // Remove markdown code blocks if present
      let jsonContent = result.content.trim();
      if (jsonContent.startsWith("```json")) {
        jsonContent = jsonContent.slice(7);
      }
      if (jsonContent.startsWith("```")) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith("```")) {
        jsonContent = jsonContent.slice(0, -3);
      }
      parsed = JSON.parse(jsonContent.trim());
    } catch (parseError: any) {
      return {
        success: false,
        fileType,
        data: null,
        errors: [`Failed to parse AI response as JSON: ${parseError.message}`],
      };
    }

    // Validate the structure
    if (fileType === "PARAMETER") {
      if (!parsed.parameters || !Array.isArray(parsed.parameters)) {
        return {
          success: false,
          fileType,
          data: null,
          errors: ["AI response missing 'parameters' array"],
        };
      }
      return {
        success: true,
        fileType,
        data: parsed as ParsedParameterData,
        warnings: parsed.parameters.length === 0 ? ["No parameters found in content"] : undefined,
      };
    } else {
      if (!parsed.storyId) {
        return {
          success: false,
          fileType,
          data: null,
          errors: ["AI response missing 'storyId'"],
        };
      }
      return {
        success: true,
        fileType,
        data: parsed as ParsedStoryData,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      fileType,
      data: null,
      errors: [`AI parsing failed: ${error.message}`],
    };
  }
}

const HYBRID_PARSE_PROMPT = `You are a BDD specification parser. This file contains BOTH parameter measurement definitions AND BDD user story content. Extract both types of structured data.

The content may be XML, markdown, or plain text.

Extract TWO separate sections:

1. PARAMETERS: All parameter measurement data including:
   - id, name, description, section
   - targetRange: { min, max }
   - formula
   - submetrics with weights, formulas, inputs, thresholds, definitions
   - interpretationScale, actionThresholds, workedExample
   - scoringAnchors: CRITICAL - calibration examples with scores (from <scoring_anchors>)
   - promptGuidance: CRITICAL - guidance for prompts (from <prompt_guidance> or <guidance>)

2. STORY: BDD story data including:
   - storyId, title
   - userStory: { asA, iWant, soThat }
   - acceptanceCriteria with Gherkin scenarios (Feature/Scenario/Given/When/Then)
   - constraints with severity
   - failureConditions with triggers and thresholds
   - parameterRefs (IDs of parameters referenced)

For Gherkin content (Feature/Scenario blocks), preserve the FULL text in the gherkin field.

Return a JSON object with this exact structure:
{
  "parameters": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "section": "string",
      "targetRange": { "min": number, "max": number },
      "formula": "string",
      "submetrics": [
        {
          "id": "string",
          "name": "string",
          "weight": number,
          "description": "string",
          "formula": "string",
          "inputs": [{ "name": "string", "source": "string", "required": boolean, "description": "string" }],
          "thresholds": { "threshold_name": { "value": number, "basis": "string" } },
          "definitions": { "term": "definition text" },
          "assumptions": ["assumption text"]
        }
      ],
      "interpretationScale": [
        { "min": number, "max": number, "label": "string", "implication": "string" }
      ],
      "actionThresholds": [
        { "value": number, "operator": "string", "status": "string", "action": "string" }
      ],
      "scoringAnchors": [
        { "score": number, "example": "quote or example text", "rationale": "why this score", "isGold": true }
      ],
      "promptGuidance": [
        {
          "id": "string",
          "parameterId": "string",
          "term": "guidance title",
          "definition": "what this guidance does",
          "whenHigh": "text for high scores",
          "whenLow": "text for low scores",
          "whenMedium": "text for moderate scores",
          "promptTemplate": "full template if provided"
        }
      ]
    }
  ],
  "story": {
    "storyId": "string",
    "title": "string",
    "userStory": {
      "asA": "string",
      "iWant": "string",
      "soThat": "string"
    },
    "acceptanceCriteria": [
      {
        "id": "string",
        "title": "string",
        "given": "string",
        "when": "string",
        "then": "string",
        "thresholds": { "name": { "value": number, "operator": "string" } },
        "gherkin": "Feature: ...\\n  Scenario: ...\\n    Given ...\\n    When ...\\n    Then ..."
      }
    ],
    "constraints": [
      { "id": "string", "type": "string", "description": "string", "severity": "critical|warning" }
    ],
    "failureConditions": [
      { "id": "string", "severity": "string", "trigger": "string", "threshold": { "operator": "string", "value": number }, "implication": "string" }
    ],
    "parameterRefs": ["string"]
  }
}

Return ONLY valid JSON, no markdown code blocks or extra text.`;

/**
 * Parse hybrid file containing both parameter and story data
 */
export async function parseHybridWithAI(
  content: string,
  engine?: AIEngine
): Promise<ParsedHybridResult> {
  // @ai-call bdd.parse — Parse hybrid BDD files (params + story) | config: /x/ai-config
  try {
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "bdd.parse",
      engineOverride: engine,
      messages: [
        { role: "system", content: HYBRID_PARSE_PROMPT },
        { role: "user", content: `Parse this hybrid BDD file containing both parameters and story:\n\n${content}` },
      ],
      maxTokens: 12000, // Higher limit for combined data
      temperature: 0.1,
    }, { sourceOp: "bdd:parse-hybrid" });

    // Parse the JSON response
    let parsed;
    try {
      let jsonContent = result.content.trim();
      if (jsonContent.startsWith("```json")) {
        jsonContent = jsonContent.slice(7);
      }
      if (jsonContent.startsWith("```")) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith("```")) {
        jsonContent = jsonContent.slice(0, -3);
      }
      parsed = JSON.parse(jsonContent.trim());
    } catch (parseError: any) {
      return {
        success: false,
        fileType: "HYBRID",
        parameterData: null,
        storyData: null,
        errors: [`Failed to parse AI response as JSON: ${parseError.message}`],
      };
    }

    const warnings: string[] = [];

    // Extract parameter data
    let parameterData: ParsedParameterData | null = null;
    if (parsed.parameters && Array.isArray(parsed.parameters) && parsed.parameters.length > 0) {
      parameterData = { parameters: parsed.parameters };
    } else {
      warnings.push("No parameters found in hybrid file");
    }

    // Extract story data
    let storyData: ParsedStoryData | null = null;
    if (parsed.story && parsed.story.storyId) {
      storyData = parsed.story as ParsedStoryData;
    } else {
      warnings.push("No story data found in hybrid file");
    }

    if (!parameterData && !storyData) {
      return {
        success: false,
        fileType: "HYBRID",
        parameterData: null,
        storyData: null,
        errors: ["Failed to extract either parameter or story data from hybrid file"],
      };
    }

    return {
      success: true,
      fileType: "HYBRID",
      parameterData,
      storyData,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      fileType: "HYBRID",
      parameterData: null,
      storyData: null,
      errors: [`AI parsing failed: ${error.message}`],
    };
  }
}

// ============================================================================
// Direct JSON Parsing (no AI required for well-formed spec files)
// ============================================================================

/**
 * Check if content is a valid JSON spec file
 */
export function isJsonSpec(content: string, filename: string): boolean {
  // Check filename extension
  if (filename.toLowerCase().endsWith('.spec.json') || filename.toLowerCase().endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      // Check for required spec fields
      return !!(parsed.id && parsed.title && parsed.story && parsed.parameters);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Parse a JSON spec file directly without AI
 */
export function parseJsonSpec(content: string): { success: true; data: JsonFeatureSpec } | { success: false; errors: string[] } {
  try {
    const spec = JSON.parse(content) as JsonFeatureSpec;

    // Validate required fields (matching feature-spec-schema.json)
    const errors: string[] = [];
    if (!spec.id) errors.push("Missing required field: id");
    if (!spec.title) errors.push("Missing required field: title");
    if (!spec.version) errors.push("Missing required field: version");
    if (!spec.story) errors.push("Missing required field: story");
    if (!spec.parameters || !Array.isArray(spec.parameters)) errors.push("Missing required field: parameters (must be array)");
    // Note: acceptanceCriteria is optional (documentation only, not processed by ingestion)

    if (spec.story) {
      if (!spec.story.asA) errors.push("Missing story.asA");
      if (!spec.story.iWant) errors.push("Missing story.iWant");
      if (!spec.story.soThat) errors.push("Missing story.soThat");
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true, data: spec };
  } catch (e: any) {
    return { success: false, errors: [`Invalid JSON: ${e.message}`] };
  }
}

/**
 * Convert a JSON spec to the hybrid parsed result format
 * This allows JSON specs to flow through the same pipeline as AI-parsed content
 */
export function convertJsonSpecToHybrid(spec: JsonFeatureSpec): ParsedHybridResult {
  // Convert parameters to ParsedParameter format
  const parameters: ParsedParameter[] = spec.parameters.map((p) => {
    // Convert subMetrics to submetrics (note: different casing)
    const submetrics: Submetric[] = (p.subMetrics || []).map((sm) => ({
      id: sm.id,
      name: sm.name,
      weight: sm.weight,
      description: sm.description || "",
      formula: sm.formula,
      definitions: sm.definitions,
    }));

    // Convert promptGuidance object to array of PromptGuidanceItem
    const promptGuidance: PromptGuidanceItem[] = [];
    if (p.promptGuidance) {
      promptGuidance.push({
        id: `${p.id}-guidance`,
        parameterId: p.id,
        term: p.name,
        definition: p.description,
        whenHigh: p.promptGuidance.whenHigh,
        whenLow: p.promptGuidance.whenLow,
        whenMedium: p.promptGuidance.whenMedium,
        promptTemplate: p.promptGuidance.promptTemplate,
      });
    }

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      section: p.section,
      targetRange: p.targetRange,
      formula: p.formula,
      submetrics,
      interpretationScale: p.interpretationScale,
      scoringAnchors: p.scoringAnchors,
      promptGuidance,
      isAdjustable: p.isAdjustable,
      // Preserve config for IDENTITY and CONTENT specs
      config: p.config,
    };
  });

  // Convert acceptance criteria (optional - documentation only)
  const acceptanceCriteria: AcceptanceCriterion[] = (spec.acceptanceCriteria || []).map((ac) => ({
    id: ac.id,
    title: ac.title,
    given: ac.given,
    when: ac.when,
    then: ac.then,
    thresholds: ac.thresholds,
    gherkin: ac.gherkin,
  }));

  // Convert constraints
  const constraints: Constraint[] = (spec.constraints || []).map((c) => ({
    id: c.id,
    type: c.type,
    description: c.description,
    severity: c.severity === "info" ? "warning" : c.severity,
  }));

  // Convert failure conditions
  const failureConditions: FailureCondition[] = (spec.failureConditions || []).map((fc) => ({
    id: fc.id,
    severity: fc.severity || "warning",
    trigger: fc.trigger,
    threshold: fc.threshold,
    implication: fc.implication,
  }));

  // Build story data
  const storyData: ParsedStoryData = {
    storyId: spec.id,
    title: spec.title,
    userStory: {
      asA: spec.story.asA,
      iWant: spec.story.iWant,
      soThat: spec.story.soThat,
    },
    acceptanceCriteria,
    constraints,
    failureConditions,
    parameterRefs: spec.parameters.map((p) => p.id),
  };

  // Build parameter data
  const parameterData: ParsedParameterData = { parameters };

  return {
    success: true,
    fileType: "HYBRID",
    parameterData,
    storyData,
    specType: spec.specType,
    specRole: spec.specRole,
    outputType: spec.outputType,
  };
}

/**
 * Parse a BDD spec file - tries JSON first, falls back to AI
 */
export async function parseBDDSpec(
  content: string,
  filename: string,
  engine?: AIEngine
): Promise<ParsedBDDResult | ParsedHybridResult> {
  // Try JSON parsing first
  if (isJsonSpec(content, filename)) {
    const jsonResult = parseJsonSpec(content);
    if (jsonResult.success) {
      const hybridResult = convertJsonSpecToHybrid(jsonResult.data);
      return hybridResult;
    } else {
      // JSON parsing failed - report errors
      return {
        success: false,
        fileType: "HYBRID",
        parameterData: null,
        storyData: null,
        errors: jsonResult.errors,
      };
    }
  }

  // Fall back to AI parsing for XML, markdown, etc.
  const fileType = detectFileType(content, filename);

  if (fileType === "HYBRID") {
    return parseHybridWithAI(content, engine);
  }

  return parseWithAI(content, fileType, engine);
}
