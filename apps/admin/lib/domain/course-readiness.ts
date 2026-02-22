/**
 * Course Readiness Checker
 *
 * Loads COURSE-READY-001 ORCHESTRATE spec and evaluates each check
 * against the database for a given course context (domain + caller + source).
 *
 * Spec-driven: checks are defined in the spec config, not hardcoded here.
 * Adding/removing/reordering checks = edit the spec, zero code changes.
 *
 * Mirrors lib/domain/readiness.ts (DOMAIN-READY-001) but scoped to
 * content quality rather than infrastructure.
 */

import { prisma } from "@/lib/prisma";

// =====================================================
// TYPES
// =====================================================

export interface CourseReadinessCheck {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  query: string;
  queryArgs?: Record<string, any>;
  fixAction?: { label: string; hrefTemplate: string };
}

export interface CourseReadinessCheckResult {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
}

export interface CourseReadinessResult {
  domainId: string;
  ready: boolean;
  score: number;
  level: "ready" | "almost" | "incomplete";
  checks: CourseReadinessCheckResult[];
  criticalPassed: number;
  criticalTotal: number;
  recommendedPassed: number;
  recommendedTotal: number;
}

/** Context for resolving hrefTemplate variables */
export interface CourseReadinessContext {
  domainId: string;
  callerId?: string;
  sourceId?: string;
  subjectId?: string;
  curriculumId?: string;
}

// =====================================================
// SPEC LOADER
// =====================================================

/**
 * Load readiness checks from COURSE-READY-001 spec.
 * Falls back to defaults if spec not found (during initial setup).
 */
export async function loadCourseReadinessChecks(): Promise<CourseReadinessCheck[]> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: "course-ready-001", mode: "insensitive" },
      isActive: true,
    },
    select: { config: true },
  });

  if (spec?.config) {
    const config = spec.config as Record<string, any>;
    const params = config.parameters || [];
    const checksParam = params.find((p: any) => p.id === "readiness_checks");
    if (checksParam?.config?.checks) {
      return checksParam.config.checks as CourseReadinessCheck[];
    }
  }

  // Fallback defaults
  return [
    {
      id: "assertions_reviewed",
      name: "Review Content",
      description: "Review AI-extracted content for accuracy",
      severity: "recommended",
      query: "assertions_reviewed",
      fixAction: { label: "Review Points", hrefTemplate: "/x/content-sources/${sourceId}" },
    },
    {
      id: "lesson_plan_set",
      name: "Review Curriculum",
      description: "Check the generated curriculum structure",
      severity: "recommended",
      query: "lesson_plan",
      fixAction: { label: "Review Plan", hrefTemplate: "/x/domains?id=${domainId}&tab=content" },
    },
    {
      id: "onboarding_configured",
      name: "Configure Onboarding",
      description: "Set the welcome message and flow for the first call",
      severity: "recommended",
      query: "onboarding",
      fixAction: { label: "Configure", hrefTemplate: "/x/domains?id=${domainId}&tab=onboarding" },
    },
    {
      id: "prompt_composed",
      name: "Preview First Prompt",
      description: "Preview what the AI will say in the first conversation",
      severity: "critical",
      query: "prompt_composed",
      fixAction: { label: "Preview Prompt", hrefTemplate: "/x/callers/${callerId}" },
    },
  ];
}

// =====================================================
// HREF TEMPLATE RESOLVER
// =====================================================

/**
 * Resolve ${variable} placeholders in href templates.
 */
function resolveHref(template: string, ctx: CourseReadinessContext): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const value = (ctx as Record<string, any>)[key];
    return value ?? "";
  });
}

// =====================================================
// CHECK EXECUTORS
// =====================================================

type CheckExecutor = (
  ctx: CourseReadinessContext,
  check: CourseReadinessCheck,
) => Promise<{ passed: boolean; detail: string }>;

