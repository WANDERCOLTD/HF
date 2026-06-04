/**
 * Course Variant — creates a sibling Playbook against a parent's shared
 * Curriculum + Subject + Source library (#1034).
 *
 * A variant Playbook is a new Course with the same content authority as
 * its parent but a different teaching profile (Pop Quiz, Revision Aid,
 * Exam Assessment). All variants of one parent share:
 *   • one Curriculum (via PlaybookCurriculum `linked` role)
 *   • the same Subject set (via PlaybookSubject rows)
 *   • the same ContentSource set (via PlaybookSource rows)
 *
 * Mastery flows naturally across siblings for the same Caller because:
 *   • `CallerAttribute.lo_mastery:{moduleSlug}:{loRef}` is slug-keyed
 *     (#611) — same Curriculum → same moduleSlug → shared row
 *   • `CallerModuleProgress` is `@@unique([callerId, moduleId])` — same
 *     CurriculumModule UUID across siblings → shared row
 *
 * This is the funnel mechanism: a learner who hits a gap in Pop Quiz
 * will see Revision Aid open directly on the weak LO, and Exam
 * Assessment will score against the same mastery state. See CC-E in
 * `docs/chain-contracts.md`.
 *
 * Chain contracts written:
 *   • CC-A — PlaybookCurriculum row with role='linked'
 *
 * Out of scope (deferred):
 *   • Curriculum cloning — variants NEVER write CurriculumModule rows.
 *     The shared moduleId UUID is what makes the funnel work.
 *   • PlaybookConfig preset wiring — the five preset config keys are
 *     forward-declared and have no runtime effect today.
 *   • Cohort/Invite — caller layers handle enrolment separately.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { unlinkNonPrimaryPlaybookSubjects } from "@/lib/knowledge/cleanup-placeholder-subjects";
import { auditLog, AuditAction } from "@/lib/audit";

export type VariantPreset = "revision" | "popquiz" | "exam";

export interface CreateVariantInput {
  /** The Playbook to sibling-clone. Must exist and have a primary Curriculum link. */
  parentPlaybookId: string;
  /** Display name for the new variant Course (e.g. "Pop Quiz — The Standard"). */
  name: string;
  /** Optional teaching-profile preset. Stored as JSON on Playbook.config; no runtime effect today (forward-declared keys). */
  preset?: VariantPreset;
  /** The User performing the create — for audit trail. */
  actorUserId: string;
  /** Free-form reason captured in the audit row. */
  reason?: string;
}

export interface CreateVariantResult {
  /** ID of the new variant Playbook. */
  variantPlaybookId: string;
  /** Curriculum the variant shares with its parent (null if parent had no Curriculum). */
  sharedCurriculumId: string | null;
  /** Number of PlaybookSubject links created on the variant. */
  subjectLinks: number;
  /** Number of PlaybookSource links created on the variant. */
  sourceLinks: number;
  /** Number of PlaybookSubject rows unlinked by the #607 invariant guard (usually 0). */
  unlinkedDuplicateSubjects: number;
}

/**
 * Preset PlaybookConfig seeds. All five keys (teachingProfile,
 * bloomLevelOverride, useFreshMastery, modelTier, welcomeMessage)
 * are forward-declared per the #1034 TL review — stored on
 * Playbook.config as JSON but not read by the runtime today. Cost
 * tiering (modelTier) and Bloom override (bloomLevelOverride) ship
 * in follow-up stories.
 */
const PRESET_CONFIGS: Record<VariantPreset, Prisma.JsonObject> = {
  revision: {
    teachingProfile: "coaching-led",
    welcomeMessage: "Welcome back. Let's revise what you've covered.",
    maxCallDurationSeconds: 1500,
    modelTier: "sonnet",
    bloomLevelOverride: { floor: "L2", ceiling: "L4" },
  },
  popquiz: {
    teachingProfile: "assessment-led",
    welcomeMessage: "Ready for a quick check? Let's see what's stuck.",
    maxCallDurationSeconds: 600,
    modelTier: "haiku",
    scope: "single-module",
    bloomLevelOverride: { floor: "L1", ceiling: "L3" },
  },
  exam: {
    teachingProfile: "discussion-led",
    welcomeMessage: "This is a mock assessment. Treat each prompt like an exam scenario.",
    maxCallDurationSeconds: 2400,
    modelTier: "sonnet",
    bloomLevelOverride: { floor: "L3", ceiling: "L5" },
    useFreshMastery: true,
  },
};

const TX_TIMEOUT_MS = 15_000;

