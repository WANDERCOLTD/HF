import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { startCurriculumGeneration } from "@/lib/jobs/curriculum-runner";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";

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

      const curriculum = await prisma.curriculum.upsert({
        where: { slug },
        create: {
          slug,
          name: result.name,
          description: result.description,
          subjectId,
          primarySourceId,
          trustLevel: subject.defaultTrustLevel,
          qualificationBody: subject.qualificationBody,
          qualificationNumber: subject.qualificationRef,
          qualificationLevel: subject.qualificationLevel,
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

      // Dual-write: sync modules to first-class DB models. Pass assertion
      // tags + index map so the tag write happens in the same transaction
      // as the LO upsert, just before reconcile binds FKs.
      if (result.modules?.length > 0) {
        try {
          await syncModulesToDB(curriculum.id, result.modules, {
            assertionTags: result.assertionTags,
            assertionIdByIndex,
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
