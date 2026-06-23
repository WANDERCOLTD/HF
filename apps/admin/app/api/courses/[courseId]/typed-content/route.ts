/**
 * Typed teaching-content browse — Admin gap A1 closure (U2 of #2185, story #2204).
 *
 * Aggregates typed teaching content for the Course Content tab's bi-pane
 * skeleton. Returns 5 groups of items keyed by intent kind:
 *
 *   - mcqs            — ContentQuestion rows (`questionType = MCQ`) for sources
 *                       linked to this Playbook via PlaybookSource.
 *   - cueCards        — `Playbook.config.modules[].settings.cueCardPool` rows
 *                       (Part-2 monologue framings: { topic, bullets }).
 *   - topicPrompts    — `Playbook.config.modules[].settings.topicPool` rows
 *                       (per-topic question pools: { topic, questions[] }).
 *   - scenarioProbes  — Reserved for future authoring. Empty list today —
 *                       no DB shape on hf_sandbox / hf_staging carries these.
 *   - reflectionPrompts — Reserved for future authoring. Empty list today.
 *
 * Provenance metadata is preserved per item so the RH detail pane can
 * surface module-level / source-level filter chips and cascade-aware
 * badges (e.g. "from module Mock", "from source CII R04 Syllabus").
 *
 * Skeleton scope (#2204): READ-ONLY. Editing actions live in follow-on
 * stories.
 *
 * @api OPERATOR
 */

import { NextResponse } from "next/server";

import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type {
  AuthoredModule,
  CueCardType,
  PlaybookConfig,
} from "@/lib/types/json-fields";

export const runtime = "nodejs";

export interface ModuleProvenance {
  moduleId: string;
  moduleLabel: string;
}

export interface SourceProvenance {
  sourceId: string;
  sourceName: string;
}

export interface McqItem {
  id: string;
  questionText: string;
  source: SourceProvenance;
  learningOutcomeRef: string | null;
  difficulty: number | null;
}

export interface CueCardItem {
  /** Synthetic id — `${moduleId}:cue:${index}` so the UI can key the row. */
  id: string;
  /** Stable row index inside `module.settings.cueCardPool` — drives row-editor PATCH. */
  index: number;
  topic: string;
  bullets: string[];
  /**
   * Optional cue card type (#2162) — drives Part 2 prep-phase scaffold.
   * `null` for legacy rows authored before the type field landed (S6 of #2185).
   */
  type: CueCardType | null;
  module: ModuleProvenance;
}

export interface TopicPromptItem {
  id: string;
  topic: string;
  questions: string[];
  module: ModuleProvenance;
}

export interface ScenarioProbeItem {
  id: string;
  prompt: string;
  module: ModuleProvenance | null;
}

export interface ReflectionPromptItem {
  id: string;
  prompt: string;
  module: ModuleProvenance | null;
}

export interface TypedContentResponse {
  ok: true;
  courseId: string;
  groups: {
    mcqs: McqItem[];
    cueCards: CueCardItem[];
    topicPrompts: TopicPromptItem[];
    scenarioProbes: ScenarioProbeItem[];
    reflectionPrompts: ReflectionPromptItem[];
  };
  modules: ModuleProvenance[];
  sources: SourceProvenance[];
}

interface TypedContentError {
  ok: false;
  error: string;
}

