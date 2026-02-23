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
}

// ── Main function ──────────────────────────────────────

export async function generateContentSpec(domainId: string, options?: GenerateContentSpecOptions, tx?: TxClient): Promise<ContentSpecResult> {
  const skipped: string[] = [];
  const p = db(tx);

  // 1. Load domain
  const domain = await p.domain.findUnique({
    where: { id: domainId },
    select: { id: true, slug: true, name: true },
  });

  if (!domain) {
    throw new Error(`Domain not found: ${domainId}`);
  }

  // 2. Check if content spec already exists
  const contentSlug = `${domain.slug}-content`;
  const existing = await p.analysisSpec.findFirst({
    where: { slug: contentSlug },
    select: { id: true, slug: true, name: true },
  });

  if (existing && !options?.regenerate) {
    return {
      contentSpec: existing,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["Content spec already exists"],
    };
  }

  // 3. Load assertions from domain's subject sources
  const subjectSources = await p.subjectSource.findMany({
    where: {
      subject: {
        domains: { some: { domainId } },
      },
    },
    select: {
      sourceId: true,
      tags: true,
      subject: {
        select: {
          name: true,
          qualificationRef: true,
        },
      },
    },
  });

  if (subjectSources.length === 0) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["No content sources linked to domain subjects"],
    };
  }

  const sourceIds = subjectSources.map((ss) => ss.sourceId);
  const assertions = await p.contentAssertion.findMany({
    where: { sourceId: { in: sourceIds } },
    select: {
      assertion: true,
      category: true,
      chapter: true,
      section: true,
      tags: true,
    },
    orderBy: [{ chapter: "asc" }, { section: "asc" }, { createdAt: "asc" }],
  });

  if (assertions.length === 0) {
    return {
      contentSpec: null,
      moduleCount: 0,
      assertionCount: 0,
      addedToPlaybook: false,
      skipped: ["No assertions extracted from content sources yet"],
    };
  }

  // 4. Get subject metadata for AI context
  const subjectName = subjectSources[0]?.subject?.name || domain.name;
  const qualificationRef = subjectSources[0]?.subject?.qualificationRef || undefined;

  // 5. Call existing AI curriculum extraction
  const curriculum = await extractCurriculumFromAssertions(
    assertions.map((a) => ({
      assertion: a.assertion,
      category: a.category || "fact",
      chapter: a.chapter,
      section: a.section,
      tags: a.tags,
    })),
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

  // 6. Create or update Content spec
  const specData = {
    slug: contentSlug,
    name: `${domain.name} Curriculum`,
    description: curriculum.description || `Structured curriculum for ${domain.name}, auto-generated from ${assertions.length} teaching points across ${subjectSources.length} source(s).`,
    outputType: "COMPOSE" as const,
    specRole: "CONTENT" as const,
    specType: "DOMAIN" as const,
    domain: "content",
    scope: "DOMAIN" as const,
    isActive: true,
    isDirty: false,
    isDeletable: true,
    config: JSON.parse(JSON.stringify({
      modules: curriculum.modules,
      deliveryConfig: curriculum.deliveryConfig,
      sourceCount: subjectSources.length,
      assertionCount: assertions.length,
      generatedAt: new Date().toISOString(),
    })),
  };

  const wasRegenerated = !!existing;
  let contentSpec: { id: string; slug: string; name: string };

  if (existing) {
    // Regenerate: update existing spec with new curriculum
    contentSpec = await p.analysisSpec.update({
      where: { id: existing.id },
      data: {
        name: specData.name,
        description: specData.description,
        config: specData.config,
        isDirty: false,
      },
      select: { id: true, slug: true, name: true },
    });
  } else {
    contentSpec = await p.analysisSpec.create({
      data: {
        ...specData,
        triggers: {
          create: [
            {
              given: `A ${domain.name} teaching session with curriculum content`,
              when: "The system needs to deliver structured teaching material",
              then: "Content is presented following the curriculum module sequence with appropriate learning outcomes",
              name: "Curriculum delivery",
              sortOrder: 0,
            },
          ],
        },
      },
      select: { id: true, slug: true, name: true },
    });
  }

  // 7. Add to published playbook
  let addedToPlaybook = false;
  const playbook = await p.playbook.findFirst({
    where: { domainId, status: "PUBLISHED" },
    select: { id: true },
  });

  if (playbook) {
    const existingItem = await p.playbookItem.findFirst({
      where: { playbookId: playbook.id, specId: contentSpec.id },
    });

    if (!existingItem) {
      // Find max sort order to append at end
      const maxItem = await p.playbookItem.findFirst({
        where: { playbookId: playbook.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });

      await p.playbookItem.create({
        data: {
          playbookId: playbook.id,
          itemType: "SPEC",
          specId: contentSpec.id,
          sortOrder: (maxItem?.sortOrder ?? 0) + 1,
          isEnabled: true,
        },
      });

      // Re-publish to update stats
      await p.playbook.update({
        where: { id: playbook.id },
        data: { publishedAt: new Date() },
      });

      addedToPlaybook = true;
    }
  }

  return {
    contentSpec,
    moduleCount: curriculum.modules.length,
    assertionCount: assertions.length,
    addedToPlaybook,
    wasRegenerated,
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
