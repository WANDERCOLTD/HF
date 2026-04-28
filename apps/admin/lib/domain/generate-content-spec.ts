/**
 * Generate Content Spec from Domain's Content Sources
 *
 * Loads assertions from the domain's subject sources, uses AI to generate
 * a structured curriculum, then creates a CONTENT spec and adds it to
 * the domain's playbook.
 *
 * Reuses extractCurriculumFromAssertions() from content-trust pipeline.
 * Idempotent: skips if content spec already exists.
 */

import { db, type TxClient } from "@/lib/prisma";
import { extractCurriculumFromAssertions, type CurriculumIntents } from "@/lib/content-trust/extract-curriculum";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";
import type { LegacyCurriculumModuleJSON } from "@/lib/types/json-fields";

// ── Types ──────────────────────────────────────────────

export interface ContentSpecResult {
  contentSpec: { id: string; slug: string; name: string } | null;
  moduleCount: number;
  assertionCount: number;
  addedToPlaybook: boolean;
  skipped: string[];
  wasRegenerated?: boolean;
  error?: string;
}

export interface GenerateContentSpecOptions {
  intents?: CurriculumIntents;
  regenerate?: boolean;
  /** Scope to specific subjects (by ID). When provided, only assertions from these subjects are loaded. */
  subjectIds?: string[];
}

// ── Load domain assertions (shared between skeleton + full generation) ──

export interface DomainAssertionData {
  domain: { id: string; slug: string; name: string };
  assertions: Array<{ id: string; assertion: string; category: string; chapter: string | null; section: string | null; tags: string[] }>;
  subjectName: string;
  qualificationRef?: string;
  sourceCount: number;
}

/**
 * Load assertions from a domain's content sources.
 * Shared data-loading step used by both skeleton extraction and full generation.
 *
 * When `subjectIds` is provided, only assertions from those specific subjects
 * are loaded (course-scoped). Otherwise loads all subjects for the domain.
 */
export async function loadDomainAssertions(domainId: string, tx?: TxClient, subjectIds?: string[]): Promise<DomainAssertionData> {
  const p = db(tx);

  const domain = await p.domain.findUnique({
    where: { id: domainId },
    select: { id: true, slug: true, name: true },
  });

  if (!domain) throw new Error(`Domain not found: ${domainId}`);

  // When subjectIds provided, scope to those subjects (must still belong to this domain)
  const subjectFilter = subjectIds?.length
    ? { subject: { id: { in: subjectIds }, domains: { some: { domainId } } } }
    : { subject: { domains: { some: { domainId } } } };

  const subjectSources = await p.subjectSource.findMany({
    where: subjectFilter,
    select: {
      sourceId: true,
      tags: true,
      subject: { select: { name: true, qualificationRef: true } },
    },
  });

  if (subjectSources.length === 0) {
    return { domain, assertions: [], subjectName: domain.name, sourceCount: 0 };
  }

  const sourceIds = subjectSources.map((ss) => ss.sourceId);
  const assertions = await p.contentAssertion.findMany({
    where: { sourceId: { in: sourceIds } },
    select: { id: true, assertion: true, category: true, chapter: true, section: true, tags: true },
    orderBy: [{ chapter: "asc" }, { section: "asc" }, { createdAt: "asc" }],
  });

  return {
    domain,
    assertions: assertions.map((a) => ({
      id: a.id, // required for in-extractor LO-ref write-back
      assertion: a.assertion,
      category: a.category || "fact",
      chapter: a.chapter,
      section: a.section,
      tags: (a.tags as string[]) || [],
    })),
    subjectName: subjectSources[0]?.subject?.name || domain.name,
    qualificationRef: subjectSources[0]?.subject?.qualificationRef || undefined,
    sourceCount: subjectSources.length,
  };
}

// ── Main function ──────────────────────────────────────

