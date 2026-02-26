/**
 * Domain Scaffold
 *
 * Auto-creates the minimum viable setup for a domain:
 * - Identity spec (IDENTITY / COMPOSE)
 * - Playbook with identity spec + system specs enabled
 * - Publishes the playbook
 * - Configures onboarding (identity spec + default flow phases)
 *
 * Idempotent: safe to run multiple times on the same domain.
 */

import { db, type TxClient } from "@/lib/prisma";
import { config } from "@/lib/config";
import { getFlowPhasesFallback } from "@/lib/fallback-settings";

// ── Types ──────────────────────────────────────────────

export interface ScaffoldOptions {
  /** AI-generated identity config to populate the identity spec. If omitted, spec is created with generic defaults. */
  identityConfig?: Record<string, any>;
  /** Persona-specific onboarding flow phases (from INIT-001). If omitted, uses DEFAULT_FLOW_PHASES. */
  flowPhases?: any;
  /** Base archetype slug to extend (e.g., "TUT-001", "COMPANION-001"). If omitted, uses config.specs.defaultArchetype. */
  extendsAgent?: string;
  /** When true, always create a new playbook even if one already exists (new class in existing school). */
  forceNewPlaybook?: boolean;
  /** Custom playbook name (used when forceNewPlaybook=true). Falls back to "{domain.name} Playbook". */
  playbookName?: string;
  /** Optional PlaybookGroup ID to assign the created playbook to a department/division/track. */
  groupId?: string;
}

export interface ScaffoldResult {
  identitySpec: { id: string; slug: string; name: string } | null;
  playbook: { id: string; name: string } | null;
  published: boolean;
  onboardingConfigured: boolean;
  extendsAgent: string;
  skipped: string[];
}

// ── Default onboarding flow phases ─────────────────────

// Loaded from SystemSettings at runtime (see fallback-settings.ts for hardcoded last-resort)

// ── Main scaffold function ─────────────────────────────

