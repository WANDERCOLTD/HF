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

  // 2. Check if curriculum already exists for this domain's subjects
  const existingCurriculum = await p.curriculum.findFirst({
    where: { subject: { domains: { some: { domainId } } } },
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

  // 6. Content Spec as AnalysisSpec removed (ADR-002).
  //    Curriculum data now lives in Curriculum + CurriculumModule + LearningObjective tables,
  //    populated by extractCurriculumFromAssertions → Curriculum model pipeline.
  //    The AnalysisSpec is no longer created or linked to playbooks.

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
