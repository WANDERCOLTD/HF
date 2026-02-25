import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api PATCH /api/communities/[communityId]/topics/[topicId]
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Update a community topic (name or pattern)
 * @param communityId string - Community domain ID
 * @param topicId string - Topic (Playbook) ID
 * @body name string - New topic name
 * @body pattern string - New InteractionPattern value
 * @response 200 { ok: true, topic: { id, name, pattern, sortOrder } }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; topicId: string }> }
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { communityId, topicId } = await params;

    const existing = await prisma.playbook.findFirst({
      where: { id: topicId, domainId: communityId },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "Topic not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { name, pattern } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (pattern !== undefined) {
      updateData.config = { ...(existing.config as object ?? {}), interactionPattern: pattern };
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.playbook.update({
      where: { id: topicId },
      data: updateData,
    });

    return NextResponse.json({
      ok: true,
      topic: {
        id: updated.id,
        name: updated.name,
        pattern: (updated.config as Record<string, unknown> | null)?.interactionPattern ?? "companion",
        sortOrder: updated.sortOrder,
      },
    });
  } catch (error: any) {
    console.error("Error updating topic:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update topic" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/communities/[communityId]/topics/[topicId]
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Remove a topic from a community (archive the playbook)
 * @param communityId string - Community domain ID
 * @param topicId string - Topic (Playbook) ID
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Topic not found" }
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string; topicId: string }> }
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { communityId, topicId } = await params;

    const existing = await prisma.playbook.findFirst({
      where: { id: topicId, domainId: communityId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "Topic not found" }, { status: 404 });
    }

    await prisma.playbook.update({
      where: { id: topicId },
      data: { status: "ARCHIVED" },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Error deleting topic:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete topic" },
      { status: 500 }
    );
  }
}
