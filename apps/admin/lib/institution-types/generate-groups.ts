/**
 * AI-powered group structure generation from a free-text description.
 *
 * Takes an institution description and generates department/division/track
 * suggestions. Optionally includes follow-up clarifying questions.
 *
 * Pattern: synchronous AI call (3-5s), same as autoGenerateGoals().
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import type { GroupType } from "@prisma/client";

export interface GeneratedGroup {
  name: string;
  groupType: GroupType;
  styleNotes?: string;
}

export interface ClarifyingQuestion {
  id: string;
  text: string;
  type: "choice" | "multiselect" | "text";
  options?: string[];
}

export interface GenerateGroupsResult {
  groups: GeneratedGroup[];
  questions: ClarifyingQuestion[];
  confidence: number; // 0.0 - 1.0
}

const SYSTEM_PROMPT = `You are an expert at understanding how educational institutions, businesses, and organizations are structured.

Given a description of an institution, extract its departments, divisions, year groups, tracks, or other organizational groupings.

For each group, determine:
- name: the group name (e.g. "Science Department", "Year 10", "Leadership Track")
- groupType: one of DEPARTMENT, YEAR_GROUP, DIVISION, TRACK, CUSTOM
- styleNotes: a brief (1 sentence) description of the teaching/communication style appropriate for this group

Rules:
- Infer sensible defaults from context (e.g. "secondary school" implies departments + year groups)
- If the description is ambiguous, generate clarifying questions (max 2)
- Questions should be answerable with short responses
- Set confidence: 0.0-1.0 based on how complete the description is
- confidence >= 0.9 means the description was very clear, no questions needed
- confidence < 0.8 means questions would help refine the structure

Return ONLY valid JSON in this format:
{
  "groups": [
    { "name": "...", "groupType": "DEPARTMENT|YEAR_GROUP|DIVISION|TRACK|CUSTOM", "styleNotes": "..." }
  ],
  "questions": [
    { "id": "q1", "text": "...", "type": "choice|multiselect|text", "options": ["..."] }
  ],
  "confidence": 0.85
}`;

/**
 * Generate group structure from a free-text description.
 *
 * @param description - User's description of their institution structure
 * @param institutionType - Optional institution type slug for context (e.g. "school")
 * @param followUpAnswers - Optional answers to previously asked clarifying questions
 */
export async function generateGroups(
  description: string,
  institutionType?: string,
  followUpAnswers?: Record<string, string>
): Promise<GenerateGroupsResult> {
  let userMessage = `Description: ${description}`;
  if (institutionType) {
    userMessage += `\nInstitution type: ${institutionType}`;
  }
  if (followUpAnswers && Object.keys(followUpAnswers).length > 0) {
    userMessage += `\n\nAdditional context from follow-up questions:`;
    for (const [qId, answer] of Object.entries(followUpAnswers)) {
      userMessage += `\n- ${qId}: ${answer}`;
    }
    userMessage += `\n\nWith this additional context, generate the final structure. Set confidence to 1.0 and do not ask further questions.`;
  }

  // @ai-call scaffold.generate-groups — Generate department/group structure from description | config: /x/ai-config
  const response = await getConfiguredMeteredAICompletion(
    {
      callPoint: "scaffold.generate-groups",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    },
    { sourceOp: "scaffold:generate-groups" }
  );

  const text = (response.content || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { groups: [], questions: [], confidence: 0 };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const groups: GeneratedGroup[] = (parsed.groups || [])
      .filter(
        (g: any) =>
          g &&
          typeof g.name === "string" &&
          g.name.trim().length > 0
      )
      .map((g: any) => ({
        name: g.name.trim(),
        groupType: validateGroupType(g.groupType),
        styleNotes: g.styleNotes || undefined,
      }));

    const questions: ClarifyingQuestion[] = (parsed.questions || [])
      .filter(
        (q: any) =>
          q &&
          typeof q.text === "string" &&
          q.text.trim().length > 0
      )
      .slice(0, 2) // Max 2 questions
      .map((q: any, i: number) => ({
        id: q.id || `q${i + 1}`,
        text: q.text.trim(),
        type: ["choice", "multiselect", "text"].includes(q.type)
          ? q.type
          : "choice",
        options: Array.isArray(q.options) ? q.options : undefined,
      }));

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    return { groups, questions, confidence };
  } catch {
    return { groups: [], questions: [], confidence: 0 };
  }
}

function validateGroupType(type: string): GroupType {
  const valid: GroupType[] = [
    "DEPARTMENT",
    "YEAR_GROUP",
    "DIVISION",
    "TRACK",
    "CUSTOM",
  ];
  return valid.includes(type as GroupType)
    ? (type as GroupType)
    : "DEPARTMENT";
}
