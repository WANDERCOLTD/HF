import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/communities/[communityId]/topics
 * @visibility public
 * @scope communities:read
 * @auth session
 * @tags communities
 * @description List topics (playbooks) for a community
 * @param communityId string - Community domain ID
 * @response 200 { ok: true, topics: Array<{ id, name, pattern, sortOrder }> }
 * @response 404 { ok: false, error: "Community not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { communityId } = await params;

    const community = await prisma.domain.findUnique({
      where: { id: communityId },
      select: { kind: true },
    });

    if (!community || community.kind !== "COMMUNITY") {
      return NextResponse.json({ ok: false, error: "Community not found" }, { status: 404 });
    }

    const playbooks = await prisma.playbook.findMany({
      where: { domainId: communityId, status: { not: "ARCHIVED" } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, config: true, sortOrder: true },
    });

    const topics = playbooks.map((p) => ({
      id: p.id,
      name: p.name,
      pattern: (p.config as Record<string, unknown> | null)?.interactionPattern ?? "companion",
      sortOrder: p.sortOrder,
    }));

    return NextResponse.json({ ok: true, topics });
  } catch (error: any) {
    console.error("Error fetching topics:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch topics" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/communities/[communityId]/topics
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Add a topic (playbook) to a community
 * @param communityId string - Community domain ID
 * @body name string - Topic name (required)
 * @body pattern string - InteractionPattern value
 * @response 200 { ok: true, topic: { id, name, pattern, sortOrder } }
 * @response 400 { ok: false, error: "name is required" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { communityId } = await params;

    const community = await prisma.domain.findUnique({
      where: { id: communityId },
      select: { kind: true },
    });

    if (!community || community.kind !== "COMMUNITY") {
      return NextResponse.json({ ok: false, error: "Community not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { name, pattern = "companion" } = body;

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
    }

    // Get next sort order
    const last = await prisma.playbook.findFirst({
      where: { domainId: communityId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const playbook = await prisma.playbook.create({
      data: {
        name: name.trim(),
        domainId: communityId,
        sortOrder,
        status: "PUBLISHED",
        config: { interactionPattern: pattern },
      },
    });

    return NextResponse.json({
      ok: true,
      topic: {
        id: playbook.id,
        name: playbook.name,
        pattern,
        sortOrder: playbook.sortOrder,
      },
    });
  } catch (error: any) {
    console.error("Error creating topic:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create topic" },
      { status: 500 }
    );
  }
}
