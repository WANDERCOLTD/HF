import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/curricula
 * @visibility internal
 * @scope curricula:read
 * @auth VIEWER
 * @tags curricula
 * @description List curricula, optionally filtered by subjectId.
 * @query subjectId string - Filter to curricula linked to this subject
 * @response 200 { ok, curricula: Curriculum[] }
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get("subjectId");

    const where = subjectId ? { subjectId } : {};
    const curricula = await prisma.curriculum.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        subjectId: true,
        version: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ ok: true, curricula });
  } catch (error: unknown) {
    console.error("[curricula] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to list curricula" },
      { status: 500 },
    );
  }
}

/**
 * @api POST /api/curricula
 * @visibility internal
 * @scope curricula:write
 * @auth OPERATOR
 * @tags curricula
 * @description Create a new curriculum, optionally linked to a subject.
 * @body { name: string, subjectId?: string, domainId?: string }
 * @response 200 { ok, curriculum: { id, slug, name } }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const { name, subjectId, playbookId: explicitPlaybookId } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { ok: false, error: "name is required" },
        { status: 400 },
      );
    }

    // Generate a unique slug from the name
    const baseSlug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // Resolve playbookId — prefer caller-supplied, fall back to most-recent
    // PlaybookSubject link. See #317 follow-up: the prior `findFirst` with no
    // ordering would return the oldest link, attaching new curricula to a
    // sibling playbook that happens to share the subject.
    let playbookId: string | null = null;
    if (typeof explicitPlaybookId === "string" && explicitPlaybookId.length > 0) {
      playbookId = explicitPlaybookId;
    } else if (subjectId) {
      const links = await prisma.playbookSubject.findMany({
        where: { subjectId },
        select: { playbookId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      playbookId = links[0]?.playbookId ?? null;
      if (links.length > 1) {
        console.warn(
          `[curricula POST] subject ${subjectId} is linked to ${links.length} playbooks — ` +
            `picked most recent ${playbookId}. Caller should pass explicit playbookId.`,
        );
      }
    }

    const curriculum = await prisma.curriculum.create({
      data: {
        slug,
        name: name.trim(),
        subjectId: subjectId || null,
        playbookId,
      },
      select: { id: true, slug: true, name: true, subjectId: true, playbookId: true },
    });

    return NextResponse.json({ ok: true, curriculum });
  } catch (error: unknown) {
    console.error("[curricula] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create curriculum" },
      { status: 500 },
    );
  }
}
