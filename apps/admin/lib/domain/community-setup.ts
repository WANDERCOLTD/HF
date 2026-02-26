/**
 * Community Setup Executor
 *
 * Spec-driven orchestrator for the Community Setup Wizard (COMMUNITY-SETUP-001).
 * Creates a Domain (kind=COMMUNITY), CohortGroup, and scaffolds identity spec
 * with a facilitator archetype. No curriculum generation — communities are
 * conversation-driven, not content-driven.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { scaffoldDomain } from "@/lib/domain/scaffold";
import { updateTaskProgress, completeTask } from "@/lib/ai/task-guidance";
import type { ProgressEvent, ProgressCallback } from "./types";
export type { ProgressEvent, ProgressCallback };

// ── Types ──────────────────────────────────────────────

export interface CommunitySetupInput {
  communityName: string;
  theme: string;
  goals: string[];
  guidelines: string;
  welcomeMessage: string;
  memberEmails: string[];
  domainId?: string; // if attaching to existing hub
  institutionId?: string; // parent institution
  groupId?: string; // optional department/division/track grouping
}

export interface CommunitySetupResult {
  domainId: string;
  domainName: string;
  domainSlug: string;
  cohortId: string;
  cohortName: string;
  playbookId: string;
  invitationCount: number;
  warnings: string[];
}

interface CommunitySetupContext {
  input: CommunitySetupInput;
  userId: string;
  results: Partial<CommunitySetupResult> & { [key: string]: any };
  onProgress: ProgressCallback;
}

interface CommunitySetupStep {
  id: string;
  name: string;
  operation: string;
  order: number;
  onError: "abort" | "continue";
  progressMessage: string;
}


// ── Spec Loader ────────────────────────────────────────

async function loadCommunitySetupSteps(): Promise<CommunitySetupStep[]> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: config.specs.communitySetup.toLowerCase(), mode: "insensitive" },
      isActive: true,
    },
    select: { slug: true, config: true },
  });

  if (!spec) {
    throw new Error(
      'COMMUNITY-SETUP-001 spec not found. Run "Import All" on /x/admin/spec-sync to import it.'
    );
  }

  const specConfig = spec.config as Record<string, any>;
  const params = specConfig?.parameters || [];
  const stepsParam = params.find((p: any) => p.id === "wizard_steps");
  const steps = stepsParam?.config?.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(
      `COMMUNITY-SETUP-001 spec has no steps configured. Check config.parameters[id=wizard_steps].config.steps array.`
    );
  }

  return (steps as any[])
    .map((step: any) => ({
      id: step.id,
      name: step.label,
      operation: mapStepToOperation(step.id),
      order: step.order,
      onError: "continue" as const,
      progressMessage: step.activeLabel,
    }))
    .sort((a, b) => a.order - b.order);
}

function mapStepToOperation(stepId: string): string {
  // Member invitation runs inside create_community (after scaffold)
  // rather than as a separate mapped step, because it depends on domainId.
  const mapping: Record<string, string> = {
    "community-purpose": "noop",
    guidelines: "noop",
    members: "noop",
    "configure-ai": "noop",
    done: "create_community",
  };
  return mapping[stepId] || "noop";
}

// ── Step Executor Registry ─────────────────────────────

const stepExecutors: Record<
  string,
  (ctx: CommunitySetupContext, step: CommunitySetupStep) => Promise<void>
> = {
  noop: async () => {
    // No-op for UI-only steps
  },

  create_community: async (ctx) => {
    const slug = ctx.input.communityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // 1. Create or find Domain (kind=COMMUNITY)
    let domain;
    if (ctx.input.domainId) {
      domain = await prisma.domain.findUnique({ where: { id: ctx.input.domainId } });
      if (!domain) throw new Error(`Domain not found: ${ctx.input.domainId}`);
    } else {
      domain = await prisma.domain.findFirst({ where: { slug } });
      if (!domain) {
        domain = await prisma.domain.create({
          data: {
            slug,
            name: ctx.input.communityName,
            description: ctx.input.theme || `Community: ${ctx.input.communityName}`,
            kind: "COMMUNITY",
            isActive: true,
            institutionId: ctx.input.institutionId || null,
          },
        });
      }
    }

    ctx.results.domainId = domain.id;
    ctx.results.domainSlug = domain.slug;
    ctx.results.domainName = domain.name;

    // 2. Scaffold domain (identity spec + playbook with companion archetype)
    const scaffoldResult = await scaffoldDomain(domain.id, {
      playbookName: ctx.input.communityName,
      extendsAgent: "COMPANION-001",
      groupId: ctx.input.groupId || undefined,
    });

    if (scaffoldResult.playbook) {
      ctx.results.playbookId = scaffoldResult.playbook.id;
    }

    ctx.results.warnings = [...(ctx.results.warnings || []), ...scaffoldResult.skipped];

    // 3. Create CohortGroup (the individual community)
    const cohort = await prisma.cohortGroup.create({
      data: {
        name: ctx.input.communityName,
        description: ctx.input.theme || null,
        domainId: domain.id,
        ownerId: ctx.userId,
        institutionId: ctx.input.institutionId || null,
        groupId: ctx.input.groupId || undefined,
      },
    });

    ctx.results.cohortId = cohort.id;
    ctx.results.cohortName = cohort.name;

    // 4. Link playbook to cohort if we have one
    if (ctx.results.playbookId) {
      await prisma.cohortPlaybook.create({
        data: {
          cohortGroupId: cohort.id,
          playbookId: ctx.results.playbookId,
        },
      }).catch(() => {
        // Ignore if already linked
      });
    }

    // 5. Set onboarding welcome message and guidelines
    const updateData: Record<string, any> = {};
    if (ctx.input.welcomeMessage) {
      updateData.onboardingWelcome = ctx.input.welcomeMessage;
    }
    if (ctx.input.guidelines) {
      // Store guidelines in description (visible in admin UI)
      updateData.description = [
        ctx.input.theme || `Community: ${ctx.input.communityName}`,
        "",
        "Guidelines:",
        ctx.input.guidelines,
      ].join("\n");
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.domain.update({
        where: { id: domain.id },
        data: updateData,
      });
    }

    // 6. Invite members (emails collected in the members step)
    if (ctx.input.memberEmails && ctx.input.memberEmails.length > 0) {
      try {
        ctx.onProgress({ phase: "invitations", message: "Inviting members..." });
        await stepExecutors.invite_members(ctx, {} as CommunitySetupStep);
      } catch (err: any) {
        console.error("[community-setup] Member invitation failed:", err.message);
        ctx.results.warnings!.push(`Invitations: ${err.message}`);
      }
    }
  },

  invite_members: async (ctx) => {
    const domainId = ctx.results.domainId!;

    if (!ctx.input.memberEmails || ctx.input.memberEmails.length === 0) {
      ctx.results.invitationCount = 0;
      return;
    }

    let invitationCount = 0;

    for (const email of ctx.input.memberEmails) {
      try {
        const existing = await prisma.invite.findFirst({
          where: { email, domainId },
        });

        if (!existing) {
          await prisma.invite.create({
            data: {
              email,
              domainId,
              role: "MEMBER",
              invitedBy: ctx.userId,
              status: "PENDING",
            },
          });
          invitationCount++;
        }
      } catch (err) {
        ctx.results.warnings!.push(`Failed to invite ${email}: ${err}`);
      }
    }

    ctx.results.invitationCount = invitationCount;
  },
};

// ── Main Executor ──────────────────────────────────────

/**
 * Execute Community Setup — spec-driven orchestration.
 */
