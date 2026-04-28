/**
 * validate-lo-linkage.ts
 *
 * Guards and measurement for the Learning Objective → Teaching Point → Question
 * mapping pipeline. Used by:
 *
 *   1. syncModulesToDB — reject garbage `description === ref` payloads before write
 *   2. lesson plan regeneration — surface data-quality warnings (epic #131 B1)
 *   3. the repair script — report before/after scorecards
 *
 * The invariants this module defends:
 *
 *   - `LearningObjective.description` must not equal `LearningObjective.ref`
 *     (descriptions like "LO1" are garbage — the prompt must produce real outcome text)
 *   - `ContentAssertion.learningOutcomeRef` must be a structured ref or null —
 *     free-text topic names like "Character analysis" are rejected upstream
 *   - `ContentAssertion.learningObjectiveId` is the authoritative FK; the string
 *     ref is the write-time signal from extraction
 *
 * This is the structural fix per `.claude/rules/ai-to-db-guard.md` — a validation
 * step between AI output and DB write, so the 5 defects found on PW: Secret Garden
 * cannot silently recur on new courses.
 */

/**
 * Matches structured LO refs: LO1, LO-1, LO12, AC2.3, R04-LO2-AC2.3, etc.
 * Case-insensitive. Hyphen between LO and the number is optional — both "LO1"
 * and "LO-1" are accepted because the legacy `parseLORef` synthesiser wrote
 * the hyphenated form into the DB. Rejects free-text values like
 * "Character analysis".
 */
export const STRUCTURED_LO_REF_PATTERN = /^(LO-?\d+|AC[\d.]+|R\d+-LO-?\d+(?:-AC[\d.]+)?)$/i;

/**
 * Normalise a raw LO ref string to its canonical form, or return null if it
 * is not a valid structured ref. Used as a guard between AI output and DB write.
 *
 *   sanitiseLORef("  LO1  ")        → "LO1"
 *   sanitiseLORef("lo2")            → "LO2"
 *   sanitiseLORef("LO-1")           → "LO-1"   (hyphen form preserved)
 *   sanitiseLORef("R04-LO2-AC2.3")  → "R04-LO2-AC2.3"
 *   sanitiseLORef("Character analysis") → null  (free text — reject)
 *   sanitiseLORef(null)             → null
 *   sanitiseLORef("")               → null
 *
 * The hyphen form `LO-1` is preserved rather than normalised to `LO1` because
 * the legacy DB has both forms and `loRefsMatch` (word-boundary matcher) will
 * bind them bidirectionally.
 */
export function sanitiseLORef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!STRUCTURED_LO_REF_PATTERN.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

/**
 * True if a proposed (ref, description) pair is a valid LearningObjective.
 * Rejects pairs where description is empty, equals the ref, or is shorter than 4 chars
 * (nothing meaningful fits in 3 chars for a learning outcome).
 */
export function isValidLoPair(
  ref: string | null | undefined,
  description: string | null | undefined,
): boolean {
  if (!ref || !description) return false;
  const trimmedDesc = description.trim();
  if (trimmedDesc.length < 4) return false;
  if (trimmedDesc.toUpperCase() === ref.trim().toUpperCase()) return false;
  return true;
}

/**
 * Parse a raw learning-outcome string from AI output into `{ ref, description }`.
 * Returns null (not a synthetic fallback) when the input is unusable — the caller
 * must decide whether to skip, request regeneration, or log a warning.
 *
 * This is the strict replacement for the old `parseLORef` synthesizer that
 * silently fabricated `LO-${index+1}` refs and wrote the raw input as description,
 * producing the "description === ref" garbage seen on PW: Secret Garden.
 *
 *   parseLoLine("LO1: Identify themes")     → { ref: "LO1", description: "Identify themes" }
 *   parseLoLine("R04-LO2-AC2.3 - Apply X")  → { ref: "R04-LO2-AC2.3", description: "Apply X" }
 *   parseLoLine("LO1")                      → null  (no description)
 *   parseLoLine("Character analysis")       → null  (no ref)
 *   parseLoLine("")                         → null
 */