export async function generateContentSpec(domainId: string, options?: GenerateContentSpecOptions, tx?: TxClient): Promise<ContentSpecResult> {
  const skipped: string[] = [];
  const p = db(tx);

  // 1. Load domain + assertions via shared loader (optionally scoped to specific subjects)
  const { domain, assertions, subjectName, qualificationRef, sourceCount } = await loadDomainAssertions(domainId, tx, options?.subjectIds);

  // 2. Check if curriculum already exists for THIS course's subjects (not domain-wide)
  const curriculumFilter = options?.subjectIds?.length
    ? { subjectId: { in: options.subjectIds } }
    : { subject: { domains: { some: { domainId } } } };
  const existingCurriculum = await p.curriculum.findFirst({
    where: curriculumFilter,
    select: { id: true },
  });

  if (existingCurriculum && !options?.regenerate) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["Curriculum already exists"],
    };
  }

  if (sourceCount === 0) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["No content sources linked to domain subjects"],
    };
  }

  if (assertions.length === 0) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["No assertions extracted from content sources yet"],
    };
  }

  // 3. Call existing AI curriculum extraction
  const curriculum = await extractCurriculumFromAssertions(
    assertions,
    subjectName,
    qualificationRef,
    options?.intents,
  );

  if (!curriculum.ok || curriculum.modules.length === 0) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: assertions.length,
      addedToPlaybook: false,
      skipped: [],
      error: curriculum.error || "AI curriculum extraction produced no modules",
    };
  }

  // 4. Write assertionTags directly to ContentAssertion.learningOutcomeRef.
  //
  // This function is the wizard's primary curriculum-generation path (via
  // generateInstantCurriculum). Since ADR-002, it no longer creates an
  // AnalysisSpec and doesn't call syncModulesToDB — the Curriculum/Module/LO
  // rows are written by a separate path (persistPlanToCurriculum) that has
  // no access to the assertion tags. If we don't write tags here, they
  // vanish and applyAssertionTags never fires.
  //
  // Structural guard per .claude/rules/ai-to-db-guard.md:
  //   - Each tag's index must map to a real assertion ID in the input list
  //   - Each ref must match an LO ref the curriculum just emitted
  //   - Writes are capped per ref to the input size (no surprise multipliers)
  if (curriculum.assertionTags.length > 0) {
    const validRefs = new Set<string>();
    for (const m of curriculum.modules) {
      for (const lo of m.learningOutcomes || []) {
        // LO lines are "LOn: description" — extract the ref.
        const match = /^\s*(LO-?\d+|AC[\d.]+|R\d+-LO-?\d+(?:-AC[\d.]+)?)\s*:/i.exec(lo);
        if (match) validRefs.add(match[1].toUpperCase());
      }
    }

    const byRef = new Map<string, string[]>();
    let skippedBadIndex = 0;
    let skippedUnknownRef = 0;

    for (const tag of curriculum.assertionTags) {
      if (typeof tag.i !== "number" || tag.i < 1 || tag.i > assertions.length) {
        skippedBadIndex++;
        continue;
      }
      const id = assertions[tag.i - 1]?.id;
      if (!id) {
        skippedBadIndex++;
        continue;
      }
      if (tag.ref === null || tag.ref === undefined) continue;
      if (!validRefs.has(tag.ref.toUpperCase())) {
        skippedUnknownRef++;
        continue;
      }
      const list = byRef.get(tag.ref) || [];
      if (list.length >= assertions.length) continue;
      list.push(id);
      byRef.set(tag.ref, list);
    }

    let applied = 0;
    for (const [ref, ids] of byRef) {
      const res = await p.contentAssertion.updateMany({
        where: { id: { in: ids } },
        data: { learningOutcomeRef: ref },
      });
      applied += res.count;
    }

    if (applied > 0 || skippedBadIndex > 0 || skippedUnknownRef > 0) {
      console.log(
        `[generate-content-spec] applyAssertionTags domainId=${domainId}: ` +
          `applied=${applied} skipped-bad-index=${skippedBadIndex} skipped-unknown-ref=${skippedUnknownRef}`,
      );
    }
  }

  // 5. Persist curriculum to DB (ADR-002: Curriculum/Module/LO tables, not AnalysisSpec).
  //    Find the subject that owns these assertions, upsert a Curriculum record,
  //    then sync modules + LOs via the standard sync pipeline.
  const subjectId = options?.subjectIds?.[0];
  if (subjectId) {
    try {
      const existingCurr = await p.curriculum.findFirst({
        where: { subjectId },
        select: { id: true },
      });
      const slugify = (await import("slugify")).default;
      const currSlug = `${slugify(subjectName, { lower: true, strict: true })}-content-${Date.now()}`;
      // Resolve playbookId from subject → PlaybookSubject
      const pbLink = await p.playbookSubject.findFirst({
        where: { subjectId },
        select: { playbookId: true },
      });

      const curriculumRecord = existingCurr ?? await p.curriculum.create({
        data: {
          slug: currSlug,
          subjectId,
          playbookId: pbLink?.playbookId ?? null,
          name: curriculum.name || subjectName,
          description: curriculum.description || "",
          deliveryConfig: curriculum.deliveryConfig || {},
        },
      });

      const modulesToSync: LegacyCurriculumModuleJSON[] = curriculum.modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        sortOrder: m.sortOrder,
        estimatedDurationMinutes: m.estimatedDurationMinutes ?? undefined,
        learningOutcomes: m.learningOutcomes,
        assessmentCriteria: m.assessmentCriteria,
        keyTerms: m.keyTerms,
      }));

      const assertionIdByIndex = new Map<number, string>();
      assertions.forEach((a, i) => assertionIdByIndex.set(i + 1, a.id));

      const syncResult = await syncModulesToDB(curriculumRecord.id, modulesToSync, {
        mode: "merge",
        assertionTags: curriculum.assertionTags,
        assertionIdByIndex,
      });

      console.log(
        `[generate-content-spec] persisted curriculum: ${syncResult.count} modules → ${curriculumRecord.id}`,
      );

      // #208: refuse to commit a Curriculum row with zero modules. Earlier
      // versions swallowed sync failures and left orphans that surfaced as
      // "Curriculum has no modules" errors in the lesson plan view.
      if (syncResult.count === 0 && curriculum.modules.length > 0) {
        throw new Error(
          `Curriculum sync produced 0 modules from ${curriculum.modules.length} input modules — refusing to commit orphan curriculum row ${curriculumRecord.id}`,
        );
      }
    } catch (err) {
      // #208: re-throw so the caller (and any wrapping transaction) sees the
      // failure and can roll back, rather than silently leaving a Curriculum
      // row without modules.
      console.error("[generate-content-spec] curriculum persist failed:", (err as Error).message);
      throw err;
    }
  }

  return {
    contentSpec: null,
    moduleCount: curriculum.modules.length,
    assertionCount: assertions.length,
    addedToPlaybook: false,
    skipped,
  };
}

