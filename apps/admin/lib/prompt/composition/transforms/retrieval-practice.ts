/**
 * retrieval-practice.ts — #164
 *
 * COMPOSE transform that injects retrieval practice questions into the AI
 * tutor's prompt on every continuous-mode call. The AI weaves them naturally
 * into conversation — no separate assessment stop, no ChatSurvey.
 *
 * Question count is adaptive: scaled by `informationNeed` (coverage gap) ×
 * the archetype's maxQuestions for the current scheduler mode. Minimum is
 * always 1 — retrieval practice is never off in continuous mode.
 *
 * Archetype config (maxQuestions, bloomFloor) is read from COMP-001 spec's
 * `archetypes` key — DB-backed, operator-tunable, no hardcoded switch.
 * Falls back to the scheduler policy's `retrievalDefaults` if no archetype
 * config exists in the spec yet.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "../types";
import { computeInformationNeed, deriveQuestionCount } from "@/lib/assessment/information-need";
import { selectRetrievalQuestions, type RetrievalQuestion } from "@/lib/assessment/retrieval-question-selector";
import { prisma } from "@/lib/prisma";
import { findCurriculumInfo } from "./modules";

/** Max recent question IDs to track (prevents unbounded growth) */
const MAX_RECENT_IDS = 50;
const RECENT_QUESTIONS_KEY = "retrieval:recent_question_ids";