const checkExecutors: Record<string, CheckExecutor> = {
  /**
   * Any assertions marked as reviewed for the given content source?
   * Falls back to checking domain-wide if no sourceId provided.
   */
  assertions_reviewed: async (ctx) => {
    // If we have a specific sourceId, check that source
    if (ctx.sourceId) {
      const total = await prisma.contentAssertion.count({
        where: { sourceId: ctx.sourceId },
      });
      if (total === 0) {
        return { passed: true, detail: "No content to review" };
      }
      const reviewed = await prisma.contentAssertion.count({
        where: { sourceId: ctx.sourceId, reviewedAt: { not: null } },
      });
      if (reviewed > 0) {
        return { passed: true, detail: `${reviewed}/${total} content items reviewed` };
      }
      return { passed: false, detail: `${total} content items awaiting review` };
    }

    // Fallback: check domain-wide via subject chain
    const sourceIds = await prisma.subjectSource.findMany({
      where: { subject: { domains: { some: { domainId: ctx.domainId } } } },
      select: { sourceId: true },
    });
    if (sourceIds.length === 0) {
      return { passed: false, detail: "No content sources linked" };
    }
    const ids = sourceIds.map((s) => s.sourceId);
    const total = await prisma.contentAssertion.count({
      where: { sourceId: { in: ids } },
    });
    const reviewed = await prisma.contentAssertion.count({
      where: { sourceId: { in: ids }, reviewedAt: { not: null } },
    });
    if (total === 0) return { passed: true, detail: "No content to review" };
    if (reviewed > 0) return { passed: true, detail: `${reviewed}/${total} reviewed` };
    return { passed: false, detail: `${total} content items awaiting review` };
  },

  /**
   * Domain has curriculum content (extracted assertions or a CONTENT spec).
   *
   * Intent-led approach: Pass if ANY assertions have been extracted OR
   * a CONTENT spec exists (system auto-scaffolds playbook/specs on extraction).
   * Don't require PUBLISHED playbook — that's implementation detail.
   */
  lesson_plan: async (ctx) => {
    // First check if any assertions exist (indicates content has been uploaded/extracted)
    const subjectAssertionCount = await prisma.contentAssertion.count({
      where: {
        source: {
          subjects: {
            some: { subject: { domains: { some: { domainId: ctx.domainId } } } },
          },
        },
      },
    });

    if (subjectAssertionCount > 0) {
      return { passed: true, detail: `${subjectAssertionCount} content item(s) extracted` };
    }

    // Fallback: check for CONTENT spec in any playbook (published or draft)
    const contentSpec = await prisma.analysisSpec.findFirst({
      where: {
        specRole: "CONTENT",
        isActive: true,
        playbookItems: {
          some: {
            playbook: { domainId: ctx.domainId },
            isEnabled: true,
          },
        },
      },
      select: { config: true },
    });

    if (!contentSpec) {
      return { passed: false, detail: "No curriculum content configured" };
    }

    const specConfig = contentSpec.config as Record<string, any> | null;
    const deliveryConfig = specConfig?.deliveryConfig;
    const lessonPlan = deliveryConfig?.lessonPlan;

    if (Array.isArray(lessonPlan) && lessonPlan.length > 0) {
      return { passed: true, detail: `${lessonPlan.length} lesson(s) planned` };
    }

    const modules = specConfig?.modules;
    if (Array.isArray(modules) && modules.length > 0) {
      return { passed: true, detail: `${modules.length} module(s) configured` };
    }

    return { passed: false, detail: "Curriculum not yet generated" };
  },

  /**
   * Domain has onboarding configured (identity spec + flow phases).
   */
  onboarding: async (ctx) => {
    const domain = await prisma.domain.findUnique({
      where: { id: ctx.domainId },
      select: {
        onboardingIdentitySpecId: true,
        onboardingFlowPhases: true,
      },
    });

    const hasIdentity = !!domain?.onboardingIdentitySpecId;
    const hasPhases = !!domain?.onboardingFlowPhases;

    if (hasIdentity && hasPhases) {
      return { passed: true, detail: "Welcome experience configured" };
    }
    const missing = [];
    if (!hasIdentity) missing.push("tutor greeting");
    if (!hasPhases) missing.push("welcome steps");
    return { passed: false, detail: `Needs setup: ${missing.join(", ")}` };
  },

  /**
   * Caller has a ComposedPrompt (prompt has been composed at least once).
   */
  prompt_composed: async (ctx) => {
    if (!ctx.callerId) {
      return { passed: false, detail: "No test caller — compose a prompt first" };
    }

    const prompt = await prisma.composedPrompt.findFirst({
      where: { callerId: ctx.callerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });

    if (prompt) {
      return { passed: true, detail: "First prompt composed — ready to preview" };
    }
    return { passed: false, detail: "Compose and preview the first prompt before starting" };
  },
};

// =====================================================
// MAIN EXECUTOR
// =====================================================

/**
 * Check course readiness by evaluating all checks from COURSE-READY-001 spec.
 * All checks run in parallel for performance.
 */
export async function checkCourseReadiness(
  ctx: CourseReadinessContext,
): Promise<CourseReadinessResult> {
  const checks = await loadCourseReadinessChecks();

  // Execute all checks in parallel
  const results: CourseReadinessCheckResult[] = await Promise.all(
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
          fixAction: check.fixAction
            ? { label: check.fixAction.label, href: resolveHref(check.fixAction.hrefTemplate, ctx) }
            : undefined,
        };
      }

      try {
        const { passed, detail } = await executor(ctx, check);
        return {
          id: check.id,
          name: check.name,
          description: check.description,
          severity: check.severity,
          passed,
          detail,
          fixAction: check.fixAction
            ? { label: check.fixAction.label, href: resolveHref(check.fixAction.hrefTemplate, ctx) }
            : undefined,
        };
      } catch (err: any) {
        return {
          id: check.id,
          name: check.name,
          description: check.description,
          severity: check.severity,
          passed: false,
          detail: `Check failed: ${err.message}`,
          fixAction: check.fixAction
            ? { label: check.fixAction.label, href: resolveHref(check.fixAction.hrefTemplate, ctx) }
            : undefined,
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
    domainId: ctx.domainId,
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
