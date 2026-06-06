import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { startCurriculumGeneration } from "@/lib/jobs/curriculum-runner";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";
import { ensurePrimaryPlaybookLink } from "@/lib/curriculum/ensure-primary-playbook-link";
import {
  deriveQualificationAnchor,
  isAnchorSafe,
} from "@/lib/curriculum/qualification-anchor";
import {
  findCurriculumByAnchor,
  QualificationAnchorAmbiguity,
} from "@/lib/curriculum/find-sibling-curricula";

type Params = { params: Promise<{ subjectId: string }> };

/**
 * @api GET /api/subjects/:subjectId/curriculum
 * @visibility public
 * @scope subjects:read
 * @auth VIEWER
 * @tags subjects, curriculum
 * @description Get the most recent curriculum for this subject.
 * @response 200 { curriculum: Curriculum | null }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;

    const curriculum = await prisma.curriculum.findFirst({
      where: { subjectId },
      orderBy: { updatedAt: "desc" },
    });

    if (!curriculum) {
      return NextResponse.json({ curriculum: null });
    }

    return NextResponse.json({ curriculum });
  } catch (error: any) {
    console.error("[subjects/:id/curriculum] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api POST /api/subjects/:subjectId/curriculum
 * @visibility public
 * @scope subjects:write
 * @auth OPERATOR
 * @tags subjects, curriculum
 * @description Generate or save curriculum.
 *   - mode=generate: Start async AI generation, return 202 + taskId for polling.
 *   - mode=save: Save curriculum to DB (reads preview from taskId if provided, otherwise from body).
 * @body { mode: "generate" | "save", taskId?: string, curriculum?: object }
 * @response 202 { ok, taskId } (generate mode)
 * @response 200 { ok, mode: "save", curriculum } (save mode)
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const userId = authResult.session.user.id;

    const { subjectId } = await params;
    const body = await req.json();
    const mode = body.mode || "generate";

    // Get subject
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    // ── Generate mode — async, return 202 ──
    if (mode === "generate") {
      // Quick validation: check sources exist
      const sourceCount = await prisma.subjectSource.count({
        where: { subjectId },
      });
      if (sourceCount === 0) {
        return NextResponse.json(
          { error: "No sources attached to this subject. Upload documents first." },
          { status: 400 }
        );
      }

      const assertionCount = await prisma.contentAssertion.count({
        where: {
          source: {
            subjects: { some: { subjectId } },
          },
        },
      });
      if (assertionCount === 0) {
        return NextResponse.json(
          { error: "No assertions found. Import documents and extract assertions first." },
          { status: 400 }
        );
      }

      // Check for existing active curriculum generation
      const active = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM "UserTask"
        WHERE "taskType" = 'curriculum_generation'
          AND "status" = 'in_progress'
          AND "context"->>'subjectId' = ${subjectId}
      `;

      if (Number(active[0]?.count ?? 0) > 0) {
        return NextResponse.json(
          { error: "Curriculum generation already in progress for this subject." },
          { status: 409 }
        );
      }

      const taskId = await startCurriculumGeneration(subjectId, subject.name, userId);

      return NextResponse.json(
        { ok: true, taskId },
        { status: 202 }
      );
    }

    // ── Save mode — persist curriculum to DB ──
    if (mode === "save") {
      let result = body.curriculum;
      // Reconstructed from the task context when committing a preview. Keeps
      // assertion tag write-back in the same request as the curriculum save.
      let assertionIdByIndex: Map<number, string> | undefined;

      // If taskId provided, read preview from the completed task
      if (body.taskId && !result) {
        const task = await prisma.userTask.findUnique({
          where: { id: body.taskId },
          select: { context: true, status: true },
        });
        if (!task) {
          return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }
        const ctx = task.context as Record<string, any>;
        result = ctx?.preview;
        const idByIndexObj = ctx?.assertionIdByIndexObj as Record<string, string> | undefined;
        if (idByIndexObj) {
          assertionIdByIndex = new Map(
            Object.entries(idByIndexObj).map(([k, v]) => [Number(k), v]),
          );
        }
        if (!result) {
          return NextResponse.json(
            { error: "No curriculum preview found in task. Generate first." },
            { status: 400 }
          );
        }
      }

      if (!result) {
        return NextResponse.json(
          { error: "No curriculum data provided. Pass curriculum in body or taskId to read from." },
          { status: 400 }
        );
      }

      // Find primary source
      const syllabusSources = await prisma.subjectSource.findMany({
        where: { subjectId, tags: { has: "syllabus" } },
        select: { sourceId: true },
      });
      const allSources = syllabusSources.length > 0
        ? syllabusSources
        : await prisma.subjectSource.findMany({
            where: { subjectId },
            select: { sourceId: true },
          });
      const primarySourceId = allSources[0]?.sourceId;

      const slug = `${subject.slug}-curriculum`;

      // Resolve playbookId from subject → PlaybookSubject.
      //
      // ⚠️ #317 follow-up — playbook-resolution race: a Subject can be
      // linked to MULTIPLE Playbooks (e.g. course renamed and a new
      // course shares the same subject). `findFirst` without ordering
      // returns the OLDEST link, attaching the new curriculum to the
      // wrong (older) playbook — observed on the IELTS Speaking
      // Practice 2026-05-10 wizard run.
      //
      // Fix: prefer the explicit `playbookId` from the request body if
      // the caller supplied one. Otherwise pick the MOST RECENT
      // PlaybookSubject link (newer = the playbook this subject was
      // most recently attached to). Log a warning when ambiguity exists
      // so we can audit.
      const explicitPlaybookId = typeof body.playbookId === "string" ? body.playbookId : null;
      const allLinks = await prisma.playbookSubject.findMany({
        where: { subjectId },
        select: { playbookId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      let resolvedPlaybookId: string | null = null;
      if (explicitPlaybookId) {
        const match = allLinks.find((l) => l.playbookId === explicitPlaybookId);
        if (!match) {
          return NextResponse.json(
            { ok: false, error: `Subject ${subjectId} is not linked to playbook ${explicitPlaybookId}.` },
            { status: 400 },
          );
        }
        resolvedPlaybookId = explicitPlaybookId;
      } else {
        resolvedPlaybookId = allLinks[0]?.playbookId ?? null;
        if (allLinks.length > 1) {
          console.warn(
            `[curriculum POST] subject ${subjectId} is linked to ${allLinks.length} playbooks; ` +
              `picked most recent ${resolvedPlaybookId} but caller should pass explicit playbookId. ` +
              `Links: ${allLinks.map((l) => `${l.playbookId} (${l.createdAt.toISOString()})`).join(", ")}`,
          );
        }
      }

      // #1081 Slice 2B.2 — anchor-aware sibling-link. Before minting a new
      // Curriculum, see if this subject's qualification metadata derives to
      // a known anchor that's already attached to a Curriculum in the same
      // domain. If so, link the resolved Playbook to that shared Curriculum
      // instead of forking a new one. The slug-keyed upsert below still
      // wins when the same subject re-runs generation (slug == existing
      // Curriculum's slug → update branch).
      const derivedAnchor = deriveQualificationAnchor(
        subject.qualificationBody,
        subject.qualificationRef,
      );

      // Look up domainId via the resolved Playbook (we already have it).
      // The check only fires when (a) a real anchor was derived, (b) it
      // passes the safety guard, (c) we have a Playbook to link from, (d)
      // the slug-keyed upsert isn't going to hit an existing row.
      const existingBySlug = await prisma.curriculum.findUnique({
        where: { slug },
        select: { id: true },
      });

      let siblingLink: { curriculumId: string } | null = null;
      if (!existingBySlug && derivedAnchor && isAnchorSafe(derivedAnchor) && resolvedPlaybookId) {
        const pbDomain = await prisma.playbook.findUnique({
          where: { id: resolvedPlaybookId },
          select: { domainId: true },
        });
        if (pbDomain?.domainId) {
          try {
            const sibling = await findCurriculumByAnchor(
              derivedAnchor,
              pbDomain.domainId,
            );
            if (sibling) {
              // Link the Playbook to the existing sibling Curriculum and
              // return that as the resolved Curriculum.
              await prisma.playbookCurriculum.upsert({
                where: {
                  playbookId_curriculumId: {
                    playbookId: resolvedPlaybookId,
                    curriculumId: sibling.id,
                  },
                },
                create: {
                  playbookId: resolvedPlaybookId,
                  curriculumId: sibling.id,
                  role: "linked",
                },
                update: {},
              });
              siblingLink = { curriculumId: sibling.id };
              console.log(
                `[subjects/:id/curriculum] Linked playbook ${resolvedPlaybookId} ` +
                  `to sibling Curriculum ${sibling.id} via qualificationAnchor=` +
                  `"${derivedAnchor}" — skipping fresh mint`,
              );
            }
          } catch (err: unknown) {
            if (err instanceof QualificationAnchorAmbiguity) {
              return NextResponse.json(
                { ok: false, error: err.message, code: "qualification_anchor_ambiguity" },
                { status: 409 },
              );
            }
            throw err;
          }
        }
      } else if (derivedAnchor && !isAnchorSafe(derivedAnchor)) {
        console.warn(
          `[subjects/:id/curriculum] derived qualificationAnchor failed ` +
            `safety check, treating as null for sibling lookup (still stamped ` +
            `on Curriculum for labelling): "${derivedAnchor}"`,
        );
      }

      const curriculum = siblingLink
        ? await prisma.curriculum.findUniqueOrThrow({
            where: { id: siblingLink.curriculumId },
          })
        : await prisma.$transaction(async (tx) => {
            const upserted = await tx.curriculum.upsert({
              where: { slug },
              create: {
                slug,
                name: result.name,
                description: result.description,
                subjectId,
                // #1177 Slice 6 / #1038 — Curriculum.playbookId dropped;
                // ownership lives in PlaybookCurriculum (primary join below).
                primarySourceId,
                trustLevel: subject.defaultTrustLevel,
                qualificationBody: subject.qualificationBody,
                qualificationNumber: subject.qualificationRef,
                qualificationLevel: subject.qualificationLevel,
                // #1081 Slice 2B.2 — stamp the derived anchor so subsequent
                // siblings in the same domain find it. Null when no
                // qualification metadata or anchor was unsafe.
                qualificationAnchor: derivedAnchor && isAnchorSafe(derivedAnchor) ? derivedAnchor : null,
                notableInfo: { modules: result.modules } as unknown as Prisma.InputJsonValue,
                coreArgument: Prisma.JsonNull,
                deliveryConfig: result.deliveryConfig as unknown as Prisma.InputJsonValue,
                version: "1.0",
              },
              update: {
                name: result.name,
                description: result.description,
                primarySourceId,
                trustLevel: subject.defaultTrustLevel,
                notableInfo: { modules: result.modules } as unknown as Prisma.InputJsonValue,
                deliveryConfig: result.deliveryConfig as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
            });
            // #1204 — fresh-mint AND update paths both ensure a primary join row
            // exists. Idempotent: if the row already exists (with any role) it's
            // left alone; if missing, created with role='primary'.
            if (resolvedPlaybookId) {
              await ensurePrimaryPlaybookLink(tx, resolvedPlaybookId, upserted.id);
            }
            return upserted;
          });

      // If we linked to a sibling, also ensure the primary PlaybookCurriculum
      // row exists with role=linked (no further DB writes for the shared
      // Curriculum's contents — those belong to the primary owner).
      if (siblingLink) {
        return NextResponse.json({
          ok: true,
          mode: "save",
          curriculum,
          linkedToSibling: true,
          qualificationAnchor: derivedAnchor,
        });
      }

      // Dual-write: sync modules to first-class DB models. Pass assertion
      // tags + index map so the tag write happens in the same transaction
      // as the LO upsert, just before reconcile binds FKs.
      if (result.modules?.length > 0) {
        try {
          await syncModulesToDB(curriculum.id, result.modules, {
            assertionTags: result.assertionTags,
            assertionIdByIndex,
            // First curriculum generation for this subject — opt into the AI
            // retag pass so orphan assertions (extracted before the curriculum
            // existed) get matched to the newly-written LOs in a single call.
            runAiRetagPass: true,
          });
        } catch (err: any) {
          console.warn("[subjects/:id/curriculum] Module sync failed (non-fatal):", err.message);
        }
      }

      return NextResponse.json({
        ok: true,
        mode: "save",
        curriculum,
      });
    }

    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  } catch (error: any) {
    console.error("[subjects/:id/curriculum] POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api PATCH /api/subjects/:subjectId/curriculum
 * @visibility public
 * @scope subjects:write
 * @auth OPERATOR
 * @tags subjects, curriculum
 * @description Update curriculum (user edits to modules, delivery config, etc.)
 * @body { name?: string, description?: string, modules?: object[], deliveryConfig?: object }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;
    const body = await req.json();

    const curriculum = await prisma.curriculum.findFirst({
      where: { subjectId },
      orderBy: { updatedAt: "desc" },
    });

    if (!curriculum) {
      return NextResponse.json({ error: "No curriculum found for this subject" }, { status: 404 });
    }

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.modules !== undefined) data.notableInfo = { modules: body.modules };
    if (body.deliveryConfig !== undefined) data.deliveryConfig = body.deliveryConfig;

    const updated = await prisma.curriculum.update({
      where: { id: curriculum.id },
      data,
    });

    // Dual-write: sync modules to first-class DB models
    if (body.modules?.length > 0) {
      try {
        await syncModulesToDB(curriculum.id, body.modules);
      } catch (err: any) {
        console.warn("[subjects/:id/curriculum] PATCH module sync failed (non-fatal):", err.message);
      }
    }

    return NextResponse.json({ curriculum: updated });
  } catch (error: any) {
    console.error("[subjects/:id/curriculum] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