export async function communitySetup(
  input: CommunitySetupInput,
  userId: string,
  taskId: string,
  onProgress: ProgressCallback
): Promise<CommunitySetupResult> {
  const steps = await loadCommunitySetupSteps();

  const ctx: CommunitySetupContext = {
    input,
    userId,
    results: { warnings: [] },
    onProgress,
  };

  onProgress({
    phase: "init",
    message: `Starting Community Setup (${steps.length} steps)...`,
    totalSteps: steps.length,
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const executor = stepExecutors[step.operation];

    if (!executor) {
      const msg = `Unknown step operation: "${step.operation}"`;
      if (step.onError === "abort") throw new Error(msg);
      ctx.results.warnings!.push(msg);
      continue;
    }

    onProgress({
      phase: step.id,
      message: step.progressMessage,
      stepIndex: i,
      totalSteps: steps.length,
    });

    try {
      await executor(ctx, step);

      onProgress({
        phase: step.id,
        message: `${step.name} done`,
        stepIndex: i,
        totalSteps: steps.length,
      });
    } catch (err: any) {
      console.error(`[community-setup] Step "${step.id}" failed:`, err.message);

      if (step.onError === "abort") {
        onProgress({
          phase: step.id,
          message: `Failed: ${err.message}`,
          stepIndex: i,
          totalSteps: steps.length,
        });
        throw err;
      }

      ctx.results.warnings!.push(`${step.name}: ${err.message}`);
      onProgress({
        phase: step.id,
        message: `${step.name} — skipped (${err.message})`,
        stepIndex: i,
        totalSteps: steps.length,
      });
    }

    await updateTaskProgress(taskId, {
      context: {
        step: step.id,
        message: step.progressMessage,
        stepIndex: i,
        totalSteps: steps.length,
      },
    });
  }

  onProgress({
    phase: "ready",
    message: "Community Setup complete!",
    totalSteps: steps.length,
  });

  await completeTask(taskId);

  return {
    domainId: ctx.results.domainId!,
    domainName: ctx.results.domainName!,
    domainSlug: ctx.results.domainSlug!,
    cohortId: ctx.results.cohortId!,
    cohortName: ctx.results.cohortName!,
    playbookId: ctx.results.playbookId!,
    invitationCount: ctx.results.invitationCount || 0,
    warnings: ctx.results.warnings || [],
  };
}
