/**
 * Instant Curriculum Generation
 *
 * Shared function that generates a CONTENT spec with curriculum modules.
 * Extracted from Quick Launch's `generate_curriculum` step so that
 * GS V2 wizard (and any future wizard) can reuse the same logic.
 *
 * Two paths:
 *  1. Content uploaded (subjectIds present + assertions exist)
 *     → generateContentSpec() from assertions
 *  2. No content (goals-based)
 *     → generateSkeletonCurriculum() with generateCurriculumFromGoals() fallback
 *
 * Idempotent: checks for existing CONTENT spec slug before creating.
 */

import { db } from "@/lib/prisma";
import {
  generateContentSpec,
  patchContentSpecForContract,
} from "@/lib/domain/generate-content-spec";
import { generateSkeletonCurriculum } from "@/lib/content-trust/generate-skeleton-curriculum";
import { generateCurriculumFromGoals } from "@/lib/content-trust/extract-curriculum";
import type { CurriculumIntents } from "@/lib/content-trust/extract-curriculum";

// ── Types ──────────────────────────────────────────────

export interface InstantCurriculumInput {
  domainId: string;
  playbookId: string;
  subjectName: string;
  persona: string;
  learningGoals?: string[];
  qualificationRef?: string;
  subjectIds?: string[];
  intents?: CurriculumIntents;
}

export interface InstantCurriculumResult {
  ok: boolean;
  contentSpecId?: string;
  moduleCount: number;
  path: "assertions" | "skeleton" | "goals" | "skipped";
  error?: string;
}

// ── Main Function ──────────────────────────────────────

export async function generateInstantCurriculum(
  input: InstantCurriculumInput,
): Promise<InstantCurriculumResult> {
  const {
    domainId,
    playbookId,
    subjectName,
    persona,
    learningGoals = [],
    qualificationRef,
    subjectIds,
    intents,
  } = input;

  const p = db();

  // ── Idempotency: check if playbook already has a CONTENT spec ──
  const existingContentItem = await p.playbookItem.findFirst({
    where: {
      playbookId,
      spec: { specRole: "CONTENT" },
    },
    select: { specId: true },
  });

  if (existingContentItem) {
    return { ok: true, contentSpecId: existingContentItem.specId!, moduleCount: 0, path: "skipped" };
  }

  // ── Path 1: Assertion-based (content uploaded) ──
  if (subjectIds && subjectIds.length > 0) {
    const result = await generateContentSpec(domainId, { subjectIds, intents });

    if (result.contentSpec) {
      await patchContentSpecForContract(result.contentSpec.id);

      // Ensure it's linked to THIS playbook (generateContentSpec links to first published)
      await ensurePlaybookLink(playbookId, result.contentSpec.id);

      return {
        ok: true,
        contentSpecId: result.contentSpec.id,
        moduleCount: result.moduleCount,
        path: "assertions",
      };
    }
    // No assertions yet — fall through to goals-based
  }

  // ── Path 2: Goals-based (no content uploaded) ──

  // Phase 1: Fast skeleton (~3-5s with Haiku)
  let skeleton = await generateSkeletonCurriculum(
    subjectName,
    persona,
    learningGoals,
    qualificationRef,
  );

  let generationPath: "skeleton" | "goals" = "skeleton";

  // Fallback: full generation if skeleton fails
  if (!skeleton.ok || skeleton.modules.length === 0) {
    console.warn("[instant-curriculum] Skeleton failed, falling back to full generation:", skeleton.error);
    const fullCurriculum = await generateCurriculumFromGoals(
      subjectName,
      persona,
      learningGoals,
      qualificationRef,
      intents?.sessionCount,
    );

    if (!fullCurriculum.ok || fullCurriculum.modules.length === 0) {
      return {
        ok: false,
        moduleCount: 0,
        path: "goals",
        error: fullCurriculum.error || "Curriculum generation produced no modules",
      };
    }

    skeleton = {
      ok: true,
      name: fullCurriculum.name,
      description: fullCurriculum.description,
      modules: fullCurriculum.modules,
      warnings: fullCurriculum.warnings,
    };
    generationPath = "goals";
  }

  // ── Create CONTENT spec ──
  const domain = await p.domain.findUnique({
    where: { id: domainId },
    select: { slug: true, name: true },
  });

  if (!domain) {
    return { ok: false, moduleCount: 0, path: generationPath, error: `Domain not found: ${domainId}` };
  }

  const contentSlug = `${domain.slug}-content`;

  // Idempotency check by slug
  const existingSpec = await p.analysisSpec.findFirst({
    where: { slug: contentSlug },
    select: { id: true },
  });

  if (existingSpec) {
    await ensurePlaybookLink(playbookId, existingSpec.id);
    return { ok: true, contentSpecId: existingSpec.id, moduleCount: 0, path: "skipped" };
  }

  const contentSpec = await p.analysisSpec.create({
    data: {
      slug: contentSlug,
      name: `${domain.name} Curriculum`,
      description: skeleton.description || `AI-generated curriculum for ${domain.name}`,
      outputType: "COMPOSE",
      specRole: "CONTENT",
      specType: "DOMAIN",
      domain: "content",
      scope: "DOMAIN",
      isActive: true,
      isDirty: false,
      isDeletable: true,
      config: JSON.parse(JSON.stringify({
        modules: skeleton.modules,
        deliveryConfig: {},
        sourceCount: 0,
        assertionCount: 0,
        generatedFrom: generationPath,
        generatedAt: new Date().toISOString(),
      })),
      triggers: {
        create: [{
          given: `A ${domain.name} teaching session with curriculum content`,
          when: "The system needs to deliver structured teaching material",
          then: "Content is presented following the curriculum module sequence",
          name: "Curriculum delivery",
          sortOrder: 0,
        }],
      },
    },
    select: { id: true },
  });

  // Link to playbook
  await ensurePlaybookLink(playbookId, contentSpec.id);

  // Patch for CURRICULUM_PROGRESS_V1 contract compliance
  await patchContentSpecForContract(contentSpec.id);

  return {
    ok: true,
    contentSpecId: contentSpec.id,
    moduleCount: skeleton.modules.length,
    path: generationPath,
  };
}

// ── Helper: ensure spec is linked to playbook ──────────

async function ensurePlaybookLink(playbookId: string, specId: string): Promise<void> {
  const p = db();

  const existing = await p.playbookItem.findFirst({
    where: { playbookId, specId },
  });

  if (existing) return;

  const maxItem = await p.playbookItem.findFirst({
    where: { playbookId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await p.playbookItem.create({
    data: {
      playbookId,
      itemType: "SPEC",
      specId,
      sortOrder: (maxItem?.sortOrder ?? 0) + 1,
      isEnabled: true,
    },
  });

  // Re-publish to update stats
  await p.playbook.update({
    where: { id: playbookId },
    data: { publishedAt: new Date() },
  });
}
