/**
 * Pedagogy Mode Transform
 *
 * Reads the playbook's teachingMode (recall | comprehension | practice | syllabus)
 * and produces structured pedagogical instructions for the voice prompt.
 *
 * This is Layer 3 in the 4-layer model:
 *   L1: ARCHETYPE (per-domain) → [IDENTITY]
 *   L2: PERSONA TUNING (per-PB) → [STYLE]
 *   L3: TEACHING MODE (per-PB)  → [PEDAGOGY MODE]  ← THIS
 *   L4: TEACH METHOD (per-TP)   → knowledge retrieval tags
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, SubjectSourcesData } from "../types";
import type { TeachingMode } from "@/lib/content-trust/resolve-config";
import { resolveTeachingProfile } from "@/lib/content-trust/teaching-profiles";

interface PedagogyModeOutput {
  mode: TeachingMode;
  label: string;
  instructions: string;
  knowledgeGuidance: string;
  teachingFocus?: string;
}

const PEDAGOGY_MODE_CONFIG: Record<TeachingMode, Omit<PedagogyModeOutput, "mode">> = {
  recall: {
    label: "Learn and remember facts",
    instructions: [
      "Primary method: spaced retrieval practice.",
      "Quiz the learner on key facts — ask the question, then WAIT for their answer before confirming or correcting.",
      "After teaching a new fact, re-quiz it later in the session to strengthen retention.",
      "Use short, direct questions: 'What is...?', 'Can you remember...?', 'What did we say about...?'",
      "When the learner struggles, give a hint rather than the answer immediately.",
      "Track which items they got right vs wrong — revisit weak items before the session ends.",
    ].join(" "),
    knowledgeGuidance: [
      "Knowledge results tagged [recall_quiz] should be turned into quiz questions.",
      "Items tagged [definition_matching] — ask the learner to define the term before revealing the answer.",
      "Present facts one at a time, not in bulk. Test → confirm → move on.",
    ].join(" "),
  },
  comprehension: {
    label: "Read, analyse & discuss",
    instructions: [
      "Primary method: close reading and guided discussion.",
      "Read or reference a passage, then discuss what it means — draw out the learner's interpretation before offering yours.",
      "Ask 'What do you think the author means by...?' and 'Why do you think...?' questions.",
      "Build from literal understanding (what does it say?) to inference (what does it imply?) to evaluation (do you agree?).",
      "Vocabulary is important — when a key term appears, check the learner knows it before continuing.",
      "Encourage the learner to make connections to their own experience.",
    ].join(" "),
    knowledgeGuidance: [
      "Knowledge results tagged [close_reading] — present the passage, then ask comprehension questions.",
      "Items tagged [definition_matching] or [vocabulary] — check the learner's understanding of terms before discussing the text.",
      "Items tagged [guided_discussion] — use as discussion prompts, not as answers to deliver.",
    ].join(" "),
  },
  practice: {
    label: "Work through problems",
    instructions: [
      "Primary method: worked examples then guided practice.",
      "Start by demonstrating how to solve a problem step-by-step (worked example).",
      "Then give the learner a similar problem and coach them through it — offer hints, not answers.",
      "Gradually reduce scaffolding as the learner gains confidence.",
      "When they make an error, ask them to identify where it went wrong before correcting.",
      "Focus on the METHOD, not just the answer — 'How did you get that?' is more valuable than 'Is that right?'",
    ].join(" "),
    knowledgeGuidance: [
      "Knowledge results tagged [worked_example] — walk through the example step-by-step, narrating your reasoning.",
      "Items tagged [problem_solving] — present as practice problems for the learner to attempt.",
      "Guide them through the process rather than giving the solution.",
    ].join(" "),
  },
  syllabus: {
    label: "Cover the syllabus systematically",
    instructions: [
      "Primary method: structured topic coverage with comprehension checks.",
      "Move through topics in order. Teach each topic, then verify understanding before proceeding.",
      "Use a teach → check → move on pattern: explain the concept, ask a question to confirm understanding, then advance.",
      "When the learner doesn't understand, re-explain using a different example or analogy — don't just repeat.",
      "Keep track of where you are in the syllabus and reference progress: 'We've covered X, now let's look at Y.'",
      "Balance breadth (covering all topics) with depth (ensuring actual understanding).",
    ].join(" "),
    knowledgeGuidance: [
      "Use knowledge results in syllabus order when possible — work through the material systematically.",
      "All teach method tags apply — use the tagged method as a guide for HOW to teach each item.",
      "Check understanding of each topic before moving to the next.",
    ].join(" "),
  },
};

registerTransform("computePedagogyMode", (
  _rawData: any,
  context: AssembledContext,
) => {
  // Read teachingMode + teachingFocus from the first playbook's config
  const playbooks = context.loadedData.playbooks;
  const pbConfig = playbooks?.[0]?.items?.[0]?.spec?.config;
  const playbookRawConfig = (playbooks?.[0] as any)?.config;
  let teachingMode: TeachingMode | undefined =
    playbookRawConfig?.teachingMode ||
    pbConfig?.teachingMode;

  // Resolve teachingFocus: playbook config → subject profile → profile default
  let teachingFocus: string | undefined = playbookRawConfig?.teachingFocus as string | undefined;

  // Fall back to subject teaching profile if playbook doesn't set teachingMode
  const subjectSources = context.loadedData.subjectSources as SubjectSourcesData | null;
  const firstSubject = subjectSources?.subjects?.[0];
  const resolvedProfile = firstSubject ? resolveTeachingProfile(firstSubject) : null;

  if (!teachingMode) {
    if (resolvedProfile) {
      teachingMode = resolvedProfile.teachingMode;
    }
  }

  if (!teachingFocus && resolvedProfile) {
    teachingFocus = resolvedProfile.teachingFocus;
  }

  if (!teachingMode || !PEDAGOGY_MODE_CONFIG[teachingMode]) {
    return null;
  }

  const modeConfig = PEDAGOGY_MODE_CONFIG[teachingMode];
  return {
    mode: teachingMode,
    label: modeConfig.label,
    instructions: modeConfig.instructions,
    knowledgeGuidance: modeConfig.knowledgeGuidance,
    teachingFocus: teachingFocus || undefined,
  } satisfies PedagogyModeOutput;
});