const LO_LINE_PATTERN = /^(LO\d+|AC[\d.]+|R\d+-LO\d+(?:-AC[\d.]+)?)\s*[:\-–]\s*(.+)$/i;

export function parseLoLine(text: string | null | undefined): { ref: string; description: string } | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(LO_LINE_PATTERN);
  if (!match) return null;
  const ref = match[1].toUpperCase();
  const description = match[2].trim();
  if (!isValidLoPair(ref, description)) return null;
  return { ref, description };
}

/**
 * Coverage scorecard for an LO linkage set. Used by the validation gate (B1)
 * and the repair script (B2) to produce before/after numbers.
 */
export interface LoLinkageScorecard {
  total: number;
  withValidRef: number;
  withFk: number;
  orphans: number;
  distinctRefs: number;
  garbageDescriptions: number;
  coveragePct: number;
  fkCoveragePct: number;
}

export function scoreCoverage(input: {
  total: number;
  withValidRef: number;
  withFk: number;
  distinctRefs: number;
  garbageDescriptions: number;
}): LoLinkageScorecard {
  const orphans = input.total - input.withValidRef;
  const coveragePct = input.total > 0 ? Math.round((input.withValidRef / input.total) * 100) : 0;
  const fkCoveragePct = input.total > 0 ? Math.round((input.withFk / input.total) * 100) : 0;
  return { ...input, orphans, coveragePct, fkCoveragePct };
}

/**
 * Full scorecard for a course — loads from DB, computes coverage, garbage counts,
 * question linkage, and module/LO summary. Splits student-facing content from
 * tutor instructions so the UI can surface two honest numbers instead of a
 * muddled total.
 *
 * Used by:
 *   - `GET /api/courses/[courseId]/curriculum-scorecard` (the Curriculum tab banner)
 *   - `scripts/repair-lo-linkage.ts` (before/after delta)
 *   - Future `B1` warning gate on lesson plan regeneration
 *
 * Single source of truth for curriculum health on a course.
 */
export type CurriculumHealth = "ready" | "nearly_there" | "needs_attention" | "not_started";

export interface CourseLinkageScorecard {
  course: { id: string; name: string };
  /** Primary curriculum for this course, or null if the course has no curriculum yet */
  curriculumId: string | null;

  /** Overall health signal, for the pill at the top of the banner */
  health: CurriculumHealth;

  /** Student-facing content — what the student will actually learn */
  studentContent: {
    total: number;
    linkedToOutcome: number;
    linkedPct: number;
  };

  /**
   * Assessment-item source content — question banks, past papers, worked
   * examples. Extracted as assertions so the AI can ground MCQ generation,
   * but these are testing content, not teaching content. Shown in its own
   * scorecard box so it doesn't drag the "student teaching points" metric
   * (where low linkage is expected — questions don't teach LOs directly).
   */
  assessmentItems: {
    total: number;
    linkedToOutcome: number;
    linkedPct: number;
  };

  /** Tutor instructions — what shapes how the AI tutor behaves */
  tutorInstructions: {
    total: number;
    linkedToOutcome: number;
    linkedPct: number;
  };

  /** Questions & MCQs linked to teaching points */
  questions: {
    total: number;
    linkedToTp: number;
    linkedPct: number;
  };

  /** Curriculum structure — modules + learning outcomes */
  structure: {
    activeModules: number;
    totalModules: number;
    learningOutcomes: number;
    outcomesWithContent: number;
    outcomesWithoutContent: number; // "5 outcomes have no teaching content yet"
    garbageDescriptions: number;    // "1 outcome has a placeholder description"
  };

  /** Plain-English warnings. Educator-facing copy, not engineering. */
  warnings: string[];

  /**
   * Legacy scorecard numbers, kept for the repair script + tests. UI should
   * prefer the educator-facing fields above.
   * @deprecated
   */
  scorecard: LoLinkageScorecard;
  /** @deprecated — use `structure.learningOutcomes` instead */
  loRows: { total: number; garbageDescriptions: number; orphanLos: number };
  /** @deprecated — use `structure.activeModules` / `structure.totalModules` instead */
  modules: { total: number; active: number };
}

