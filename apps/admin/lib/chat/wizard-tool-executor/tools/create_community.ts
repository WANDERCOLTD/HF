import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import type { WizardToolExec } from "../_shared/types";

export async function execute(
  input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // Server-side: create a community hub (domain, identity, cohort group)
  // Reuses the same logic as POST /api/communities but called from wizard context
  try {
    const { prisma } = await import("@/lib/prisma");
    const { scaffoldDomain } = await import("@/lib/domain/scaffold");
    const { loadPersonaFlowPhases, loadPersonaWelcomeTemplate } = await import("@/lib/domain/persona-loaders");
    const { config } = await import("@/lib/config");
    const crypto = await import("crypto");

    const hubName = input.hubName as string;
    const hubDescription = (input.hubDescription as string) || "";
    const communityMode = input.communityMode as "attached" | "standalone";
    const hubPattern = (input.hubPattern as string) || "conversational-guide";
    const communityKind = (input.communityKind as string) || "OPEN_CONNECTION";
    const topics = (input.topics as Array<{ name: string; pattern?: string }>) || [];
    const welcomeMessage = (input.welcomeMessage as string) || null;

    // Resolve institutionId based on mode
    let institutionId: string | null = null;
    if (communityMode === "attached") {
      // Use the institution from setupData or user's active institution
      institutionId = (setupData?.existingInstitutionId as string)
        || (await prisma.user.findUnique({ where: { id: userId }, select: { activeInstitutionId: true } }))?.activeInstitutionId
        || null;
    }

    // Generate slug
    const baseSlug = hubName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
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

    // Resolve archetype from pattern
    const PATTERN_ARCHETYPE: Record<string, string> = {
      companion: config.specs.companionArchetype,
      advisory: config.specs.advisorArchetype,
      coaching: config.specs.coachArchetype,
      socratic: config.specs.defaultArchetype,
      facilitation: config.specs.facilitatorArchetype,
      reflective: config.specs.mentorArchetype,
      open: config.specs.companionArchetype,
      directive: config.specs.defaultArchetype,
      "conversational-guide": config.specs.convguideArchetype,
    };
    const archetype = PATTERN_ARCHETYPE[hubPattern] || config.specs.convguideArchetype;

    // Build domain config
    const domainConfig: Record<string, unknown> = { communityKind };
    if (communityKind === "OPEN_CONNECTION" && hubPattern) {
      domainConfig.hubPattern = hubPattern;
    }

    // Resolve operator's Caller ID
    let operatorCaller = await prisma.caller.findFirst({
      where: { userId },
      select: { id: true },
    });

    const joinToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    const { domain: community, cohortGroupId } = await prisma.$transaction(async (tx: any) => {
      const domain = await tx.domain.create({
        data: {
          name: hubName.trim(),
          slug,
          description: hubDescription.trim() || null,
          kind: "COMMUNITY",
          config: domainConfig,
          institutionId,
        },
      });

      // Create topic playbooks
      if (communityKind === "TOPIC_BASED" && topics.length > 0) {
        for (let i = 0; i < topics.length; i++) {
          const topic = topics[i];
          if (!topic?.name?.trim()) continue;
          await tx.playbook.create({
            data: {
              name: topic.name.trim(),
              domainId: domain.id,
              sortOrder: i + 1,
              status: "PUBLISHED",
              config: { interactionPattern: topic.pattern || hubPattern },
            },
          });
        }
      }

      // Create operator caller if needed
      if (!operatorCaller) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
        operatorCaller = await tx.caller.create({
          data: {
            name: user?.name || "Operator",
            email: user?.email || undefined,
            role: "TEACHER",
            userId,
            domainId: domain.id,
          },
          select: { id: true },
        });
      }

      // Create CohortGroup with join token
      const cohortGroup = await tx.cohortGroup.create({
        data: {
          name: hubName.trim(),
          domainId: domain.id,
          ownerId: operatorCaller!.id,
          joinToken,
          institutionId,
        },
      });

      // Link topic playbooks to CohortGroup
      const topicPlaybooks = await tx.playbook.findMany({
        where: { domainId: domain.id, status: "PUBLISHED" },
        select: { id: true },
      });
      if (topicPlaybooks.length > 0) {
        await tx.cohortPlaybook.createMany({
          data: topicPlaybooks.map((pb: { id: string }) => ({
            cohortGroupId: cohortGroup.id,
            playbookId: pb.id,
          })),
          skipDuplicates: true,
        });
      }

      return { domain, cohortGroupId: cohortGroup.id };
    });

    // Resolve persona-specific flow phases (same as create_course)
    const flowPhases = await loadPersonaFlowPhases(hubPattern);

    // Scaffold domain — creates identity spec, main playbook
    const scaffoldResult = await scaffoldDomain(community.id, {
      playbookName: hubName.trim(),
      extendsAgent: archetype,
      flowPhases: flowPhases || undefined,
      forceNewPlaybook: communityKind === "TOPIC_BASED" && topics.length > 0,
    });

    // Resolve welcome message: explicit → persona template → null
    const resolvedWelcome = welcomeMessage
      || await loadPersonaWelcomeTemplate(hubPattern)
      || null;

    // Persist welcome message to domain
    // #828 — central helper; community hub scaffold writes welcome
    // before any callers join, so timestamp bump is a no-op.
    if (resolvedWelcome) {
      await updateDomainConfig(
        community.id,
        (d) => ({ ...d, onboardingWelcome: resolvedWelcome }),
        { skipTimestamp: true, reason: "wizard community scaffold welcome" },
      );
    }

    // Link scaffold-created playbooks to CohortGroup
    const allPlaybooks = await prisma.playbook.findMany({
      where: { domainId: community.id, status: "PUBLISHED" },
      select: { id: true },
    });
    if (allPlaybooks.length > 0) {
      await prisma.cohortPlaybook.createMany({
        data: allPlaybooks.map((pb: { id: string }) => ({
          cohortGroupId,
          playbookId: pb.id,
        })),
        skipDuplicates: true,
      });
    }

    // Build firstCallPreview — uses scaffold's main playbook ID
    // (community hubs have no media, so content[] is empty on all phases)
    const previewDomain = await prisma.domain.findUnique({
      where: { id: community.id },
      select: { onboardingWelcome: true, onboardingFlowPhases: true },
    });
    const previewPhases = (previewDomain?.onboardingFlowPhases as { phases?: any[] } | null)?.phases || [];
    const mainPlaybookId = scaffoldResult.playbook?.id || allPlaybooks[0]?.id || "";
    const firstCallPreview = {
      domainId: community.id,
      playbookId: mainPlaybookId,
      welcomeMessage: previewDomain?.onboardingWelcome || null,
      phases: previewPhases.map((p: any) => ({
        phase: p.phase,
        duration: p.duration,
        goals: p.goals || [],
        content: [], // No media for community hubs
      })),
    };

    return {
      content: JSON.stringify({
        ok: true,
        domainId: community.id,
        playbookId: mainPlaybookId,
        cohortGroupId,
        joinToken,
        communityMode,
        hubUrl: `/x/communities/${community.id}`,
        firstCallPreview,
      }),
    };
  } catch (err) {
    return {
      content: JSON.stringify({ ok: false, error: String(err) }),
      is_error: true,
    };
  }
}
