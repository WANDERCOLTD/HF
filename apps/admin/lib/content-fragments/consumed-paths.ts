/**
 * Registry of spec config paths that are consumed by prompt composition transforms.
 *
 * Traced from:
 *   - identity.ts: extractIdentitySpec
 *   - voice.ts: computeVoiceGuidance
 *   - pedagogy.ts: computeSessionPedagogy
 *   - quickstart.ts: computeQuickStart
 *   - preamble.ts: buildPreamble
 *   - instructions.ts: buildInstructions
 *
 * Wildcard patterns: "*" matches any single segment, "**" matches any depth.
 */

/** Paths consumed from IDENTITY spec config */
const IDENTITY_PATHS = [
  "roleStatement",
  "tutor_role.roleStatement",
  "primaryGoal",
  "secondaryGoals",
  "secondaryGoals.*",
  "techniques",
  "techniques.*.name",
  "techniques.*.description",
  "techniques.*.when",
  "defaults",
  "styleGuidelines",
  "styleGuidelines.*",
  "patterns",
  "does",
  "does.*",
  "doesNot",
  "doesNot.*",
  "opening",
  "main",
  "closing",
  "principles",
  "principles.*",
  "methods",
  "methods.*",
  "sessionStructure",
  "sessionStructure.opening",
  "sessionStructure.opening.instruction",
];

/** Paths consumed from VOICE spec config */
const VOICE_PATHS = [
  "response_length",
  "response_length.target",
  "response_length.maxSeconds",
  "response_length.rule",
  "pacing",
  "pacing.pausesAfterQuestions",
  "pacing.silenceRule",
  "pacing.paceAdaptation",
  "pacing.paceAdaptation.introvert",
  "pacing.paceAdaptation.extrovert",
  "pacing.paceAdaptation.default",
  "natural_speech",
  "natural_speech.fillers",
  "natural_speech.fillers.*",
  "natural_speech.backchannels",
  "natural_speech.backchannels.*",
  "natural_speech.transitions",
  "natural_speech.transitions.*",
  "natural_speech.confirmations",
  "natural_speech.confirmations.*",
  "interruptions",
  "interruptions.allow",
  "interruptions.recovery",
  "turn_taking",
  "turn_taking.checkUnderstanding",
  "turn_taking.avoidMonologues",
  "turn_taking.invitationPhrases",
  "turn_taking.invitationPhrases.*",
  "voice_adaptation",
  "voice_adaptation.adaptations",
  "voice_adaptation.adaptations.lowExtraversion",
  "voice_adaptation.adaptations.highNeuroticism",
  "voice_adaptation.adaptations.highOpenness",
  "voice_adaptation.adaptations.lowAgreeableness",
  "voice_rules",
  "voice_rules.rules",
  "voice_rules.rules.*",
];

/** Paths consumed from CONTENT spec config */
const CONTENT_PATHS = [
  "curriculum",
  "curriculum.name",
  "curriculum.modules",
  "name",
  "description",
  "targetAudience",
  "learningObjectives",
  "learningObjectives.*",
  "modules",
  "modules.*.id",
  "modules.*.slug",
  "modules.*.name",
  "modules.*.description",
  "modules.*.prerequisites",
  "modules.*.prerequisites.*",
  "modules.*.concepts",
  "modules.*.concepts.*",
  "modules.*.learningOutcomes",
  "modules.*.learningOutcomes.*",
  "modules.*.sortOrder",
  "modules.*.masteryThreshold",
  "concepts",
  "pacing",
  "sequencing",
  "personalization",
  "practiceRatio",
  "activityTypes",
  "activityTypes.*",
  "comprehensionIndicators",
  "comprehensionIndicators.*",
  "applicationIndicators",
  "applicationIndicators.*",
  "masteryIndicators",
  "masteryIndicators.*",
];

/** Paths consumed from ORCHESTRATE spec config (INIT-001, PIPELINE-001) */
const ORCHESTRATE_PATHS = [
  "firstCallFlow",
  "firstCallFlow.phases",
  "firstCallFlow.phases.*.phase",
  "firstCallFlow.phases.*.duration",
  "firstCallFlow.phases.*.priority",
  "firstCallFlow.phases.*.goals",
  "firstCallFlow.phases.*.goals.*",
  "firstCallFlow.phases.*.avoid",
  "firstCallFlow.phases.*.avoid.*",
  "firstCallFlow.successMetrics",
  "firstCallFlow.successMetrics.*",
  "personas",
];

/** Paths consumed from COMPOSE spec config (COMP-001) */
const COMPOSE_PATHS = [
  "sections",
  "sections.*",
  "thresholds",
  "thresholds.high",
  "thresholds.low",
  "memoriesLimit",
  "narrativeTemplates",
  "parameters",
  "parameters.*.id",
  "parameters.*.config",
];

/** Combined set of all consumed path patterns */
const ALL_CONSUMED: Set<string> = new Set([
  ...IDENTITY_PATHS,
  ...VOICE_PATHS,
  ...CONTENT_PATHS,
  ...ORCHESTRATE_PATHS,
  ...COMPOSE_PATHS,
]);

/**
 * Check if a given JSON path is consumed by a prompt composition transform.
 *
 * @param path - dot-separated path like "techniques.0.description" or "natural_speech.fillers.2"
 * @param specRole - the spec's role for role-specific matching
 * @returns true if this path (or a parent/wildcard match) is consumed
 */
export function isPathConsumed(path: string, specRole?: string): boolean {
  // Direct match
  if (ALL_CONSUMED.has(path)) return true;

  // Replace array indices with wildcard: "techniques.0.description" → "techniques.*.description"
  const wildcarded = path.replace(/\.\d+\./g, ".*.").replace(/\.\d+$/, ".*");
  if (ALL_CONSUMED.has(wildcarded)) return true;

  // Check if any consumed path is a prefix (parent object consumed = children consumed)
  for (const consumed of ALL_CONSUMED) {
    if (path.startsWith(consumed + ".")) return true;
  }

  return false;
}

/**
 * Get the category for a fragment based on its spec role and path.
 */
export function categorizeFragment(
  specRole: string | null,
  path: string,
): string {
  if (specRole === "IDENTITY") return "identity";
  if (specRole === "VOICE") return "voice";
  if (specRole === "CONTENT") return "content";

  // Path-based for mixed specs
  if (path.match(/firstCallFlow|phases|pedagogy|onboarding/)) return "pedagogy";
  if (path.match(/voice|pacing|speech|filler|interruption/)) return "voice";
  if (path.match(/module|curriculum|learningObj/)) return "content";
  if (path.match(/adaptation|adapt/)) return "adaptation";
  if (path.match(/target|behavior/)) return "targets";
  if (path.match(/persona|identity|role/)) return "identity";
  if (path.match(/constraint|guard|supervision/)) return "guardrails";

  if (specRole === "ORCHESTRATE") return "orchestration";
  if (specRole === "SYNTHESISE") return "adaptation";
  if (specRole === "CONSTRAIN") return "guardrails";
  if (specRole === "EXTRACT") return "measurement";

  return "config";
}
