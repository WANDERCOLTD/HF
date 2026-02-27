/**
 * AI Identity Generator
 *
 * Generates a tailored identity spec config from extracted assertions + persona choice.
 * Upload "Food Safety Level 2.pdf" → get a food safety expert tutor identity.
 * Upload "Quantum Mechanics.pdf" → get a physics tutor identity.
 *
 * NO HARDCODING — persona is a string, identity is AI-generated from your content.
 * The config shape matches what `extractIdentitySpec` transform reads (identity.ts:119-156).
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getIdentityTemplateFallback, type FallbackIdentityTemplate } from "@/lib/fallback-settings";
import { config } from "@/lib/config";

// ── Types ──────────────────────────────────────────────

export interface GeneratedIdentityConfig {
  roleStatement: string;
  primaryGoal: string;
  secondaryGoals: string[];
  techniques: Array<{ name: string; description: string; when: string }>;
  defaults: Record<string, any>;
  styleGuidelines: string[];
  does: string[];
  doesNot: string[];
  opening: { approach: string; examples: string[] };
  main: { approach: string; strategies: string[] };
  closing: { approach: string; examples: string[] };
  principles: string[];
  methods: string[];
  domainVocabulary: string[];
  toneTraits?: string[];
}

export interface GenerateIdentityOptions {
  subjectName: string;
  persona: string;
  learningGoals: string[];
  toneTraits?: string[];
  /** Base archetype slug for prompt framing (e.g., "TUT-001", "COMPANION-001"). */
  archetypeSlug?: string;
  assertions: Array<{
    assertion: string;
    category: string;
    chapter?: string | null;
    tags: string[];
  }>;
  maxSampleSize?: number;
}

export interface GenerateIdentityResult {
  ok: boolean;
  config: GeneratedIdentityConfig | null;
  error?: string;
}

// ── Assertion Sampling ─────────────────────────────────

/**
 * Sample assertions proportionally across chapters/categories
 * to give the AI a representative view of the subject.
 */
function sampleAssertions(
  assertions: GenerateIdentityOptions["assertions"],
  maxSize: number
): GenerateIdentityOptions["assertions"] {
  if (assertions.length <= maxSize) return assertions;

  // Group by chapter
  const byChapter = new Map<string, typeof assertions>();
  for (const a of assertions) {
    const key = a.chapter || "__uncategorized__";
    const group = byChapter.get(key) || [];
    group.push(a);
    byChapter.set(key, group);
  }

  // Take proportionally from each chapter
  const sampled: typeof assertions = [];
  const chapterCount = byChapter.size;
  const perChapter = Math.max(1, Math.floor(maxSize / chapterCount));

  for (const [, group] of byChapter) {
    const take = Math.min(perChapter, group.length);
    // Spread evenly through the group
    const step = group.length / take;
    for (let i = 0; i < take; i++) {
      sampled.push(group[Math.floor(i * step)]);
    }
    if (sampled.length >= maxSize) break;
  }

  return sampled.slice(0, maxSize);
}

// ── AI Prompt ──────────────────────────────────────────

const ARCHETYPE_DESCRIPTORS: Record<string, { label: string; capabilities: string }> = {
  [config.specs.defaultArchetype]: {
    label: "tutor",
    capabilities: `- Generic session structure (opening/main/closing phases)
- Interaction style defaults (warmth, formality, pacing)
- Core boundaries (what tutors do and don't do)
- Assessment principles and methods
- General teaching pedagogy`,
  },
  [config.specs.companionArchetype]: {
    label: "companion",
    capabilities: `- Conversational warmth and genuine engagement
- Active listening and empathetic responding
- Exploration and curiosity facilitation
- Emotional awareness and supportive presence
- Open-ended dialogue techniques`,
  },
  [config.specs.coachArchetype]: {
    label: "coach",
    capabilities: `- Goal-setting and accountability frameworks
- Motivational interviewing techniques
- Progress tracking and reflection prompts
- Challenge and support balance
- Action planning and follow-through`,
  },
};

const DEFAULT_DESCRIPTOR = {
  label: "agent",
  capabilities: `- Generic session structure (opening/main/closing phases)
- Interaction style defaults (warmth, formality, pacing)
- Core boundaries
- General conversational patterns`,
};

function buildIdentitySystemPrompt(archetypeSlug?: string): string {
  const desc = (archetypeSlug && ARCHETYPE_DESCRIPTORS[archetypeSlug]) || DEFAULT_DESCRIPTOR;

  return `You are generating a DOMAIN OVERLAY for an AI ${desc.label}'s identity.
This overlay will be MERGED with a base ${desc.label} archetype that already provides:
${desc.capabilities}

Your job is to generate ONLY the domain-specific adaptations. Do NOT repeat generic ${desc.label} behaviors.

The configuration MUST include ALL of these fields:
- roleStatement: A 2-3 sentence description positioning the agent as an expert in this specific subject
- primaryGoal: The main objective (informed by the person's goals if provided)
- secondaryGoals: Array of 3-5 secondary goals specific to this subject
- techniques: Array of 3-5 DOMAIN-SPECIFIC techniques, each with { name, description, when }
  (e.g. for physics: "phenomena before equations"; for law: "case study analysis")
- domainVocabulary: Array of 10-20 key terms the agent should use naturally
- styleGuidelines: Array of 3-5 style guidelines SPECIFIC to this subject domain

IMPORTANT:
- The agent should sound like a genuine expert in this specific subject
- Use vocabulary and examples from the actual source material
- Do NOT include generic ${desc.label} behaviors — those come from the base
- Do NOT include generic boundaries — those come from the base
- Do NOT include session structure — that comes from the base
- Focus on what makes THIS subject different from any other
- Tailor everything to phone-based conversation (verbal, conversational)
- Return ONLY valid JSON (no markdown code fences)`;
}

