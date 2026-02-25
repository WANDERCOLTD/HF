import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/communities/[communityId]
 * @visibility public
 * @scope communities:read
 * @auth session
 * @tags communities
 * @description Get a single community detail with identity specs, onboarding config, and members
 * @param communityId string - Community domain ID
 * @response 200 { ok: true, community: { id, name, slug, description, onboardingWelcome, onboardingIdentitySpecId, onboardingFlowPhases, onboardingDefaultTargets, memberCount, playbookCount, personaName, identitySpec, identitySpecs, members } }
 * @response 404 { ok: false, error: "Community not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { communityId } = await params;

    const community = await prisma.domain.findUnique({
      where: { id: communityId },
      include: {
        _count: {
          select: {
            callers: true,
            playbooks: true,
          },
        },
        onboardingIdentitySpec: {
          select: {
            id: true,
            slug: true,
            name: true,
            config: true,
          },
        },
        callers: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
      },
    });

    if (!community || community.kind !== "COMMUNITY") {
      return NextResponse.json(
        { ok: false, error: "Community not found" },
        { status: 404 }
      );
    }

    // Fetch available IDENTITY specs for the spec picker
    const identitySpecs = await prisma.analysisSpec.findMany({
      where: { specRole: "IDENTITY", isActive: true },
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    });

    const specConfig = community.onboardingIdentitySpec?.config as Record<string, any> | null;

    return NextResponse.json({
      ok: true,
      community: {
        id: community.id,
        name: community.name,
        slug: community.slug,
        description: community.description,
        config: community.config,
        onboardingWelcome: community.onboardingWelcome,
        onboardingIdentitySpecId: community.onboardingIdentitySpecId,
        onboardingFlowPhases: community.onboardingFlowPhases,
        onboardingDefaultTargets: community.onboardingDefaultTargets,
        memberCount: community._count.callers,
        playbookCount: community._count.playbooks,
        personaName: specConfig?.personaName || community.onboardingIdentitySpec?.name || "Unknown",
        identitySpec: community.onboardingIdentitySpec
          ? {
              id: community.onboardingIdentitySpec.id,
              slug: community.onboardingIdentitySpec.slug,
              name: community.onboardingIdentitySpec.name,
            }
          : null,
        identitySpecs,
        members: community.callers,
      },
    });
  } catch (error: any) {
    console.error("Error fetching community:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch community" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/communities/[communityId]
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Update a community — name, description, welcome message, identity spec, flow phases, default targets
 * @param communityId string - Community domain ID
 * @body name string - Community name
 * @body description string - Community description
 * @body onboardingWelcome string - Welcome message for first call
 * @body onboardingIdentitySpecId string - Identity spec ID for the AI persona
 * @body onboardingFlowPhases object - Flow phases configuration
 * @body onboardingDefaultTargets object - Default behavior targets (includes _matrixPositions for round-trip)
 * @response 200 { ok: true, community: Domain }
 * @response 404 { ok: false, error: "Community not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { communityId } = await params;

    // Verify it's a community
    const existing = await prisma.domain.findUnique({
      where: { id: communityId },
      select: { kind: true },
    });

    if (!existing || existing.kind !== "COMMUNITY") {
      return NextResponse.json(
        { ok: false, error: "Community not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      description,
      config,
      onboardingWelcome,
      onboardingIdentitySpecId,
      onboardingFlowPhases,
      onboardingDefaultTargets,
    } = body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (config !== undefined) updateData.config = config;
    if (onboardingWelcome !== undefined) updateData.onboardingWelcome = onboardingWelcome;
    if (onboardingIdentitySpecId !== undefined) updateData.onboardingIdentitySpecId = onboardingIdentitySpecId;
    if (onboardingFlowPhases !== undefined) updateData.onboardingFlowPhases = onboardingFlowPhases;
    if (onboardingDefaultTargets !== undefined) updateData.onboardingDefaultTargets = onboardingDefaultTargets;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    const community = await prisma.domain.update({
      where: { id: communityId },
      data: updateData,
      include: {
        _count: {
          select: {
            callers: true,
          },
        },
        onboardingIdentitySpec: {
          select: {
            id: true,
            slug: true,
            name: true,
            config: true,
          },
        },
      },
    });

    const specConfig = community.onboardingIdentitySpec?.config as Record<string, any> | null;

    return NextResponse.json({
      ok: true,
      community: {
        id: community.id,
        name: community.name,
        slug: community.slug,
        description: community.description,
        onboardingWelcome: community.onboardingWelcome,
        onboardingIdentitySpecId: community.onboardingIdentitySpecId,
        onboardingFlowPhases: community.onboardingFlowPhases,
        onboardingDefaultTargets: community.onboardingDefaultTargets,
        memberCount: community._count.callers,
        personaName: specConfig?.personaName || community.onboardingIdentitySpec?.name || "Unknown",
        identitySpec: community.onboardingIdentitySpec
          ? {
              id: community.onboardingIdentitySpec.id,
              slug: community.onboardingIdentitySpec.slug,
              name: community.onboardingIdentitySpec.name,
            }
          : null,
      },
    });
  } catch (error: any) {
    console.error("Error updating community:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update community" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/communities/[communityId]
 * @visibility public
 * @scope communities:write
 * @auth session
 * @tags communities
 * @description Archive a community (soft delete)
 * @param communityId string - Community domain ID
 * @response 200 { ok: true, message: "Community archived" }
 * @response 404 { ok: false, error: "Community not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { communityId } = await params;

    // Verify it's a community
    const existing = await prisma.domain.findUnique({
      where: { id: communityId },
      select: { kind: true },
    });

    if (!existing || existing.kind !== "COMMUNITY") {
      return NextResponse.json(
        { ok: false, error: "Community not found" },
        { status: 404 }
      );
    }

    // Soft delete by setting isActive to false
    await prisma.domain.update({
      where: { id: communityId },
      data: { isActive: false },
    });

    return NextResponse.json({
      ok: true,
      message: "Community archived",
    });
  } catch (error: any) {
    console.error("Error deleting community:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete community" },
      { status: 500 }
    );
  }
}