export async function createPlaybookVariant(
  input: CreateVariantInput,
): Promise<CreateVariantResult> {
  const { parentPlaybookId, name, preset, actorUserId, reason } = input;

  if (!parentPlaybookId) throw new Error("parentPlaybookId is required");
  if (!name?.trim()) throw new Error("name is required");
  if (!actorUserId) throw new Error("actorUserId is required");

  const config: Prisma.JsonObject = preset ? PRESET_CONFIGS[preset] : {};

  // Resolve parent + shared resources OUTSIDE the transaction. Reads are
  // safe to do upfront and they shrink the tx window.
  const parent = await prisma.playbook.findUnique({
    where: { id: parentPlaybookId },
    select: {
      id: true,
      name: true,
      domainId: true,
      groupId: true,
      sortOrder: true,
      playbookCurricula: {
        // Primary first so the variant always links to the canonical
        // Curriculum, not a stray. Multiple primary rows shouldn't
        // exist (Curriculum.playbookId is single-FK + we backfill 1:1).
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: 1,
        select: { curriculumId: true },
      },
      subjects: {
        orderBy: { createdAt: "asc" },
        select: { subjectId: true },
      },
      playbookSources: {
        select: {
          sourceId: true,
          sortOrder: true,
          tags: true,
          trustLevelOverride: true,
        },
      },
    },
  });
  if (!parent) {
    throw new Error(`Parent Playbook ${parentPlaybookId} not found`);
  }

  const sharedCurriculumId = parent.playbookCurricula[0]?.curriculumId ?? null;
  const primarySubjectId = parent.subjects[0]?.subjectId ?? null;

  // All writes in a single transaction. Interactive form is required —
  // each step depends on the variant Playbook ID returned by step 1.
  const result = await prisma.$transaction(
    async (tx) => {
      // Step 1 — create the variant Playbook row.
      const variant = await tx.playbook.create({
        data: {
          name: name.trim(),
          domainId: parent.domainId,
          groupId: parent.groupId,
          sortOrder: parent.sortOrder + 1,
          status: "DRAFT",
          config,
          // parentVersionId stays null — siblings, not versions.
        },
        select: { id: true },
      });

      // Step 2 — link the shared Curriculum via a `linked` row (CC-A).
      // Variant does NOT clone CurriculumModule rows; the funnel depends
      // on shared module UUIDs.
      if (sharedCurriculumId) {
        await tx.playbookCurriculum.create({
          data: {
            playbookId: variant.id,
            curriculumId: sharedCurriculumId,
            role: "linked",
          },
        });
      }

      // Step 3 — link parent's Subjects (clone the join rows, not the Subjects).
      // skipDuplicates safe-guards against any racing data; per-row create
      // keeps audit cleaner than createMany for low cardinality.
      let subjectLinks = 0;
      for (const ps of parent.subjects) {
        await tx.playbookSubject.create({
          data: {
            playbookId: variant.id,
            subjectId: ps.subjectId,
          },
        });
        subjectLinks++;
      }

      // Step 4 — link parent's Sources (clone the join rows, not the Sources).
      let sourceLinks = 0;
      for (const psrc of parent.playbookSources) {
        await tx.playbookSource.create({
          data: {
            playbookId: variant.id,
            sourceId: psrc.sourceId,
            sortOrder: psrc.sortOrder,
            tags: psrc.tags,
            trustLevelOverride: psrc.trustLevelOverride,
          },
        });
        sourceLinks++;
      }

      return {
        variantPlaybookId: variant.id,
        subjectLinks,
        sourceLinks,
      };
    },
    { timeout: TX_TIMEOUT_MS },
  );

  // POST-tx — invariant guard from #607. The helper uses `prisma` not
  // `tx`, so it must run after commit. Removes any non-primary duplicate
  // PlaybookSubject rows on the variant (defence-in-depth: if the parent
  // had stale duplicates, the variant's copies are pruned to match the
  // #607 invariant "exactly one PlaybookSubject per playbook"). Skipped
  // when the parent had no Subjects.
  let unlinkedDuplicateSubjects = 0;
  if (primarySubjectId) {
    const unlink = await unlinkNonPrimaryPlaybookSubjects(
      result.variantPlaybookId,
      primarySubjectId,
    );
    unlinkedDuplicateSubjects = unlink.removed;
  }

  // POST-tx — audit row. CREATED_PLAYBOOK + variant metadata so the
  // audit log surfaces sibling provenance.
  await auditLog({
    userId: actorUserId,
    action: AuditAction.CREATED_PLAYBOOK,
    entityType: "Playbook",
    entityId: result.variantPlaybookId,
    metadata: {
      kind: "variant",
      parentPlaybookId,
      sharedCurriculumId,
      preset: preset ?? null,
      subjectLinks: result.subjectLinks,
      sourceLinks: result.sourceLinks,
      unlinkedDuplicateSubjects,
      reason: reason ?? null,
    },
  });

  return {
    variantPlaybookId: result.variantPlaybookId,
    sharedCurriculumId,
    subjectLinks: result.subjectLinks,
    sourceLinks: result.sourceLinks,
    unlinkedDuplicateSubjects,
  };
}
