import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { detectAuthoredModules } from "@/lib/wizard/detect-authored-modules";

/**
 * @api GET /api/courses/:courseId/course-reference
 * @visibility public
 * @scope courses:read
 * @description Returns the best Course Reference markdown for a course.
 *
 *   Resolution strategy (best → fallback):
 *     1. The most recent source whose markdown parses as authored modules
 *        (`detectAuthoredModules.modulesAuthored === true`). Doctype
 *        agnostic — wins regardless of how the classifier labelled it.
 *     2. The most recent source with documentType matching the priority
 *        list COURSE_REFERENCE → CURRICULUM → REFERENCE → LESSON_PLAN
 *        → POLICY_DOCUMENT, with non-empty textSample.
 *     3. null if nothing matches.
 *
 *   Why the broad lookup: AI classifiers misroute course-reference
 *   markdown to CURRICULUM/REFERENCE often enough that a strict
 *   doctype filter created a dead end for educators trying to
 *   re-import authored modules. Doctype is heuristic; module-table
 *   detection is structural.
 *
 *   The response includes `documentType` and `inferredFromContent` so
 *   the caller can warn when the source picked wasn't strictly a
 *   COURSE_REFERENCE.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, reference: { id, name, markdown, documentType, inferredFromContent, createdAt } | null }
 */
const REFERENCE_DOCTYPE_PRIORITY = [
  "COURSE_REFERENCE",
  "CURRICULUM",
  "REFERENCE",
  "LESSON_PLAN",
  "POLICY_DOCUMENT",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("VIEWER");
    if (isAuthError(user)) return user;

    const { courseId } = await params;

    const playbookSources = await prisma.playbookSource.findMany({
      where: { playbookId: courseId },
      select: {
        source: {
          select: {
            id: true,
            name: true,
            documentType: true,
            textSample: true,
            createdAt: true,
          },
        },
      },
    });

    const sources = playbookSources
      .map((ps) => ps.source)
      .filter((s) => typeof s.textSample === "string" && s.textSample.length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ── 1. Module-table detection wins regardless of doctype ──
    // Run the deterministic regex/markdown parser on each candidate's
    // markdown; the first one that parses as authored modules is the
    // strongest signal. Doctype mis-classification can't hide it.
    let chosen: typeof sources[number] | null = null;
    let inferredFromContent = false;
    for (const s of sources) {
      const detected = detectAuthoredModules(s.textSample as string);
      if (detected.modulesAuthored === true && detected.modules.length > 0) {
        chosen = s;
        inferredFromContent = true;
        break;
      }
    }

    // ── 2. Doctype priority fallback (no parseable Module Catalogue) ──
    if (!chosen) {
      for (const dt of REFERENCE_DOCTYPE_PRIORITY) {
        const candidate = sources.find((s) => s.documentType === dt);
        if (candidate) {
          chosen = candidate;
          break;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      reference: chosen
        ? {
            id: chosen.id,
            name: chosen.name,
            markdown: chosen.textSample,
            documentType: chosen.documentType,
            inferredFromContent,
            createdAt: chosen.createdAt,
          }
        : null,
    });
  } catch (err) {
    console.error("[course-reference] Error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load course reference" },
      { status: 500 },
    );
  }
}
