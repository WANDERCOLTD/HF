import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import slugify from "slugify";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";

/**
 * @operator-surface yes
 *
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
 *   playbook via `PlaybookSource`, links to the playbook's primary subject via
 *   `SubjectSource` (so subjectSourceId-scoped extraction can run — #2132 closes
 *   the I1 invariant gap), bumps `Playbook.composeInputsUpdatedAt` so the
 *   Preview lens (#1268) sees the staleness signal, and fire-and-forgets a
 *   background extraction job so the Content tab populates without an operator
 *   click. Auto-trigger respects the extract route's cache gate — re-uploads
 *   of identical content skip with `skipped: true` (no LLM cost). Manual
 *   "Re-extract" still works as before (passes `replace: true`).
 *
 *   Idempotent on the same content hash: re-uploading the same markdown reuses
 *   the existing source and only re-links if necessary.
 *
 * @pathParam courseId string - Playbook UUID
 * @bodyParam markdown string - Course-reference markdown body
 * @bodyParam name string (optional) - Display name (defaults to "Course Reference — <playbook.name>")
 * @response 200 { ok, contentSourceId, name, isNew, extraction: { jobId, skipped, reason } | null }
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

    // #2132 — link the ContentSource to the playbook's primary subject so the
    // background extraction can pass subjectSourceId on every ContentAssertion
    // write (closes ENTITIES.md §6 I1 — without this, assertions would land
    // with subjectSourceId=null and leak cross-course through SectionDataLoader's
    // strict-FK filter). Best-effort: if the playbook has no subject linked yet,
    // skip the SubjectSource creation; extraction can still run but won't be
    // subject-scoped until a subject is attached.
    const playbookSubject = await prisma.playbookSubject.findFirst({
      where: { playbookId: courseId },
      select: { subjectId: true },
    });
    let subjectSourceId: string | undefined;
    if (playbookSubject) {
      const subjectSource = await prisma.subjectSource.upsert({
        where: {
          subjectId_sourceId: {
            subjectId: playbookSubject.subjectId,
            sourceId: contentSourceId,
          },
        },
        update: {},
        create: {
          subjectId: playbookSubject.subjectId,
          sourceId: contentSourceId,
          tags: ["course-reference", "upload-route"],
        },
        select: { id: true },
      });
      subjectSourceId = subjectSource.id;
    }

    // #1268 staleness gap — a fresh course-reference changes what AI teaches
    // (assertions, instructions, session_overrides) once re-extract runs.
    // Bump the playbook's staleness signal so Preview flips immediately,
    // even before extract completes — composers will read the freshest
    // assertions on the next call. Best-effort.
    await bumpPlaybookComposeTimestamp(courseId);

    // #2132 — auto-trigger background extraction so the Content tab populates
    // without an operator click. Internal HTTP call to the extract route
    // (rather than calling runBackgroundExtraction directly) preserves the
    // cache gate, the 409 concurrent-extraction guard, the cap enforcement,
    // and the LO-link reconciliation — all in one tested place. Auto-trigger
    // does NOT pass replace=true; the cache gate skips already-extracted
    // sources with zero LLM cost. See `flow-wizard-upload.md` for the chain.
    let extraction:
      | { jobId: string | null; skipped: boolean; reason?: string }
      | null = null;
    try {
      const baseUrl = req.nextUrl.origin;
      const cookie = req.headers.get("cookie") || "";
      const extractRes = await fetch(
        `${baseUrl}/api/content-sources/${contentSourceId}/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify(
            playbookSubject ? { subjectId: playbookSubject.subjectId } : {},
          ),
        },
      );
      const extractData = await extractRes.json().catch(() => null);
      if (extractData?.ok) {
        extraction = {
          jobId: extractData.jobId ?? null,
          skipped: extractData.skipped === true,
          reason: extractData.skipped ? (extractData.reason as string) : undefined,
        };
      } else if (extractData?.error) {
        console.warn(
          `[course-reference] extract trigger returned error for ${contentSourceId}:`,
          extractData.error,
        );
      }
    } catch (extractErr) {
      // Non-fatal: upload succeeded, extraction can be retried via the Re-extract
      // button. Surface in logs only — the response still carries 200 because
      // the source is saved + the staleness bump fired.
      console.warn(
        `[course-reference] extract trigger failed for ${contentSourceId}:`,
        extractErr,
      );
    }

    return NextResponse.json({
      ok: true,
      contentSourceId,
      name: displayName,
      isNew,
      subjectSourceId: subjectSourceId ?? null,
      extraction,
    });
  } catch (err) {
    console.error("[course-reference] POST error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