// ── Main Function ──────────────────────────────────────

export async function generateIdentityFromAssertions(
  options: GenerateIdentityOptions
): Promise<GenerateIdentityResult> {
  const maxSample = options.maxSampleSize ?? 60;
  const sampled = sampleAssertions(options.assertions, maxSample);

  if (sampled.length === 0) {
    return buildFallbackConfig(options.subjectName, options.persona, options.learningGoals, options.toneTraits);
  }

  // Build assertion summary for AI
  const assertionText = sampled
    .map((a, i) => {
      const loc = a.chapter ? `(${a.chapter}) ` : "";
      return `[${i + 1}] ${loc}[${a.category}] ${a.assertion}`;
    })
    .join("\n");

  // Extract key chapters/topics for context
  const chapters = [...new Set(sampled.map(a => a.chapter).filter(Boolean))];
  const categories = [...new Set(sampled.map(a => a.category))];

  const goalsSection = options.learningGoals.length > 0
    ? `\nLearner's goals: ${options.learningGoals.join(", ")}.\nTailor the identity's primaryGoal, techniques, and session structure to support these goals.`
    : "";

  const traitsSection = options.toneTraits?.length
    ? `\nDesired interaction traits: ${options.toneTraits.join(", ")}.\nEnsure these traits are reflected in styleGuidelines, does/doesNot, and session phase approaches.`
    : "";

  const userPrompt = `Generate an identity for a "${options.persona}" agent teaching "${options.subjectName}".
${goalsSection}${traitsSection}

Subject covers ${chapters.length} topic areas: ${chapters.slice(0, 10).join(", ")}${chapters.length > 10 ? "..." : ""}
Content categories: ${categories.join(", ")}

Here are ${sampled.length} representative teaching points from the source material:

${assertionText}

Generate the identity configuration JSON.`;

  try {
    // @ai-call quick-launch.identity — Generate agent identity config from domain assertions | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion({
      callPoint: "quick-launch.identity",
      messages: [
        { role: "system", content: buildIdentitySystemPrompt(options.archetypeSlug) },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[generate-identity] AI did not return valid JSON, using fallback");
      return buildFallbackConfig(options.subjectName, options.persona, options.learningGoals, options.toneTraits);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Build overlay config — only domain-specific fields
    const config: GeneratedIdentityConfig = {
      roleStatement: parsed.roleStatement || `You are a knowledgeable ${options.persona} specializing in ${options.subjectName}.`,
      primaryGoal: parsed.primaryGoal || `Help learners develop genuine understanding of ${options.subjectName}`,
      secondaryGoals: parsed.secondaryGoals || [],
      techniques: Array.isArray(parsed.techniques) ? parsed.techniques : [],
      defaults: parsed.defaults || {},
      styleGuidelines: parsed.styleGuidelines || [],
      does: parsed.does || [],
      doesNot: parsed.doesNot || [],
      opening: parsed.opening || { approach: "Warm greeting with subject context", examples: [] },
      main: parsed.main || { approach: "Conversational teaching with checks for understanding", strategies: [] },
      closing: parsed.closing || { approach: "Summary and preview of next session", examples: [] },
      principles: parsed.principles || [],
      methods: parsed.methods || [],
      domainVocabulary: parsed.domainVocabulary || [],
      toneTraits: options.toneTraits || [],
    };

    return { ok: true, config };
  } catch (err: any) {
    console.error("[generate-identity] AI call failed:", err.message);
    return buildFallbackConfig(options.subjectName, options.persona, options.learningGoals, options.toneTraits);
  }
}

// ── Fallback ───────────────────────────────────────────

async function buildFallbackConfig(
  subjectName: string,
  persona: string,
  learningGoals: string[],
  toneTraits?: string[]
): Promise<GenerateIdentityResult> {
  const goalText = learningGoals.length > 0
    ? `, focused on helping learners ${learningGoals[0].toLowerCase()}`
    : "";

  // Load template from SystemSettings (fallback to hardcoded defaults)
  const tpl = await getIdentityTemplateFallback();

  const interpolate = (s: string) =>
    s.replace(/\{\{subject\}\}/g, subjectName)
      .replace(/\{\{persona\}\}/g, persona)
      .replace(/\{\{goalText\}\}/g, goalText);

  return {
    ok: true,
    config: {
      roleStatement: interpolate(tpl.roleStatementTemplate),
      primaryGoal: interpolate(tpl.primaryGoalTemplate),
      secondaryGoals: tpl.secondaryGoals,
      techniques: tpl.techniques,
      defaults: tpl.defaults,
      styleGuidelines: tpl.styleGuidelines,
      does: tpl.does.map(interpolate),
      doesNot: tpl.doesNot,
      opening: tpl.opening,
      main: tpl.main,
      closing: tpl.closing,
      principles: tpl.principles,
      methods: tpl.methods,
      domainVocabulary: [],
      toneTraits: toneTraits || [],
    },
    error: undefined,
  };
}