/**
 * @api GET /api/courses/:courseId/typed-content
 * @visibility internal
 * @scope courses:read
 * @auth session (OPERATOR+)
 * @description Aggregates typed teaching content (MCQs, cue cards, topic
 *   prompts, scenario probes, reflection prompts) scoped to this Playbook.
 *   Used by the Content tab's bi-pane skeleton (Admin gap A1 / #2204).
 * @response 200 { ok: true, courseId, groups, modules, sources }
 * @response 403 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse<TypedContentResponse | TypedContentError>> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) {
      return auth.error as NextResponse<TypedContentError>;
    }

    const { courseId } = await params;
    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "courseId is required" },
        { status: 400 },
      );
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, config: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const config = (playbook.config ?? {}) as PlaybookConfig;
    const authoredModules: AuthoredModule[] = Array.isArray(config.modules)
      ? (config.modules as AuthoredModule[])
      : [];

    const moduleProvenance: ModuleProvenance[] = authoredModules.map((m) => ({
      moduleId: m.id,
      moduleLabel: m.label ?? m.id,
    }));

    // Cue cards (Part-2 monologue framings) — drawn from each module's
    // settings.cueCardPool. Synthetic id is module:cue:index.
    const cueCards: CueCardItem[] = [];
    for (const mod of authoredModules) {
      const pool = mod.settings?.cueCardPool ?? [];
      pool.forEach((card, idx) => {
        cueCards.push({
          id: `${mod.id}:cue:${idx}`,
          index: idx,
          topic: card.topic,
          bullets: Array.isArray(card.bullets) ? card.bullets : [],
          type:
            card.type === "personal" || card.type === "abstract"
              ? card.type
              : null,
          module: { moduleId: mod.id, moduleLabel: mod.label ?? mod.id },
        });
      });
    }

    // Topic prompts (Part-1 / Part-3 student-led drills) — drawn from each
    // module's settings.topicPool.
    const topicPrompts: TopicPromptItem[] = [];
    for (const mod of authoredModules) {
      const pool = mod.settings?.topicPool ?? [];
      pool.forEach((row, idx) => {
        topicPrompts.push({
          id: `${mod.id}:topic:${idx}`,
          topic: row.topic,
          questions: Array.isArray(row.questions) ? row.questions : [],
          module: { moduleId: mod.id, moduleLabel: mod.label ?? mod.id },
        });
      });
    }

    // Sources linked to this Playbook via PlaybookSource — used to scope
    // ContentQuestion rows + populate the source-filter chip set.
    const playbookSources = await prisma.playbookSource.findMany({
      where: { playbookId: courseId },
      select: {
        sourceId: true,
        source: { select: { id: true, name: true } },
      },
    });
    const sourceIds = playbookSources
      .map((ps) => ps.sourceId)
      .filter((id): id is string => Boolean(id));
    const sourceProvenance: SourceProvenance[] = playbookSources
      .filter((ps) => ps.source != null)
      .map((ps) => ({
        sourceId: ps.source!.id,
        sourceName: ps.source!.name,
      }));

    // MCQs scoped to this Playbook's linked sources.
    const mcqs: McqItem[] =
      sourceIds.length > 0
        ? (
            await prisma.contentQuestion.findMany({
              where: {
                sourceId: { in: sourceIds },
                questionType: "MCQ",
              },
              select: {
                id: true,
                questionText: true,
                learningOutcomeRef: true,
                difficulty: true,
                source: { select: { id: true, name: true } },
              },
              orderBy: { sortOrder: "asc" },
              take: 500, // Skeleton cap — pagination is a follow-on story
            })
          ).map((q) => ({
            id: q.id,
            questionText: q.questionText,
            learningOutcomeRef: q.learningOutcomeRef,
            difficulty: q.difficulty,
            source: {
              sourceId: q.source.id,
              sourceName: q.source.name,
            },
          }))
        : [];

    // Scenario probes + reflection prompts — reserved kinds with no DB
    // shape today. Returning empty arrays keeps the contract stable
    // when the future typed primitives land (#2009 / #2145 follow-ons).
    const scenarioProbes: ScenarioProbeItem[] = [];
    const reflectionPrompts: ReflectionPromptItem[] = [];

    const response: TypedContentResponse = {
      ok: true,
      courseId,
      groups: {
        mcqs,
        cueCards,
        topicPrompts,
        scenarioProbes,
        reflectionPrompts,
      },
      modules: moduleProvenance,
      sources: sourceProvenance,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
