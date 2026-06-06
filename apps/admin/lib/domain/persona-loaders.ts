import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import type { SpecConfig } from "@/lib/types/json-fields";

const INTERACTION_TO_PERSONA: Record<string, string> = {
  socratic: "tutor",
  directive: "tutor",
  reflective: "tutor",
  open: "tutor",
  advisory: "coach",
  coaching: "coach",
  companion: "companion",
  facilitation: "guide",
  "conversational-guide": "conversational-guide",
};

export function resolvePersonaKey(interactionPatternOrPersona: string): string {
  return INTERACTION_TO_PERSONA[interactionPatternOrPersona] || interactionPatternOrPersona;
}

async function loadOnboardingSpecConfig(): Promise<SpecConfig | null> {
  const onboardingSlug = config.specs.onboarding.toLowerCase();
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      OR: [
        { slug: { contains: onboardingSlug, mode: "insensitive" } },
        { slug: { contains: "onboarding" } },
        { domain: "onboarding" },
      ],
      isActive: true,
    },
    select: { config: true },
  });
  return (spec?.config as SpecConfig) ?? null;
}

export async function loadPersonaFlowPhases(persona: string): Promise<{ phases: unknown } | null> {
  const specConfig = await loadOnboardingSpecConfig();
  if (!specConfig) return null;
  const personaConfig = specConfig.personas?.[resolvePersonaKey(persona)];
  return personaConfig?.firstCallFlow?.phases ? { phases: personaConfig.firstCallFlow.phases } : null;
}

export async function loadPersonaArchetype(persona: string): Promise<string | null> {
  const specConfig = await loadOnboardingSpecConfig();
  if (!specConfig) return null;
  const personaConfig = specConfig.personas?.[resolvePersonaKey(persona)];
  return personaConfig?.identitySpec || null;
}

export async function loadPersonaWelcomeTemplate(persona: string): Promise<string | null> {
  const specConfig = await loadOnboardingSpecConfig();
  if (!specConfig) return null;
  const resolvedKey = resolvePersonaKey(persona);

  const personaConfig = specConfig.personas?.[resolvedKey];
  if (personaConfig?.welcomeTemplate) return personaConfig.welcomeTemplate;

  const styleTemplates = (specConfig as unknown as { styleWelcomeTemplates?: Record<string, string> }).styleWelcomeTemplates;
  if (styleTemplates?.[resolvedKey]) return styleTemplates[resolvedKey];

  const welcomeParam = specConfig.parameters?.find?.((p: { id: string }) => p.id === "welcome_quality");
  const templates = (welcomeParam as { config?: { welcomeTemplates?: Record<string, string> } } | undefined)?.config?.welcomeTemplates;
  if (templates?.[resolvedKey]) return templates[resolvedKey];

  return null;
}
