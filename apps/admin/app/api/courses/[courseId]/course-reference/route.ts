import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import slugify from "slugify";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";

/**
 * @api GET /api/courses/:courseId/course-reference
 * @visibility public
 * @scope courses:read
 * @description Returns the most recent COURSE_REFERENCE markdown document
 *   for a course. Used by the Reference tab on the course detail page.
 *   Returns the full textSample (rendered markdown) and creation metadata.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, reference: { id, name, markdown, createdAt } | null }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("VIEWER");
    if (isAuthError(user)) return user.error;

    const { courseId } = await params;

    // Find all COURSE_REFERENCE sources linked to this course via PlaybookSource
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

    // Collect COURSE_REFERENCE sources, pick most recent
    const refSources = playbookSources
      .filter((ps) => ps.source.documentType === "COURSE_REFERENCE")
      .map((ps) => ps.source)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const latest = refSources[0] ?? null;

    return NextResponse.json({
      ok: true,
      reference: latest
        ? {
            id: latest.id,
            name: latest.name,
            markdown: latest.textSample,
            createdAt: latest.createdAt,
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

// ── POST upload schema ───────────────────────────────────────────────

const PostBodySchema = z.object({
  markdown: z.string().min(1, "markdown is required"),
  name: z.string().min(1).optional(),
});

/**
 * @api POST /api/courses/:courseId/course-reference
 * @visibility internal
 * @scope courses:write
 * @auth OPERATOR
 * @tags courses, content-trust
 * @description Upload a course-reference markdown document for a course. Creates
 *   a `ContentSource` with `documentType: "COURSE_REFERENCE"`, links it to the
 *   playbook via `PlaybookSource`, and bumps `Playbook.composeInputsUpdatedAt`
 *   so the Preview lens (#1268) sees the staleness signal. Assertion extraction
 *   is left to the existing re-extract flow — this route only persists the raw
 *   markdown and signals staleness.
 *
 *   Idempotent on the same content hash: re-uploading the same markdown reuses
 *   the existing source and only re-links if necessary.
 *
 * @pathParam courseId string - Playbook UUID
 * @bodyParam markdown string - Course-reference markdown body
 * @bodyParam name string (optional) - Display name (defaults to "Course Reference — <playbook.name>")
 * @response 200 { ok, contentSourceId, name, isNew }
 * @response 400 { ok: false, error, issues? }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    let body: z.infer<typeof PostBodySchema>;
    try {
      const raw = await req.json();
      const parsed = PostBodySchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { ok: false, error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const contentHash = createHash("sha256")
      .update(body.markdown)
      .digest("hex");
    const displayName = body.name ?? `Course Reference — ${playbook.name}`;

    // Idempotent: reuse an existing COURSE_REFERENCE source with the same hash.
    const existing = await prisma.contentSource.findFirst({
      where: {
        contentHash,
        documentType: "COURSE_REFERENCE",
      },
      select: { id: true },
    });

    let contentSourceId: string;
    let isNew = false;

    if (existing) {
      contentSourceId = existing.id;
    } else {
      const sourceSlug = `${slugify(playbook.name, { lower: true, strict: true })}-ref-${Date.now()}`;
      const created = await prisma.contentSource.create({
        data: {
          slug: sourceSlug,
          name: displayName,
          documentType: "COURSE_REFERENCE",
          trustLevel: "EXPERT_CURATED",
          textSample: body.markdown,
          contentHash,
          isActive: true,
        },
        select: { id: true },
      });
      contentSourceId = created.id;
      isNew = true;
    }

    // Idempotent link to playbook.
    await prisma.playbookSource.upsert({
      where: {
        playbookId_sourceId: { playbookId: courseId, sourceId: contentSourceId },
      },
      update: {},
      create: {
        playbookId: courseId,
        sourceId: contentSourceId,
        tags: ["course-reference", "upload-route"],
      },
    });

    // #1268 staleness gap — a fresh course-reference changes what AI teaches
    // (assertions, instructions, session_overrides) once re-extract runs.
    // Bump the playbook's staleness signal so Preview flips immediately,
    // even before extract completes — composers will read the freshest
    // assertions on the next call. Best-effort.
    await bumpPlaybookComposeTimestamp(courseId);

    return NextResponse.json({
      ok: true,
      contentSourceId,
      name: displayName,
      isNew,
    });
  } catch (err) {
    console.error("[course-reference] POST error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
