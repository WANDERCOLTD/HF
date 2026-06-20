/**
 * Shared helper for creating pedagogy ContentSource + ContentAssertion
 * rows from course-reference data during `create_course`.
 *
 * Closes #1545 — the pre-#1547 monolith carried mirror-pair write blocks
 * in the reuse-path and new-path branches; both shipped with three
 * silently-dropped field references (`status` on ContentSource,
 * `confidence` + `isActive` on ContentAssertion, none of which exist on
 * the Prisma models) plus a missing required `slug`. Result: Prisma
 * threw on every wizard-driven course; the outer try/catch logged
 * "non-fatal" and the assertions never landed.
 *
 * The write shape mirrors the canonical route at
 * `app/api/courses/[courseId]/course-reference/route.ts:145-177` so the
 * two pedagogy-write surfaces stay in lockstep.
 *
 * #2132 (2026-06-20) — closed the `subjectSourceId` I1 gap on this
 * surface. Every `ContentAssertion.create` now passes the SubjectSource
 * id captured from `prisma.subjectSource.create` above, so
 * SectionDataLoader's strict-FK filter on `curriculumAssertions` does
 * not leak rows cross-course inside the shared Subject (ENTITIES.md §6
 * I1). Sibling gaps on `app/api/content-sources/route.ts` and the
 * course-pack ingest path are still open — separate concern.
 *
 * Out of scope for #1545:
 *   - Backfill of historical wizard-created courses that never received
 *     pedagogy assertions — a separate ops concern (see PR body for
 *     the live count probe).
 */

import { createHash } from "node:crypto";
import slugify from "slugify";

import { prisma } from "@/lib/prisma";
import { upsertPlaybookSource } from "@/lib/knowledge/domain-sources";
import type { AssertionCreateData } from "@/lib/content-trust/course-ref-to-assertions";

export interface PedagogyContext {
  /** Display title used to derive the ContentSource slug + name. */
  courseName: string;
  /** The playbook scope for the PlaybookSource dual-write. */
  playbookId: string;
  /** Primary subject id for the SubjectSource linkage. */
  subjectId: string;
  /** Rendered markdown the assertions were extracted from. */
  textSample: string;
  /**
   * Rows produced by `convertCourseRefToAssertions(refData)`. Each row
   * is the partial `ContentAssertion` shape minus FK + provenance.
   */
  assertionRows: AssertionCreateData[];
}

export interface PedagogyResult {
  sourceId: string;
  assertionCount: number;
}

/**
 * Creates the ContentSource + ContentAssertion rows for a course's
 * course-reference pedagogy block. Idempotent at the SubjectSource +
 * PlaybookSource join layer (uses upsert / create patterns matching the
 * canonical route).
 *
 * Throws on Prisma validation failure — the caller's try/catch decides
 * whether a failure is fatal to the wizard run. Pre-fix the outer
 * try/catch swallowed Prisma rejects as "non-fatal"; post-fix the same
 * try/catch surfaces any future drift as a real diagnostic.
 */
export async function createPedagogyAssertionsFromCourseRef(
  ctx: PedagogyContext,
): Promise<PedagogyResult> {
  const { courseName, playbookId, subjectId, textSample, assertionRows } = ctx;

  const contentHash = createHash("sha256")
    .update(textSample)
    .digest("hex");

  // Slug shape mirrors `course-reference/route.ts:165` —
  // `${slugify(playbook.name)}-ref-${Date.now()}` so reuse-path +
  // new-path + canonical-route stay drift-resistant.
  const sourceSlug = `${slugify(courseName, { lower: true, strict: true })}-ref-${Date.now()}`;

  const refSource = await prisma.contentSource.create({
    data: {
      slug: sourceSlug,
      name: `${courseName} — Course Reference`,
      documentType: "COURSE_REFERENCE",
      trustLevel: "EXPERT_CURATED",
      textSample,
      contentHash,
      isActive: true,
    },
    select: { id: true },
  });

  const subjectSource = await prisma.subjectSource.create({
    data: { subjectId, sourceId: refSource.id },
    select: { id: true },
  });

  await upsertPlaybookSource(playbookId, refSource.id, {
    tags: ["course-reference"],
  });

  for (const row of assertionRows) {
    await prisma.contentAssertion.create({
      data: {
        ...row,
        sourceId: refSource.id,
        // #2132 — ENTITIES.md §6 I1: every ContentAssertion write MUST
        // pass subjectSourceId so SectionDataLoader's strict-FK filter
        // on `curriculumAssertions` scopes correctly. Pre-#2132 this
        // field was null and assertions leaked cross-course inside the
        // shared Subject.
        subjectSourceId: subjectSource.id,
        // Course-reference assertions are teacher-authored — bias the
        // LO-link confidence to 1.0 so the linker treats them as
        // high-confidence anchors (per `reconcile-lo-linkage.ts`
        // 1.0 == structured-ref match).
        linkConfidence: 1.0,
        depth: 0,
      },
    });
  }

  return { sourceId: refSource.id, assertionCount: assertionRows.length };
}
