import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { scaffoldDomain } from "@/lib/domain/scaffold";
import type { InteractionPattern } from "@/lib/content-trust/resolve-config";

// ── Pattern → Archetype mapping ──────────────────────
const PATTERN_ARCHETYPE_MAP: Record<InteractionPattern, string> = {
  companion: "COMPANION-001",
  advisory: "ADVISOR-001",
  coaching: "COACH-001",
  socratic: "TUT-001",
  facilitation: "FACILITATOR-001",
  reflective: "MENTOR-001",
  open: "COMPANION-001",
  directive: "TUT-001",
};

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
 * @description Create a new community hub with full scaffolding.
 *   Creates Domain (kind=COMMUNITY), scaffolds identity spec + playbook + onboarding,
 *   links founding members, and optionally creates topic playbooks.
 *   Archetype is resolved from the interaction pattern (e.g., companion → COMPANION-001).
 * @body name string - Community name (required)
 * @body description string - Community purpose/description
 * @body communityKind string - TOPIC_BASED or OPEN_CONNECTION
 * @body hubPattern string - InteractionPattern for OPEN_CONNECTION hubs
 * @body topics Array<{ name: string; pattern: string }> - Topics for TOPIC_BASED hubs
 * @body memberCallerIds string[] - Caller IDs to add as founding members
 * @body institutionId string - Parent institution ID (optional)
 * @response 200 { ok: true, community: { id, name, slug, memberCount, joinToken, cohortGroupId } }
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
      institutionId,
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
    const domainConfig: Record<string, unknown> = { communityKind };
    if (communityKind === "OPEN_CONNECTION" && hubPattern) {
      domainConfig.hubPattern = hubPattern;
    }

    // Resolve archetype from interaction pattern
    const primaryPattern: InteractionPattern =
      communityKind === "OPEN_CONNECTION"
        ? (hubPattern || "companion")
        : (topics[0]?.pattern || "companion");
    const archetype = PATTERN_ARCHETYPE_MAP[primaryPattern] || "COMPANION-001";

    // Resolve operator's Caller ID for CohortGroup ownership
    const userId = authResult.session.user?.id;
    let operatorCaller = userId
      ? await prisma.caller.findFirst({ where: { userId }, select: { id: true } })
      : null;

    // 1. Create Domain (kind=COMMUNITY) in transaction with topic playbooks + CohortGroup + members
    const joinToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    const { domain: community, cohortGroupId } = await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.create({
        data: {
          name: name.trim(),
          slug,
          description: description?.trim() || null,
          kind: "COMMUNITY",
          config: domainConfig as any,
          institutionId: institutionId || null,
        },
      });

      // Create topic playbooks (TOPIC_BASED) — these are additional to the scaffold playbook
      if (communityKind === "TOPIC_BASED" && topics.length > 0) {
        for (let i = 0; i < topics.length; i++) {
          const topic = topics[i];
          if (!topic?.name?.trim()) continue;
          await tx.playbook.create({
            data: {
              name: topic.name.trim(),
              domainId: domain.id,
              sortOrder: i + 1, // +1 to leave room for scaffold's main playbook
              status: "PUBLISHED",
              config: { interactionPattern: topic.pattern || "companion" },
            },
          });
        }
      }

      // Create a minimal Caller for the operator if they don't have one (needed for CohortGroup.ownerId)
      if (!operatorCaller && userId) {
        operatorCaller = await tx.caller.create({
          data: {
            name: authResult.session.user?.name || "Operator",
            email: authResult.session.user?.email || undefined,
            role: "ADMIN",
            userId,
            domainId: domain.id,
          },
          select: { id: true },
        });
      }

      // Create CohortGroup with join token (reuses classroom join infrastructure)
      const cohortGroup = await tx.cohortGroup.create({
        data: {
          name: name.trim(),
          domainId: domain.id,
          ownerId: operatorCaller!.id,
          joinToken,
          institutionId: institutionId || null,
        },
      });

      // Link topic playbooks to CohortGroup so join flow auto-enrolls
      const topicPlaybooks = await tx.playbook.findMany({
        where: { domainId: domain.id, status: "PUBLISHED" },
        select: { id: true },
      });
      if (topicPlaybooks.length > 0) {
        await tx.cohortPlaybook.createMany({
          data: topicPlaybooks.map((pb) => ({
            cohortGroupId: cohortGroup.id,
            playbookId: pb.id,
          })),
          skipDuplicates: true,
        });
      }

      // Add founding members (connect callers to domain + CohortGroup membership)
      if (memberCallerIds.length > 0) {
        await tx.domain.update({
          where: { id: domain.id },
          data: {
            callers: {
              connect: memberCallerIds.map((id: string) => ({ id })),
            },
          },
        });
        await tx.callerCohortMembership.createMany({
          data: memberCallerIds.map((id: string) => ({
            callerId: id,
            cohortGroupId: cohortGroup.id,
          })),
          skipDuplicates: true,
        });
      }

      return { domain, cohortGroupId: cohortGroup.id };
    });

    // 2. Scaffold domain — creates identity spec, main playbook, onboarding config
    //    Archetype is resolved from the interaction pattern selected in the wizard.
    //    forceNewPlaybook=true so topic playbooks (TOPIC_BASED) don't get archived.
    await scaffoldDomain(community.id, {
      playbookName: name.trim(),
      extendsAgent: archetype,
      forceNewPlaybook: communityKind === "TOPIC_BASED" && topics.length > 0,
    });

    // 3. Link scaffold-created playbooks to CohortGroup (scaffold runs outside transaction)
    const allPlaybooks = await prisma.playbook.findMany({
      where: { domainId: community.id, status: "PUBLISHED" },
      select: { id: true },
    });
    if (allPlaybooks.length > 0) {
      await prisma.cohortPlaybook.createMany({
        data: allPlaybooks.map((pb) => ({
          cohortGroupId,
          playbookId: pb.id,
        })),
        skipDuplicates: true,
      });
    }

    const memberCount = memberCallerIds.length;

    return NextResponse.json({
      ok: true,
      community: {
        id: community.id,
        name: community.name,
        slug: community.slug,
        memberCount,
        joinToken,
        cohortGroupId,
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