export async function computeCourseLinkageScorecard(courseId: string): Promise<CourseLinkageScorecard | null> {
  // Dynamic import so this module stays safe to import from test files that
  // mock @/lib/prisma differently.
  const { prisma } = await import("@/lib/prisma");
  const { INSTRUCTION_CATEGORIES } = await import("@/lib/content-trust/resolve-config");
  const instructionSet = new Set<string>(INSTRUCTION_CATEGORIES);

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });
  if (!playbook) return null;

  // Source IDs via PlaybookSource; subject IDs from PlaybookSubject (for curriculum lookup)
  const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
  const sourceIds = await getSourceIdsForPlaybook(courseId);
  const ps = await prisma.playbookSubject.findMany({
    where: { playbookId: courseId },
    select: { subjectId: true },
  });
  const subjectIds = [...new Set(ps.map((p) => p.subjectId))];

  const warnings: string[] = [];

  // Early exit — no subjects/sources means "not started"
  if (subjectIds.length === 0) {
    return makeEmptyScorecard(playbook, null, "not_started", [
      "No curriculum yet. Upload content on the Content tab to build one.",
    ]);
  }
  if (sourceIds.length === 0) {
    warnings.push("No content uploaded yet. Add documents on the Content tab so there's something to teach.");
  }

  // ── Source metadata — used to route assertions to the right bucket ──
  // A COURSE_REFERENCE / LESSON_PLAN / POLICY_DOCUMENT is tutor methodology
  // by definition. Its assertions shouldn't count as "student teaching points"
  // regardless of their extracted category (which often ends up as generic
  // "fact" / "rule" / "process" and would otherwise land in the student box).
  const sources = sourceIds.length > 0
    ? await prisma.contentSource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, documentType: true },
      })
    : [];
  const TUTOR_ONLY_DOC_TYPES = new Set(["COURSE_REFERENCE", "LESSON_PLAN", "POLICY_DOCUMENT"]);
  const ASSESSMENT_DOC_TYPES = new Set(["QUESTION_BANK", "ASSESSMENT"]);
  const tutorSourceIds = new Set(
    sources
      .filter((s) => s.documentType && TUTOR_ONLY_DOC_TYPES.has(s.documentType))
      .map((s) => s.id),
  );
  const assessmentSourceIds = new Set(
    sources
      .filter((s) => s.documentType && ASSESSMENT_DOC_TYPES.has(s.documentType))
      .map((s) => s.id),
  );

  // ── Assertions (split by layer) ─────────────────────────
  const assertions = sourceIds.length > 0
    ? await prisma.contentAssertion.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { sourceId: true, category: true, learningOutcomeRef: true, learningObjectiveId: true },
      })
    : [];

  let studentTotal = 0;
  let studentLinked = 0;
  let assessmentTotal = 0;
  let assessmentLinked = 0;
  let tutorTotal = 0;
  let tutorLinked = 0;

  // Legacy totals (for the deprecated scorecard block)
  let legacyWithRef = 0;
  let legacyWithFk = 0;
  // FK-based linkage counts: which LO IDs have at least one assertion?
  const fkLoIdCounts = new Map<string, number>();
  const refCounts = new Map<string, number>();

  for (const a of assertions) {
    // Route by source documentType first (strongest signal: a COURSE_REFERENCE
    // doc IS tutor methodology, regardless of per-assertion category; a
    // QUESTION_BANK doc IS testing content regardless of its assertions' cats).
    // Fall back to category-based detection for mixed-content sources.
    const isTutorBySource = a.sourceId !== null && tutorSourceIds.has(a.sourceId);
    const isAssessmentBySource = a.sourceId !== null && assessmentSourceIds.has(a.sourceId);
    const isTutorByCategory = instructionSet.has(a.category);
    const isTutor = isTutorBySource || isTutorByCategory;
    const hasRef = sanitiseLORef(a.learningOutcomeRef) !== null;
    // #142: FK is the authority for linkage
    const hasFk = a.learningObjectiveId !== null;

    if (isTutor) {
      tutorTotal++;
      if (hasFk) tutorLinked++;
    } else if (isAssessmentBySource) {
      assessmentTotal++;
      if (hasFk) assessmentLinked++;
    } else {
      studentTotal++;
      if (hasFk) studentLinked++;
    }

    // Track FK-based LO coverage
    if (hasFk) {
      fkLoIdCounts.set(a.learningObjectiveId!, (fkLoIdCounts.get(a.learningObjectiveId!) ?? 0) + 1);
    }

    // Legacy counters (deprecated scorecard block)
    if (hasRef) {
      legacyWithRef++;
      if (a.learningOutcomeRef) {
        refCounts.set(a.learningOutcomeRef, (refCounts.get(a.learningOutcomeRef) ?? 0) + 1);
      }
    }
    if (hasFk) legacyWithFk++;
  }

  const studentLinkedPct = studentTotal > 0 ? Math.round((studentLinked / studentTotal) * 100) : 0;
  const assessmentLinkedPct = assessmentTotal > 0 ? Math.round((assessmentLinked / assessmentTotal) * 100) : 0;
  const tutorLinkedPct = tutorTotal > 0 ? Math.round((tutorLinked / tutorTotal) * 100) : 0;

  // ── Curriculum structure ───────────────────────────────
  const curricula = await prisma.curriculum.findMany({
    where: { subjectId: { in: subjectIds } },
    orderBy: { createdAt: "desc" },
    select: { id: true, modules: { select: { id: true, isActive: true, learningObjectives: { select: { id: true, ref: true, description: true } } } } },
  });
  const primaryCurriculumId = curricula[0]?.id ?? null;
  const allModules = curricula.flatMap((c) => c.modules);
  const activeModules = allModules.filter((m) => m.isActive);
  const los = activeModules.flatMap((m) => m.learningObjectives);
  const garbageDescriptions = los.filter((lo) => !isValidLoPair(lo.ref, lo.description)).length;

  // #142: LOs with at least one assertion linked via FK
  const outcomesWithoutContent = los.filter((lo) => !fkLoIdCounts.has(lo.id)).length;
  const outcomesWithContent = los.length - outcomesWithoutContent;

  // ── Questions ──────────────────────────────────────────
  const totalQuestions = sourceIds.length > 0
    ? await prisma.contentQuestion.count({ where: { sourceId: { in: sourceIds } } })
    : 0;
  const linkedQuestions = sourceIds.length > 0
    ? await prisma.contentQuestion.count({ where: { sourceId: { in: sourceIds }, assertionId: { not: null } } })
    : 0;
  const questionsLinkedPct = totalQuestions > 0 ? Math.round((linkedQuestions / totalQuestions) * 100) : 0;

  // ── Educator-facing warnings ───────────────────────────
  // #208: surface the 0-modules state explicitly so the lesson-plan view
  // doesn't fail with a cryptic "Curriculum has no modules" error.
  if (primaryCurriculumId && activeModules.length === 0) {
    warnings.push("Your curriculum has no modules yet. Click Regenerate to build them from your content.");
  } else if (los.length === 0 && primaryCurriculumId) {
    warnings.push("Your curriculum has no learning outcomes yet. Click Regenerate to build them from your content.");
  } else if (los.length > 0 && garbageDescriptions === los.length) {
    warnings.push("Your learning outcomes are placeholders. Click Regenerate to have the AI write proper descriptions from your content.");
  } else if (garbageDescriptions > 0) {
    warnings.push(
      `${garbageDescriptions} learning outcome${garbageDescriptions !== 1 ? "s need" : " needs"} a real description — regenerate the curriculum to fix.`,
    );
  }

  if (outcomesWithoutContent > 0 && los.length > 0) {
    warnings.push(
      `${outcomesWithoutContent} learning outcome${outcomesWithoutContent !== 1 ? "s have" : " has"} no teaching content yet — the student will be tested on them with nothing to fall back on.`,
    );
  }

  if (totalQuestions > 0 && linkedQuestions === 0) {
    warnings.push(
      `${totalQuestions} question${totalQuestions !== 1 ? "s" : ""} couldn't be matched to a teaching point — they'll still run, but won't track progress against outcomes.`,
    );
  }

  if (studentTotal === 0 && tutorTotal > 0) {
    warnings.push("All of your uploaded content looks like tutor instructions, not student teaching points. Check that you've uploaded the right documents on the Content tab.");
  }

  // ── Health pill computation ────────────────────────────
  const health = computeHealth({
    curriculumExists: primaryCurriculumId !== null,
    studentTotal,
    studentLinkedPct,
    garbageDescriptions,
    outcomesWithoutContent,
    totalLos: los.length,
    questionsLinkedPct,
    totalQuestions,
  });

  return {
    course: { id: playbook.id, name: playbook.name },
    curriculumId: primaryCurriculumId,
    health,
    studentContent: {
      total: studentTotal,
      linkedToOutcome: studentLinked,
      linkedPct: studentLinkedPct,
    },
    assessmentItems: {
      total: assessmentTotal,
      linkedToOutcome: assessmentLinked,
      linkedPct: assessmentLinkedPct,
    },
    tutorInstructions: {
      total: tutorTotal,
      linkedToOutcome: tutorLinked,
      linkedPct: tutorLinkedPct,
    },
    questions: {
      total: totalQuestions,
      linkedToTp: linkedQuestions,
      linkedPct: questionsLinkedPct,
    },
    structure: {
      activeModules: activeModules.length,
      totalModules: allModules.length,
      learningOutcomes: los.length,
      outcomesWithContent,
      outcomesWithoutContent,
      garbageDescriptions,
    },
    warnings,
    // Deprecated legacy block
    scorecard: scoreCoverage({
      total: assertions.length,
      withValidRef: legacyWithRef,
      withFk: legacyWithFk,
      distinctRefs: refCounts.size,
      garbageDescriptions,
    }),
    loRows: { total: los.length, garbageDescriptions, orphanLos: outcomesWithoutContent },
    modules: { total: allModules.length, active: activeModules.length },
  };
}

