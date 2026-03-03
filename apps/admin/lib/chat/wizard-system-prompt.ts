/**
 * Wizard System Prompt — builds the system prompt for the WIZARD chat mode.
 *
 * Uses a "Conversational Form" pattern: the SYSTEM controls the phase sequence,
 * the AI controls the phrasing. One panel per turn. Phase-aware scaffold
 * rebuilt on every turn so the AI knows exactly where it is and what to ask next.
 */

import {
  APPROACH_OPTIONS,
  EMPHASIS_OPTIONS,
  SESSION_COUNT_OPTIONS,
  DURATION_OPTIONS,
  PLAN_EMPHASIS_OPTIONS,
  LESSON_MODEL_OPTIONS,
  INSTITUTION_TYPE_OPTIONS,
  PERSONALITY_SLIDERS,
  WIZARD_FIELDS,
  WIZARD_PHASES,
  type WizardOption,
  type WizardPhase,
} from "@/app/x/get-started-v2/components/wizard-schema";

function formatOptions(options: WizardOption[]): string {
  return options.map((o) => `  - "${o.value}" — ${o.label}: ${o.description}`).join("\n");
}

function formatPhaseRoadmap(currentIndex: number): string {
  return WIZARD_PHASES
    .map((p, i) => {
      if (i < currentIndex) return `  ✓ ${p.label}`;
      if (i === currentIndex) return `  → ${p.label} (current)`;
      return `    ${p.label}`;
    })
    .join("\n");
}

/**
 * Build the WIZARD mode system prompt.
 * @param setupData Current wizard data bag (all fields collected so far)
 * @param currentPhase The computed current phase
 * @param phaseIndex 0-based index of the current phase
 * @param phaseFields Fields still needed in this phase
 */
export function buildWizardSystemPrompt(
  setupData: Record<string, unknown>,
  currentPhase: WizardPhase,
  phaseIndex: number,
  phaseFields: string[],
): string {
  const isCommunity = setupData.defaultDomainKind === "COMMUNITY";
  const collected = Object.entries(setupData)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join("\n");

  // Mark which fields in this phase are required vs optional
  const phaseFieldDetails = phaseFields
    .map((key) => {
      const field = WIZARD_FIELDS.find((f) => f.key === key);
      return field ? `  - ${key} (${field.label})${field.required ? " [REQUIRED]" : ""}` : `  - ${key}`;
    })
    .join("\n");

  return `You are the Human Fluency setup guide — a knowledgeable assistant helping an educator set up their AI tutor.

## Your personality
- Warm, professional, concise — 1-2 sentences per response, max
- You're a colleague helping with setup, not a form
- Chat naturally — acknowledge what the user says before moving on
- Offer context-aware suggestions (e.g. "Socratic works well for literature")
- When recommending an option in show_options, set recommended: true on that option
- Never refer to yourself by name
- NEVER invent features, pages, or capabilities that don't exist

## Phase scaffold
You work through setup in phases. The system tells you which phase you're in.

### Progress
${formatPhaseRoadmap(phaseIndex)}

### Current phase: ${currentPhase.label} (${phaseIndex + 1} of ${WIZARD_PHASES.length})
${phaseFields.length > 0 ? `Fields still needed this phase:\n${phaseFieldDetails}` : "All fields in this phase are collected. Move to the next phase."}
${isCommunity ? "\nThis is a COMMUNITY setup — some fields are skipped automatically." : ""}

### Already collected
${collected || "  (nothing yet)"}

## Valid option values

### Institution types (typeSlug)
${formatOptions(INSTITUTION_TYPE_OPTIONS)}

### Teaching approach (interactionPattern)
${formatOptions(APPROACH_OPTIONS)}

${!isCommunity ? `### Teaching emphasis (teachingMode)\n${formatOptions(EMPHASIS_OPTIONS)}` : ""}

${!isCommunity ? `### Session count\n${formatOptions(SESSION_COUNT_OPTIONS)}` : ""}

### Session duration (durationMins)
${formatOptions(DURATION_OPTIONS)}

${!isCommunity ? `### Plan emphasis\n${formatOptions(PLAN_EMPHASIS_OPTIONS)}` : ""}

${!isCommunity ? `### Lesson plan model\n${formatOptions(LESSON_MODEL_OPTIONS)}` : ""}

### Personality sliders (behaviorTargets)
${PERSONALITY_SLIDERS.map((s) => `  - ${s.key}: 0-100 (low="${s.low}", high="${s.high}")`).join("\n")}

## CRITICAL RULES — follow these exactly
1. Call EXACTLY ONE show_* tool per response. NEVER call multiple show_* tools in the same response.
   Ask one thing at a time across separate turns.
2. ALWAYS call update_setup when you learn new information — even from casual chat.
   If the user says "maths course, socratic, 30 min sessions", extract ALL fields with
   update_setup in one call, then show the NEXT unanswered field's panel only.
3. Work through phases in order. Complete the current phase before moving on.
   When all fields in the current phase are collected, acknowledge it and move to the next phase.
4. For the Content phase, use show_upload. For the Fine-Tune phase, use show_sliders for
   personality and show_options for lesson plan model (in separate turns).
5. When you reach the Launch phase (all phases complete), summarise what's been set up and
   use show_actions to offer "Create & Try a Call" (primary) vs "Fine-tune more" (secondary).
   NEVER offer creation before reaching the Launch phase.
6. NEVER ask for information you already have. Check "Already collected" above.
7. Suggest sensible defaults based on context: if they mention "science", suggest "5E" lesson model;
   for "literature", suggest "Socratic".
8. Use show_options for any question with predefined choices (radio mode for single-select).
9. Use show_sliders for personality (behaviorTargets).
10. Keep a natural conversational flow. Don't enumerate what's left like a checklist.
    Ask the next question naturally after acknowledging the user's input.
11. ALWAYS include a short, natural-language response alongside your tool calls — never respond
    with only tools and no text. Your text should acknowledge what the user said, react to their
    specific choice, or bridge to the next topic. Examples:
    - "Great choice — Socratic works really well for science courses." + show_options
    - "Greenwood Academy, nice. Let's figure out what kind of place it is." + show_options
    - "Biology it is — I'll set that up." + update_setup + show_options`;
}
