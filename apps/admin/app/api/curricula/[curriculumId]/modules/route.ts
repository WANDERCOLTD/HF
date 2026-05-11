/**
 * @api GET /api/curricula/:curriculumId/modules
 * @scope curricula:read
 * @auth session (VIEWER+)
 * @desc List all modules for a curriculum, with learning objectives. Use ?audience=learner to filter to learner-visible LOs and project performanceStatement into description; default is the full author view (every LO + classifier columns).
 * @query audience "learner" | "author" (default: "author")
 *
 * @api POST /api/curricula/:curriculumId/modules
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @desc Bulk upsert modules (array). Used by curriculum generation and saveCurriculum.
 *
 * @api PUT /api/curricula/:curriculumId/modules
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @desc Bulk reorder modules ({ items: [{ id, sortOrder }] })
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseLoLine } from "@/lib/content-trust/validate-lo-linkage";
import { reconcileAssertionLOs } from "@/lib/content-trust/reconcile-lo-linkage";
import {
  AUDIENCE_AWARE_LO_SELECT,
  filterLOsForAudience,
  parseAudience,
  projectLoForAudience,
} from "@/lib/curriculum/lo-audience";

type Params = { params: Promise<{ curriculumId: string }> };

// ---------------------------------------------------------------------------
// GET — list modules with LOs
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId } = await params;
    const audience = parseAudience(req.nextUrl.searchParams.get("audience"));

    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId, isActive: true },
      include: {
        learningObjectives: {
          orderBy: { sortOrder: "asc" },
          select: AUDIENCE_AWARE_LO_SELECT,
        },
        _count: { select: { callerProgress: true, calls: true } },
      },
      orderBy: { sortOrder: "asc" },
    });

    // #317 — shape per audience: learner sees only learnerVisible LOs
    // with performanceStatement projected into description; author sees
    // every LO with all classifier columns intact.
    const shaped = modules.map((m) => ({
      ...m,
      learningObjectives: filterLOsForAudience(m.learningObjectives, audience).map((lo) =>
        projectLoForAudience(lo, audience),
      ),
    }));

    return NextResponse.json({ ok: true, audience, modules: shaped });
  } catch (error: any) {
    console.error("[curricula/:id/modules] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — bulk upsert modules (with LOs)
// ---------------------------------------------------------------------------

interface ModuleInput {
  slug: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
  estimatedDurationMinutes?: number | null;
  masteryThreshold?: number | null;
  prerequisites?: string[];
  keyTerms?: string[];
  assessmentCriteria?: string[];
  learningOutcomes?: string[]; // Raw text — parsed into LearningObjective records
}

// Note: LO ref parsing used to live here as a local parseLORef() that
// synthesised garbage `LO-${index+1}` / `description === ref` pairs when the
// AI returned bare "LO1" strings. That was the root cause of the 95% orphan
// rate on PW: Secret Garden (incident #137). It now uses the shared
// parseLoLine guard from validate-lo-linkage.ts — same guard as syncModulesToDB.
// Malformed lines are skipped and logged, not fabricated.

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId } = await params;
    const body = await req.json();
    const inputModules: ModuleInput[] = body.modules;

    if (!Array.isArray(inputModules) || inputModules.length === 0) {
      return NextResponse.json({ error: "modules array is required" }, { status: 400 });
    }

    // Verify curriculum exists
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: { id: true },
    });
    if (!curriculum) {
      return NextResponse.json({ error: "Curriculum not found" }, { status: 404 });
    }

    // Bulk upsert within a transaction
    const result = await prisma.$transaction(async (tx) => {
      const created: any[] = [];

      for (let i = 0; i < inputModules.length; i++) {
        const mod = inputModules[i];
        const slug = mod.slug || `MOD-${i + 1}`;

        const upserted = await tx.curriculumModule.upsert({
          where: { curriculumId_slug: { curriculumId, slug } },
          create: {
            curriculumId,
            slug,
            title: mod.title || slug,
            description: mod.description || null,
            sortOrder: mod.sortOrder ?? i,
            estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
            masteryThreshold: mod.masteryThreshold || null,
            prerequisites: mod.prerequisites || [],
            keyTerms: mod.keyTerms || [],
            assessmentCriteria: mod.assessmentCriteria || [],
          },
          update: {
            title: mod.title || slug,
            description: mod.description || null,
            sortOrder: mod.sortOrder ?? i,
            estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
            masteryThreshold: mod.masteryThreshold || null,
            prerequisites: mod.prerequisites || [],
            keyTerms: mod.keyTerms || [],
            assessmentCriteria: mod.assessmentCriteria || [],
          },
        });

        // Sync learning objectives if provided.
        // Epic #131 — use parseLoLine guard (same as syncModulesToDB). Malformed
        // lines are skipped + logged rather than fabricated as garbage.
        if (mod.learningOutcomes && mod.learningOutcomes.length > 0) {
          const parsed: { ref: string; description: string; sortOrder: number }[] = [];
          const skipped: { raw: string; reason: string }[] = [];
          const seenRefs = new Set<string>();

          for (let j = 0; j < mod.learningOutcomes.length; j++) {
            const raw = mod.learningOutcomes[j];
            const line = parseLoLine(raw);
            if (!line) {
              skipped.push({ raw, reason: "not a valid `LOn: description` pair" });
              continue;
            }
            if (seenRefs.has(line.ref)) {
              skipped.push({ raw, reason: `duplicate ref within module: ${line.ref}` });
              continue;
            }
            seenRefs.add(line.ref);
            parsed.push({ ref: line.ref, description: line.description, sortOrder: j });
          }

          if (skipped.length > 0) {
            console.warn(
              `[curricula/modules/POST] Module ${upserted.slug}: skipped ${skipped.length}/${mod.learningOutcomes.length} LOs — ` +
                skipped.map((s) => `"${s.raw}" (${s.reason})`).join("; "),
            );
          }

          // #317 — upsert-by-ref instead of deleteMany+create. Preserves
          // classifier-owned columns (originalText, learnerVisible,
          // performanceStatement, systemRole, humanOverriddenAt) and per-LO
          // mastery overrides across re-imports. Refs absent from the new
          // payload are still removed.
          const incomingRefs = new Set(parsed.map((lo) => lo.ref));
          const existingRows = await tx.learningObjective.findMany({
            where: { moduleId: upserted.id },
            select: { id: true, ref: true },
          });
          const removedIds = existingRows
            .filter((row) => !incomingRefs.has(row.ref))
            .map((row) => row.id);
          if (removedIds.length > 0) {
            await tx.learningObjective.deleteMany({ where: { id: { in: removedIds } } });
          }

          for (const lo of parsed) {
            await tx.learningObjective.upsert({
              where: { moduleId_ref: { moduleId: upserted.id, ref: lo.ref } },
              create: {
                moduleId: upserted.id,
                ref: lo.ref,
                description: lo.description,
                originalText: lo.description, // capture verbatim once
                sortOrder: lo.sortOrder,
              },
              update: {
                description: lo.description,
                sortOrder: lo.sortOrder,
                // Classifier-owned columns intentionally not touched.
              },
            });
          }
        }

        created.push(upserted);
      }

      return created;
    });

    // Epic #131 A4 — after LOs are written, reconcile existing assertions'
    // learningObjectiveId FK. Idempotent. Best-effort: failure here doesn't
    // block the module save because the curriculum write itself succeeded.
    try {
      await reconcileAssertionLOs(curriculumId);
    } catch (err) {
      console.error(`[curricula/modules/POST] reconcileAssertionLOs failed for curriculum ${curriculumId}:`, err);
    }

    // Re-fetch with includes for response
    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId, isActive: true },
      include: { learningObjectives: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ ok: true, modules, count: result.length }, { status: 201 });
  } catch (error: any) {
    console.error("[curricula/:id/modules] POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT — bulk reorder
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { curriculumId } = await params;
    const body = await req.json();
    const items: { id: string; sortOrder: number }[] = body.items;

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items array is required" }, { status: 400 });
    }

    await prisma.$transaction(
      items.map((item) =>
        prisma.curriculumModule.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[curricula/:id/modules] PUT error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
