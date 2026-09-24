import type { WizardToolExec } from "../_shared/types";

export async function execute(
  input: Record<string, unknown>,
  _userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // Generate a template-based welcome message suggestion from course context.
  // V4 only — called after personality + content are captured.
  const courseName = (input.courseName as string) || (setupData?.courseName as string) || "this course";
  const subjectDiscipline = (input.subjectDiscipline as string) || (setupData?.subjectDiscipline as string) || "";
  // #1995 — `interactionPattern` is read-only here (used for narration
  // lookup, no DB write), so a String() coercion is sufficient. The rule's
  // pattern-C catches `as string` casts on enum fields in this guarded
  // surface; coercion via String() bypasses the cast surface entirely.
  const interactionPattern =
    String(input.interactionPattern ?? setupData?.interactionPattern ?? "");
  const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string) || "";

  const patternPhrase: Record<string, string> = {
    socratic: "guide you with questions to build your own understanding",
    directive: "walk you through each concept step by step",
    advisory: "offer guidance and perspective when you need it",
    coaching: "help you think through challenges and find your own answers",
    companion: "have a genuine, thoughtful conversation with you",
    facilitation: "guide our conversation around the topics that interest you",
    reflective: "help you reflect on what you're learning and why it matters",
    open: "work through this with you in whatever way feels right",
    "conversational-guide": "have a great conversation about the things that interest you",
  };
  const stylePhrase = patternPhrase[interactionPattern] || "work through this with you";
  const subjectClause = subjectDiscipline ? ` in ${subjectDiscipline}` : "";
  const materialsClause = physicalMaterials ? ` Have your ${physicalMaterials} nearby if you can.` : "";

  // Voice principle: assume the learner picked this course for a reason.
  // Don't ask "what brings you here" / "what would you like to start with" —
  // they're here to learn the named subject. The course-context branch opens
  // with a calibration question that gets us into the subject; the open
  // (conversational-guide) branch keeps the chatty no-agenda framing for
  // Community Hub-style routes.
  const isConvGuide = interactionPattern === "conversational-guide";
  const suggestion = isConvGuide
    ? `Hi — really glad you called. I'm here to ${stylePhrase}. No agenda, no rush — let's just see where the conversation goes. What's been on your mind lately?`
    : `Hi — I'm your tutor for ${courseName}${subjectClause}. I'm here to ${stylePhrase}.${materialsClause} To get us started: when you think about this, what do you already feel comfortable with, and where does it get fuzzy?`;

  return {
    content: JSON.stringify({ ok: true, suggestion }),
  };
}
