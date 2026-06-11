import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";

/**
 * @operator-surface yes
 *
 * @api GET /api/playbooks/:playbookId/subjects
 * @visibility internal
 * @scope playbooks:read
 * @auth session (VIEWER)
 * @tags playbooks, subjects
 * @description Get subjects linked to a playbook via PlaybookSubject.
 *   Falls back to domain-wide subjects if no PlaybookSubject records exist.
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, subjects: [...], scoped: boolean }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { id: true, domainId: true },
    });
    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Playbook not found" }, { status: 404 });
    }

    // Check for PlaybookSubject links first (course-scoped)
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId },
      select: {
        subject: {
          select: {
            id: true,
            name: true,
            slug: true,
            defaultTrustLevel: true,
            _count: { select: { sources: true } },
          },
        },
      },
    });

    if (playbookSubjects.length > 0) {
      // Course-scoped: return linked subjects
      const subjects = playbookSubjects.map((ps) => ({
        id: ps.subject.id,
        name: ps.subject.name,
        slug: ps.subject.slug,
        trustLevel: ps.subject.defaultTrustLevel,
        sourceCount: ps.subject._count.sources,
      }));
      return NextResponse.json({ ok: true, subjects, scoped: true });
    }

    // Fallback: return all domain subjects (backward compat)
    const domainSubjects = await prisma.subjectDomain.findMany({
      where: { domainId: playbook.domainId },
      select: {
        subject: {
          select: {
            id: true,
            name: true,
            slug: true,
            defaultTrustLevel: true,
            _count: { select: { sources: true } },
          },
        },
      },
    });

    const subjects = domainSubjects.map((sd) => ({
      id: sd.subject.id,
      name: sd.subject.name,
      slug: sd.subject.slug,
      trustLevel: sd.subject.defaultTrustLevel,
      sourceCount: sd.subject._count.sources,
    }));

    return NextResponse.json({ ok: true, subjects, scoped: false });
  } catch (error: unknown) {
    console.error("[playbooks/:id/subjects] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load subjects" },
      { status: 500 },
    );
  }
}

/**
 * @api POST /api/playbooks/:playbookId/subjects
 * @visibility internal
 * @scope playbooks:write
 * @auth session (OPERATOR)
 * @tags playbooks, subjects
 * @description Link subjects to a playbook (course-scoped content).
 *   Idempotent — existing links are preserved, new ones added.
 * @pathParam playbookId string - Playbook UUID
 * @bodyParam subjectIds string[] - Subject UUIDs to link
 * @response 200 { ok: true, linked: number }
 * @response 404 { ok: false, error: "Playbook not found" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;
    const body = await req.json();
    const subjectIds: string[] = Array.isArray(body.subjectIds) ? body.subjectIds : [];

    if (subjectIds.length === 0) {
      return NextResponse.json({ ok: false, error: "subjectIds required" }, { status: 400 });
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { id: true },
    });
    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Playbook not found" }, { status: 404 });
    }

    // Upsert each link (idempotent)
    let linked = 0;
    for (const subjectId of subjectIds) {
      try {
        await prisma.playbookSubject.upsert({
          where: { playbookId_subjectId: { playbookId, subjectId } },
          update: {},
          create: { playbookId, subjectId },
        });
        linked++;
      } catch {
        // Subject may not exist — skip silently
      }
    }

    // #1268 staleness gap — Subject is the primary content authority for
    // compose (read by SectionDataLoader as CONTENT AUTHORITY). Linking a
    // new Subject drastically changes section content; bump the playbook's
    // staleness signal so Preview flips. Best-effort.
    if (linked > 0) {
      await bumpPlaybookComposeTimestamp(playbookId);
    }

    return NextResponse.json({ ok: true, linked });
  } catch (error: unknown) {
    console.error("[playbooks/:id/subjects] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to link subjects" },
      { status: 500 },
    );
  }
}