// ── Health pill ─────────────────────────────────────────────

function computeHealth(input: {
  curriculumExists: boolean;
  studentTotal: number;
  studentLinkedPct: number;
  garbageDescriptions: number;
  outcomesWithoutContent: number;
  totalLos: number;
  questionsLinkedPct: number;
  totalQuestions: number;
}): CurriculumHealth {
  if (!input.curriculumExists || input.totalLos === 0) return "not_started";
  if (input.garbageDescriptions > 0) return "needs_attention";
  if (input.studentTotal === 0) return "needs_attention";
  if (input.studentLinkedPct < 20) return "needs_attention";

  const allOutcomesCovered = input.outcomesWithoutContent === 0;
  const strongCoverage = input.studentLinkedPct >= 60;
  const questionsHealthy = input.totalQuestions === 0 || input.questionsLinkedPct >= 50;

  if (allOutcomesCovered && strongCoverage && questionsHealthy) return "ready";
  return "nearly_there";
}

// ── Empty/early-exit helper ─────────────────────────────────

function makeEmptyScorecard(
  playbook: { id: string; name: string },
  curriculumId: string | null,
  health: CurriculumHealth,
  warnings: string[],
): CourseLinkageScorecard {
  return {
    course: { id: playbook.id, name: playbook.name },
    curriculumId,
    health,
    studentContent: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
    assessmentItems: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
    tutorInstructions: { total: 0, linkedToOutcome: 0, linkedPct: 0 },
    questions: { total: 0, linkedToTp: 0, linkedPct: 0 },
    structure: {
      activeModules: 0,
      totalModules: 0,
      learningOutcomes: 0,
      outcomesWithContent: 0,
      outcomesWithoutContent: 0,
      garbageDescriptions: 0,
    },
    warnings,
    scorecard: scoreCoverage({ total: 0, withValidRef: 0, withFk: 0, distinctRefs: 0, garbageDescriptions: 0 }),
    loRows: { total: 0, garbageDescriptions: 0, orphanLos: 0 },
    modules: { total: 0, active: 0 },
  };
}
