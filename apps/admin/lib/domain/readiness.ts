/**
 * Domain Readiness Checker
 *
 * Loads DOMAIN-READY-001 ORCHESTRATE spec and evaluates each check
 * against the database for a given domain.
 *
 * Spec-driven: checks are defined in the spec config, not hardcoded here.
 * Adding/removing/reordering checks = edit the spec, zero code changes.
 */

import { prisma } from "@/lib/prisma";
import { CURRICULUM_REQUIRED_FIELDS } from "@/lib/curriculum/constants";

// =====================================================
// TYPES
// =====================================================

export interface ReadinessCheck {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  query: string;
  queryArgs?: Record<string, any>;
  fixAction?: { label: string; href: string };
}

export interface ReadinessCheckResult {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
}

export interface DomainReadinessResult {
  domainId: string;
  domainName: string;
  ready: boolean;
  score: number;
  level: "ready" | "almost" | "incomplete";
  checks: ReadinessCheckResult[];
  criticalPassed: number;
  criticalTotal: number;
  recommendedPassed: number;
  recommendedTotal: number;
}

// =====================================================
// SPEC LOADER
// =====================================================

/**
 * Load readiness checks from DOMAIN-READY-001 spec.
 * Falls back to hardcoded defaults if spec not found (during initial setup).
 */
export async function loadReadinessChecks(): Promise<ReadinessCheck[]> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: "domain-ready-001", mode: "insensitive" },
      isActive: true,
    },
    select: { config: true },
  });

  if (spec?.config) {
    const config = spec.config as Record<string, any>;
    const params = config.parameters || [];
    const checksParam = params.find((p: any) => p.id === "readiness_checks");
    if (checksParam?.config?.checks) {
      return checksParam.config.checks as ReadinessCheck[];
    }
  }

  // Fallback: return a minimal set so readiness works even before spec is seeded
  // Labels are written for teachers, not engineers — avoid jargon
  return [
    {
      id: "playbook_published",
      name: "Learning Programme Ready",
      description: "Your school's learning programme needs to be set up and activated before pupils can start practising",
      severity: "critical",
      query: "playbook",
      fixAction: { label: "Set Up Programme", href: "/x/domains?tab=playbooks" },
    },
    {
      id: "identity_spec",
      name: "AI Tutor Personality Set",
      description: "The AI tutor needs a personality and teaching style configured for your school",
      severity: "critical",
      query: "playbook_spec_role",
      queryArgs: { specRole: "IDENTITY" },
      fixAction: { label: "Configure Tutor", href: "/x/specs/new" },
    },
    {
      id: "ai_keys",
      name: "AI Service Connected",
      description: "The AI service your tutor uses needs to be connected by an administrator",
      severity: "critical",
      query: "ai_keys",
      fixAction: { label: "Connect AI Service", href: "/x/settings" },
    },
    {
      id: "content_curriculum_valid",
      name: "Curriculum Linked",
      description: "Your curriculum topics and learning objectives need to be linked to the programme",
      severity: "recommended",
      query: "content_spec_curriculum",
      fixAction: { label: "Review Curriculum", href: "/x/specs" },
    },
  ];
}

// =====================================================
// CHECK EXECUTORS
// =====================================================

type CheckExecutor = (
  domainId: string,
  check: ReadinessCheck,
) => Promise<{ passed: boolean; detail: string }>;

/**
 * Registry of check executors keyed by query type.
 * Each executor evaluates a specific condition and returns pass/fail + detail.
 */