export async function scaffoldDomain(domainId: string, options?: ScaffoldOptions, tx?: TxClient): Promise<ScaffoldResult> {
  const skipped: string[] = [];
  const p = db(tx);

  // 1. Load domain (including institution type chain for archetype resolution)
  const domain = await p.domain.findUnique({
    where: { id: domainId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      institution: {
        select: {
          type: {
            select: { defaultArchetypeSlug: true },
          },
        },
      },
    },
  });

  if (!domain) {
    throw new Error(`Domain not found: ${domainId}`);
  }

  // Resolve archetype: explicit option → institution type chain → global default
  const resolvedArchetype = options?.extendsAgent
    || domain.institution?.type?.defaultArchetypeSlug
    || config.specs.defaultArchetype;

  // 2. Check for existing published playbook — already scaffolded
  //    Skip this check when forceNewPlaybook=true (new class in existing school)
  if (!options?.forceNewPlaybook) {
    const existingPublished = await p.playbook.findFirst({
      where: { domainId, status: "PUBLISHED" },
      select: { id: true, name: true },
    });

    if (existingPublished) {
      // Ensure identity spec exists (may be missing if domain was created manually)
      const archetypeSlug = resolvedArchetype;
      const archetypeLabel = archetypeSlug.replace(/-\d+$/, "").toLowerCase();
      const identitySlug = `${domain.slug}-identity`;

      let identitySpec = await p.analysisSpec.findFirst({
        where: { slug: identitySlug },
        select: { id: true, slug: true, name: true },
      });

      if (!identitySpec) {
        // Create identity spec overlay (same logic as step 3 below)
        const overlayConfig = options?.identityConfig
          ? JSON.parse(JSON.stringify(options.identityConfig))
          : {
              parameters: [
                {
                  id: "agent_role",
                  name: "Domain Role Override",
                  section: "identity",
                  config: {
                    roleStatement: `You are a friendly, supportive ${archetypeLabel} specializing in ${domain.name}. You adapt to each person's pace and style.`,
                    primaryGoal: `Help people engage meaningfully with ${domain.name}`,
                  },
                },
              ],
            };

        identitySpec = await p.analysisSpec.create({
          data: {
            slug: identitySlug,
            name: `${domain.name} Identity`,
            description: `Domain overlay for ${domain.name} — extends the base ${archetypeLabel} archetype with domain-specific adaptations.`,
            outputType: "COMPOSE",
            specRole: "IDENTITY",
            specType: "DOMAIN",
            domain: "identity",
            scope: "DOMAIN",
            isActive: true,
            isDirty: false,
            isDeletable: true,
            extendsAgent: archetypeSlug,
            config: overlayConfig,
            triggers: {
              create: [
                {
                  given: `A ${domain.name} session`,
                  when: "The system needs to establish agent identity and tone",
                  then: "A consistent, domain-appropriate personality is presented to the caller",
                  name: "Identity establishment",
                  sortOrder: 0,
                },
              ],
            },
          },
          select: { id: true, slug: true, name: true },
        });

        // Link identity spec to existing playbook
        const existingItem = await p.playbookItem.findFirst({
          where: { playbookId: existingPublished.id, specId: identitySpec.id },
        });
        if (!existingItem) {
          await p.playbookItem.create({
            data: {
              playbookId: existingPublished.id,
              itemType: "SPEC",
              specId: identitySpec.id,
              sortOrder: 0,
              isEnabled: true,
            },
          });
        }
      }

      // Ensure onboarding is configured
      const currentDomain = await p.domain.findUnique({
        where: { id: domainId },
        select: { onboardingIdentitySpecId: true, onboardingFlowPhases: true },
      });
      if (!currentDomain?.onboardingIdentitySpecId) {
        await p.domain.update({
          where: { id: domainId },
          data: {
            onboardingIdentitySpecId: identitySpec.id,
            onboardingFlowPhases: currentDomain?.onboardingFlowPhases || options?.flowPhases || await getFlowPhasesFallback(),
          },
        });
      }

      return {
        identitySpec: { id: identitySpec.id, slug: identitySpec.slug, name: identitySpec.name },
        playbook: { id: existingPublished.id, name: existingPublished.name },
        published: false,
        onboardingConfigured: true,
        extendsAgent: archetypeSlug,
        skipped: ["Published playbook already exists — ensured identity spec + onboarding"],
      };
    }
  }

  // 3. Find or create Identity spec
  const archetypeSlug = resolvedArchetype;
  const archetypeLabel = archetypeSlug.replace(/-\d+$/, "").toLowerCase(); // "TUT-001" → "tut", "COMPANION-001" → "companion"

  const identitySlug = `${domain.slug}-identity`;
  let identitySpec = await p.analysisSpec.findFirst({
    where: { slug: identitySlug },
    select: { id: true, slug: true, name: true },
  });

  if (!identitySpec) {

    // Build overlay config: only domain-specific parameters, not a full standalone spec.
    // At prompt composition time, mergeIdentitySpec() merges this overlay with the base archetype.
    const overlayConfig = options?.identityConfig
      ? JSON.parse(JSON.stringify(options.identityConfig))
      : {
          parameters: [
            {
              id: "agent_role",
              name: "Domain Role Override",
              section: "identity",
              config: {
                roleStatement: `You are a friendly, supportive ${archetypeLabel} specializing in ${domain.name}. You adapt to each person's pace and style.`,
                primaryGoal: `Help people engage meaningfully with ${domain.name}`,
              },
            },
          ],
        };

    identitySpec = await p.analysisSpec.create({
      data: {
        slug: identitySlug,
        name: `${domain.name} Identity`,
        description: `Domain overlay for ${domain.name} — extends the base ${archetypeLabel} archetype with domain-specific adaptations.`,
        outputType: "COMPOSE",
        specRole: "IDENTITY",
        specType: "DOMAIN",
        domain: "identity",
        scope: "DOMAIN",
        isActive: true,
        isDirty: false,
        isDeletable: true,
        extendsAgent: archetypeSlug,
        config: overlayConfig,
        triggers: {
          create: [
            {
              given: `A ${domain.name} session`,
              when: "The system needs to establish agent identity and tone",
              then: "A consistent, domain-appropriate personality is presented to the caller",
              name: "Identity establishment",
              sortOrder: 0,
            },
          ],
        },
      },
      select: { id: true, slug: true, name: true },
    });
  } else {
    skipped.push("Identity spec already exists");
  }

  // 4. Find or create Playbook
  //    When forceNewPlaybook=true, always create a new playbook (new class)
  const pbName = options?.playbookName || `${domain.name} Playbook`;
  let playbook: { id: string; name: string } | null = null;

  if (!options?.forceNewPlaybook) {
    playbook = await p.playbook.findFirst({
      where: { domainId, status: "DRAFT" },
      select: { id: true, name: true },
    });
    if (playbook) {
      skipped.push("Reusing existing DRAFT playbook");
    }
  }

  if (!playbook) {
    playbook = await p.playbook.create({
      data: {
        name: pbName,
        domainId,
        status: "DRAFT",
        version: "1.0",
        groupId: options?.groupId || undefined,
      },
      select: { id: true, name: true },
    });
  }

  // 5. Add Identity spec to playbook (if not already linked)
  const existingItem = await p.playbookItem.findFirst({
    where: { playbookId: playbook.id, specId: identitySpec.id },
  });

  if (!existingItem) {
    await p.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: identitySpec.id,
        sortOrder: 0,
        isEnabled: true,
      },
    });
  }

  // 6. Enable system specs via config.systemSpecToggles
  const systemSpecs = await p.analysisSpec.findMany({
    where: { specType: "SYSTEM", isActive: true },
    select: { id: true },
  });

  const toggles: Record<string, { isEnabled: boolean }> = {};
  for (const ss of systemSpecs) {
    toggles[ss.id] = { isEnabled: true };
  }

  // Merge with any existing config
  const currentPlaybook = await p.playbook.findUnique({
    where: { id: playbook.id },
    select: { config: true },
  });
  const currentConfig = (currentPlaybook?.config as Record<string, any>) || {};

  await p.playbook.update({
    where: { id: playbook.id },
    data: {
      config: {
        ...currentConfig,
        systemSpecToggles: {
          ...(currentConfig.systemSpecToggles || {}),
          ...toggles,
        },
      },
    },
  });

  // 7. Publish playbook
  //    When forceNewPlaybook=true, keep existing published playbooks (multiple classes coexist).
  //    Otherwise archive them (original behavior — one published playbook per domain).
  if (!options?.forceNewPlaybook) {
    await p.playbook.updateMany({
      where: {
        domainId,
        status: "PUBLISHED",
        id: { not: playbook.id },
      },
      data: { status: "ARCHIVED" },
    });
  }

  await p.playbook.update({
    where: { id: playbook.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      validationPassed: true,
      measureSpecCount: 0,
      learnSpecCount: 0,
      adaptSpecCount: 0,
      parameterCount: 0,
    },
  });

  // 8. Configure onboarding
  await p.domain.update({
    where: { id: domainId },
    data: {
      onboardingIdentitySpecId: identitySpec.id,
      onboardingFlowPhases: options?.flowPhases || await getFlowPhasesFallback(),
    },
  });

  return {
    identitySpec: { id: identitySpec.id, slug: identitySpec.slug, name: identitySpec.name },
    playbook: { id: playbook.id, name: playbook.name },
    published: true,
    onboardingConfigured: true,
    extendsAgent: archetypeSlug,
    skipped,
  };
}
