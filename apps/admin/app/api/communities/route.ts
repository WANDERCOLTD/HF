import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/communities
 * @visibility public
 * @scope communities:read
 * @auth session
 * @tags communities
 * @description List all communities (Domains with kind=COMMUNITY)
 * @response 200 { ok: true, communities: Domain[], count: number }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const communities = await prisma.domain.findMany({
      where: {
        kind: "COMMUNITY",
        isActive: true,
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: {
            callers: true,
          },
        },
        onboardingIdentitySpec: {
          select: {
            id: true,
            config: true,
          },
        },
      },
    });

    // Transform to include friendly display fields
    const communityList = communities.map((community) => ({
      ...community,
      memberCount: community._count.callers,
      personaName: (community.onboardingIdentitySpec?.config as any)?.personaName || "Unknown",
      _count: undefined,
      onboardingIdentitySpec: undefined,
    }));

    return NextResponse.json({
      ok: true,
      communities: communityList,
      count: communities.length,
    });
  } catch (error: any) {
    console.error("Error fetching communities:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch communities" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/communities
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Create a new community with optional topics and founding members
 * @body name string - Community name (required)
 * @body description string - Community purpose/description
 * @body communityKind string - TOPIC_BASED or OPEN_CONNECTION
 * @body hubPattern string - InteractionPattern for OPEN_CONNECTION hubs
 * @body topics Array<{ name: string; pattern: string }> - Topics for TOPIC_BASED hubs
 * @body memberCallerIds string[] - Caller IDs to add as founding members
 * @response 200 { ok: true, community: { id, name, slug, memberCount } }
 * @response 400 { ok: false, error: "name is required" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const {
      name,
      description,
      communityKind = "OPEN_CONNECTION",
      hubPattern,
      topics = [],
      memberCallerIds = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { ok: false, error: "name is required" },
        { status: 400 }
      );
    }

    // Generate slug from name
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

    // Ensure uniqueness
    const existing = await prisma.domain.findMany({
      where: { slug: { startsWith: baseSlug } },
      select: { slug: true },
    });
    const slugs = new Set(existing.map((d: { slug: string }) => d.slug));
    let slug = baseSlug;
    let counter = 2;
    while (slugs.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    // Build community config
    const config: Record<string, unknown> = { communityKind };
    if (communityKind === "OPEN_CONNECTION" && hubPattern) {
      config.hubPattern = hubPattern;
    }

    // Create Domain + Topics + Members in one transaction
    const community = await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.create({
        data: {
          name: name.trim(),
          slug,
          description: description?.trim() || null,
          kind: "COMMUNITY",
          config: config as any,
        },
      });

      // Create a playbook per topic (TOPIC_BASED)
      if (communityKind === "TOPIC_BASED" && topics.length > 0) {
        for (let i = 0; i < topics.length; i++) {
          const topic = topics[i];
          if (!topic?.name?.trim()) continue;
          await tx.playbook.create({
            data: {
              name: topic.name.trim(),
              domainId: domain.id,
              sortOrder: i,
              status: "PUBLISHED",
              config: { interactionPattern: topic.pattern || "companion" },
            },
          });
        }
      }

      // Add founding members (connect callers to domain)
      if (memberCallerIds.length > 0) {
        await tx.domain.update({
          where: { id: domain.id },
          data: {
            callers: {
              connect: memberCallerIds.map((id: string) => ({ id })),
            },
          },
        });
      }

      return domain;
    });

    // Count members after transaction
    const memberCount = memberCallerIds.length;

    return NextResponse.json({
      ok: true,
      community: {
        id: community.id,
        name: community.name,
        slug: community.slug,
        memberCount,
      },
    });
  } catch (error: any) {
    console.error("Error creating community:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create community" },
      { status: 500 }
    );
  }
}