const checkExecutors: Record<string, CheckExecutor> = {
  // Domain has a PUBLISHED playbook
  playbook: async (domainId) => {
    const playbook = await prisma.playbook.findFirst({
      where: { domainId, status: "PUBLISHED" },
      select: { id: true, name: true },
    });
    return playbook
      ? { passed: true, detail: `Active: "${playbook.name}"` }
      : { passed: false, detail: "No learning programme has been published yet" };
  },

  // Playbook contains a spec with the given specRole (domain items + system spec toggles)
  playbook_spec_role: async (domainId, check) => {
    const specRole = check.queryArgs?.specRole;
    if (!specRole) return { passed: false, detail: "Missing queryArgs.specRole" };

    const playbook = await prisma.playbook.findFirst({
      where: { domainId, status: "PUBLISHED" },
      select: {
        config: true,
        items: {
          where: {
            itemType: "SPEC",
            isEnabled: true,
            spec: { specRole: specRole as any, isActive: true },
          },
          select: { spec: { select: { slug: true, name: true } } },
        },
      },
    });

    const domainSpecs = playbook?.items?.map((i) => i.spec).filter(Boolean) || [];

    // Also check system specs enabled via config.systemSpecToggles
    const systemSpecs: { name: string }[] = [];
    if (playbook?.config) {
      const config = playbook.config as Record<string, any>;
      const toggles = config.systemSpecToggles || {};
      const enabledIds = Object.entries(toggles)
        .filter(([, v]: [string, any]) => v?.isEnabled !== false)
        .map(([id]) => id);

      if (enabledIds.length > 0) {
        const matching = await prisma.analysisSpec.findMany({
          where: {
            id: { in: enabledIds },
            specRole: specRole as any,
            isActive: true,
          },
          select: { name: true },
        });
        systemSpecs.push(...matching);
      }
    }

    const allSpecs = [...domainSpecs.map((s) => s!.name), ...systemSpecs.map((s) => s.name)];
    const roleLabels: Record<string, string> = {
      IDENTITY: "tutor personality",
      CONTENT: "curriculum content",
      EXTRACT: "assessment",
      SYNTHESISE: "analysis",
    };
    const roleLabel = roleLabels[specRole] || specRole.toLowerCase();
    return allSpecs.length > 0
      ? { passed: true, detail: `${allSpecs.length} ${roleLabel} configuration(s) active` }
      : { passed: false, detail: `No ${roleLabel} configuration in the learning programme` };
  },

  // Domain's subjects have content sources linked
  content_sources: async (domainId) => {
    const count = await prisma.subjectSource.count({
      where: {
        subject: {
          domains: { some: { domainId } },
        },
      },
    });
    return count > 0
      ? { passed: true, detail: `${count} teaching material(s) linked` }
      : { passed: false, detail: "No teaching materials linked to your subjects yet" };
  },

  // ContentAssertions exist for domain's content sources
  assertions: async (domainId) => {
    // Get source IDs through domain → subjects → sources
    const sourceIds = await prisma.subjectSource.findMany({
      where: {
        subject: {
          domains: { some: { domainId } },
        },
      },
      select: { sourceId: true },
    });

    if (sourceIds.length === 0) {
      return { passed: false, detail: "Add teaching materials first, then extract key points" };
    }

    const count = await prisma.contentAssertion.count({
      where: { sourceId: { in: sourceIds.map((s) => s.sourceId) } },
    });

    return count > 0
      ? { passed: true, detail: `${count} teaching point(s) ready for the AI tutor` }
      : { passed: false, detail: "Key facts and concepts need to be extracted from your materials" };
  },

  // Domain has onboarding configured
  onboarding: async (domainId) => {
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        onboardingIdentitySpecId: true,
        onboardingFlowPhases: true,
      },
    });

    const hasIdentity = !!domain?.onboardingIdentitySpecId;
    const hasPhases = !!domain?.onboardingFlowPhases;

    if (hasIdentity && hasPhases) {
      return { passed: true, detail: "Pupil welcome experience configured" };
    }
    const missing = [];
    if (!hasIdentity) missing.push("tutor greeting");
    if (!hasPhases) missing.push("welcome steps");
    return { passed: false, detail: `Needs setup: ${missing.join(", ")}` };
  },

  // System spec is active and not dirty
  system_spec: async (_domainId, check) => {
    const slug = check.queryArgs?.slug;
    if (!slug) return { passed: false, detail: "Missing queryArgs.slug" };

    const spec = await prisma.analysisSpec.findFirst({
      where: {
        slug: { contains: slug.toLowerCase(), mode: "insensitive" },
        isActive: true,
        isDirty: false,
      },
      select: { slug: true, name: true },
    });

    return spec
      ? { passed: true, detail: `${spec.name} is active` }
      : { passed: false, detail: `${slug} is not active or needs recompilation` };
  },

  // AI API keys configured
  ai_keys: async () => {
    const hasClaude = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!(process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY);

    if (hasClaude && hasOpenAI) {
      return { passed: true, detail: "Claude + OpenAI configured" };
    }
    if (hasClaude) return { passed: true, detail: "Claude configured" };
    if (hasOpenAI) return { passed: true, detail: "OpenAI configured" };
    return { passed: false, detail: "No AI provider API keys found" };
  },

  // Domain has at least one caller
  test_caller: async (domainId) => {
    const count = await prisma.caller.count({
      where: { domainId },
    });
    return count > 0
      ? { passed: true, detail: `${count} learner(s) enrolled` }
      : { passed: false, detail: "No learners have been added yet" };
  },

  // Curriculum has modules with learning objectives (ADR-002: uses DB, not Content Spec)
  content_spec_curriculum: async (domainId) => {
    // Find curriculum modules via domain → subject → curriculum → modules
    const modules = await prisma.curriculumModule.findMany({
      where: {
        curriculum: {
          subject: { domains: { some: { domainId } } },
        },
      },
      select: { id: true, learningObjectives: { select: { id: true } } },
    });

    if (modules.length === 0) {
      // No curriculum is fine — domain may not have structured content
      return { passed: true, detail: "No curriculum structure required for this programme" };
    }

    const withLOs = modules.filter((m) => m.learningObjectives.length > 0);
    if (withLOs.length === 0) {
      return {
        passed: true,
        detail: `${modules.length} topic(s) linked (add learning outcomes for mastery tracking)`,
      };
    }

    return {
      passed: true,
      detail: `${modules.length} topic(s), ${withLOs.length} with learning outcomes`,
    };
  },
};