registerTransform(
  "formatRetrievalPractice",
  async (
    _rawData: unknown,
    context: AssembledContext,
    _sectionDef: CompositionSectionDef,
  ) => {
    const { sharedState, loadedData, specConfig } = context;

    // ── Gate: only fires when the scheduler has made a decision ──
    if (!sharedState.schedulerDecision) {
      return null;
    }

    const mode = sharedState.schedulerDecision.mode;
    // "practice" mode uses the same question count as "assess"
    const modeKey = mode === "practice" ? "assess" : mode;

    // ── Resolve archetype config from COMP-001 spec ──
    // Priority: specConfig.archetypes[teachingMode] → schedulerPolicy defaults
    const pbConfig = (loadedData.playbooks?.[0]?.config ?? {}) as Record<string, unknown>;
    const teachingMode = typeof pbConfig.teachingMode === "string" ? pbConfig.teachingMode : "balanced";

    const archetypeConfig = (specConfig.archetypes as Record<string, any>)?.[teachingMode]
      ?? (specConfig.archetypes as Record<string, any>)?.["balanced"]
      ?? null;

    const retrievalConfig = archetypeConfig?.retrieval ?? null;
    const policy = sharedState.schedulerPolicy;

    // Merge: archetype config (DB) wins over policy defaults (code)
    const maxQuestions = (retrievalConfig?.maxQuestions as Record<string, number>)?.[modeKey]
      ?? policy?.retrievalQuestions?.[modeKey as keyof typeof policy.retrievalQuestions]
      ?? 2;
    const bloomFloor = (retrievalConfig?.bloomFloor as string)
      ?? policy?.retrievalBloomFloor
      ?? "REMEMBER";
    const minQuestions = (retrievalConfig?.minQuestions as number) ?? 1;

    // ── Compute information need (v1: coverage gap only) ──
    const loMasteryMap = {} as Record<string, number>;
    for (const attr of loadedData.callerAttributes) {
      // #611 GRACE WINDOW — mirrors the tolerant matcher in
      // `transforms/modules.ts:702` (see that block's long comment).
      // Drain pending via `scripts/migrate-caller-attribute-lo-mastery-keys.ts`
      // (#614); tighten this matcher in the follow-on once
      // `callerAttributeOldKeyFormCount` audit counter reads 0 everywhere.
      if (attr.key.includes(":lo_mastery:") && attr.scope === "CURRICULUM" && attr.numberValue != null) {
        const suffix = attr.key.split(":lo_mastery:")[1];
        if (suffix) loMasteryMap[suffix] = attr.numberValue;
      }
    }
    const totalLOs = sharedState.workingSet?.selectedLOs?.length
      ? (sharedState as any).workingSet?.totalLOs ?? sharedState.workingSet.selectedLOs.length
      : 0;

    const informationNeed = computeInformationNeed(loMasteryMap, totalLOs);
    const questionCount = deriveQuestionCount(informationNeed, maxQuestions, minQuestions);

    // ── Find curriculum for question lookup ──
    const curriculumInfo = findCurriculumInfo(loadedData);
    if (!curriculumInfo?.id) {
      console.warn("[retrieval-practice] No curriculum found — skipping retrieval questions");
      return null;
    }

    // ── Get outcome refs from working set ──
    const outcomeRefs = (sharedState.workingSet?.selectedLOs ?? [])
      .map((lo) => lo.ref)
      .filter(Boolean);

    // ── Read recent question IDs to avoid repetition ──
    let recentQuestionIds: string[] = [];
    try {
      const recentAttr = await prisma.callerAttribute.findUnique({
        where: {
          callerId_key_scope: {
            callerId: loadedData.caller?.id ?? "",
            key: RECENT_QUESTIONS_KEY,
            scope: "CURRICULUM",
          },
        },
      });
      if (recentAttr?.jsonValue && Array.isArray(recentAttr.jsonValue)) {
        recentQuestionIds = recentAttr.jsonValue as string[];
      }
    } catch {
      // Non-blocking — if we can't read recent IDs, we might repeat a question
    }

    // ── Select questions ──
    const questions = await selectRetrievalQuestions({
      curriculumId: curriculumInfo.id,
      outcomeRefs,
      count: questionCount,
      bloomFloor,
      recentQuestionIds,
      channel: sharedState.channel,
    });

    if (questions.length === 0) {
      return null; // No questions available — graceful no-op
    }

    // ── Persist selected question IDs (prevent repetition on next call) ──
    try {
      const newRecentIds = [...recentQuestionIds, ...questions.map((q) => q.id)]
        .slice(-MAX_RECENT_IDS); // Keep last N, trim oldest

      const callerId = loadedData.caller?.id;
      if (callerId) {
        await prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: {
              callerId,
              key: RECENT_QUESTIONS_KEY,
              scope: "CURRICULUM",
            },
          },
          create: {
            callerId,
            key: RECENT_QUESTIONS_KEY,
            scope: "CURRICULUM",
            valueType: "JSON",
            jsonValue: newRecentIds,
          },
          update: {
            jsonValue: newRecentIds,
          },
        });
      }
    } catch (err) {
      console.warn("[retrieval-practice] Failed to persist recent question IDs:", err);
    }

    // ── Format prompt section ──
    const formattedQuestions = questions.map((q, i) => formatQuestion(q, i + 1)).join("\n\n");

    console.log(
      `[retrieval-practice] ${mode} mode: injected ${questions.length} questions ` +
      `(informationNeed=${informationNeed.toFixed(2)}, max=${maxQuestions}, bloom≥${bloomFloor}, ` +
      `archetype=${teachingMode})`,
    );

    return {
      hasRetrievalPractice: true,
      questionCount: questions.length,
      mode,
      informationNeed,
      archetype: teachingMode,
      promptSection: formattedQuestions,
    };
  },
);

function formatQuestion(q: RetrievalQuestion, num: number): string {
  const parts = [`Q${num}: ${q.questionText}`];

  if (q.correctAnswer) {
    parts.push(`    Correct answer: ${q.correctAnswer}`);
  }
  if (q.answerExplanation) {
    parts.push(`    If wrong, explain: ${q.answerExplanation}`);
  }
  if (q.options && typeof q.options === "object") {
    try {
      const opts = Array.isArray(q.options)
        ? q.options
        : Object.values(q.options);
      const optTexts = opts.map((o: any) => o.text ?? o.label ?? String(o));
      parts.push(`    Options: ${optTexts.join(" | ")}`);
    } catch {
      // Options format unrecognised — skip
    }
  }

  return parts.join("\n");
}