// ── Contract Patching ─────────────────────────────────

/**
 * Patch a CONTENT spec to be CURRICULUM_PROGRESS_V1 compliant.
 *
 * AI-generated content specs (from quick-launch or enrichment) have
 * config.modules[] but miss the required metadata.curriculum section
 * and the parameters[] format that the curriculum system expects.
 *
 * This patch adds both without touching the existing modules[] (legacy compat).
 */
export async function patchContentSpecForContract(specId: string, tx?: TxClient): Promise<void> {
  const p = db(tx);
  const spec = await p.analysisSpec.findUnique({
    where: { id: specId },
    select: { config: true },
  });

  if (!spec?.config) return;

  const cfg = spec.config as Record<string, any>;

  // Skip if already has metadata.curriculum (idempotent)
  if (cfg.metadata?.curriculum) return;

  // Add metadata.curriculum for contract compliance
  cfg.metadata = {
    ...cfg.metadata,
    curriculum: {
      type: "sequential",
      trackingMode: "module-based",
      moduleSelector: "section=content",
      moduleOrder: "sortBySequence",
      progressKey: "current_module",
      masteryThreshold: 0.7,
    },
  };

  // Convert modules to parameters[] format for contract-driven extraction
  if (Array.isArray(cfg.modules) && !cfg.parameters) {
    cfg.parameters = cfg.modules.map((m: any, i: number) => ({
      id: m.id,
      name: m.title || m.name,
      description: m.description || "",
      section: "content",
      sequence: m.sortOrder ?? i,
      config: {
        ...m,
        learningOutcomes: m.learningOutcomes || [],
        assessmentCriteria: m.assessmentCriteria || [],
        keyTerms: m.keyTerms || [],
      },
    }));
  }

  await p.analysisSpec.update({
    where: { id: specId },
    data: { config: cfg },
  });
}