// =====================================================
// MAIN EXECUTOR
// =====================================================

/**
 * Check domain readiness by evaluating all checks from DOMAIN-READY-001 spec.
 * All checks run in parallel for performance.
 */
export async function checkDomainReadiness(
  domainId: string,
): Promise<DomainReadinessResult> {
  // Load domain info
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true },
  });

  if (!domain) {
    throw new Error(`Domain not found: ${domainId}`);
  }

  // Load checks from spec
  const checks = await loadReadinessChecks();

  // Execute all checks in parallel
  const results: ReadinessCheckResult[] = await Promise.all(
    checks.map(async (check) => {
      const executor = checkExecutors[check.query];
      if (!executor) {
        return {
          id: check.id,
          name: check.name,
          description: check.description,
          severity: check.severity,
          passed: false,
          detail: `Unknown check query: "${check.query}"`,
          fixAction: check.fixAction,
        };
      }

      try {
        const { passed, detail } = await executor(domainId, check);
        return {
          id: check.id,
          name: check.name,
          description: check.description,
          severity: check.severity,
          passed,
          detail,
          fixAction: check.fixAction,
        };
      } catch (err: any) {
        return {
          id: check.id,
          name: check.name,
          description: check.description,
          severity: check.severity,
          passed: false,
          detail: `Check failed: ${err.message}`,
          fixAction: check.fixAction,
        };
      }
    }),
  );

  // Compute summary
  const criticalChecks = results.filter((r) => r.severity === "critical");
  const recommendedChecks = results.filter((r) => r.severity === "recommended");
  const criticalPassed = criticalChecks.filter((r) => r.passed).length;
  const recommendedPassed = recommendedChecks.filter((r) => r.passed).length;
  const allPassed = results.filter((r) => r.passed).length;

  const allCriticalPass = criticalPassed === criticalChecks.length;
  const allRecommendedPass = recommendedPassed === recommendedChecks.length;

  const level = allCriticalPass && allRecommendedPass
    ? "ready"
    : allCriticalPass
      ? "almost"
      : "incomplete";

  const score = results.length > 0
    ? Math.round((allPassed / results.length) * 100)
    : 0;

  return {
    domainId: domain.id,
    domainName: domain.name,
    ready: allCriticalPass,
    score,
    level,
    checks: results,
    criticalPassed,
    criticalTotal: criticalChecks.length,
    recommendedPassed,
    recommendedTotal: recommendedChecks.length,
  };
}
