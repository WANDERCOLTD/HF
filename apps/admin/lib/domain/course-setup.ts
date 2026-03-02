/**
 * Course Setup Executor
 *
 * Spec-driven orchestrator for the Course Setup Wizard. Similar pattern to quick-launch.ts,
 * but adapted for interactive course creation (file upload already done, less AI generation).
 *
 * Loaded from COURSE-SETUP-001 ORCHESTRATE spec.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { logSystem } from "@/lib/logger";
import { scaffoldDomain } from "@/lib/domain/scaffold";
import { loadPersonaFlowPhases, loadPersonaArchetype, loadPersonaWelcomeTemplate } from "@/lib/domain/quick-launch";
import { applyBehaviorTargets } from "@/lib/domain/agent-tuning";
import { enrollCaller, enrollCallerInDomainPlaybooks } from "@/lib/enrollment";
import { updateTaskProgress, completeTask, failTask } from "@/lib/ai/task-guidance";
import type { ProgressEvent, ProgressCallback } from "./types";
export type { ProgressEvent, ProgressCallback };

// ── Types ──────────────────────────────────────────────

export interface PlanIntents {
  sessionCount: number;
  durationMins: number;
  emphasis: string; // "breadth" | "balanced" | "depth"
  assessments: string; // "formal" | "light" | "none"
}

export interface CourseSetupInput {
  courseName: string;
  learningOutcomes: string[];
  teachingStyle: string; // "tutor" | "coach" | "mentor" | "socratic" (kept for backward compat)
  sessionCount: number;
  durationMins: number;
  emphasis: string; // "breadth" | "balanced" | "depth"
  welcomeMessage: string;
  studentEmails: string[];
  domainId?: string; // if attaching to existing institution
  sourceId?: string; // if content step created a ContentSource already
  // Lesson plan step — pre-created entities from "Generate & Review" path
  subjectId?: string;
  curriculumId?: string;
  planIntents?: PlanIntents;
  lessonPlanMode?: "accept" | "reviewed" | "skipped";
  // Students step — cohort/individual enrollment
  cohortGroupIds?: string[];
  selectedCallerIds?: string[];
  // Config step — behavior tuning targets from AgentTuner
  behaviorTargets?: Record<string, number>;
  // Config step — user-edited call flow phases (overrides persona defaults if provided)
  onboardingFlowPhases?: Array<{ phase: string; duration: string; goals: string[]; avoid?: string[] }>;
  // Content step — subjects created by PackUploadStep (with actual ContentSources)
  packSubjectIds?: string[];
  // Two-axis identity (stored in Playbook.config)
  interactionPattern?: string; // HOW to interact: "socratic" | "directive" | "advisory" | "coaching" | ...
  teachingMode?: string; // WHAT to emphasise: "recall" | "comprehension" | "practice" | "syllabus"
  subjectDiscipline?: string; // Subject/discipline name for prompt identity (e.g. "GCSE Biology")
  // Wizard task tracking — reuse wizard task for launch progress
  wizardTaskId?: string;
  // Optional department/division/track grouping
  groupId?: string;
}

export interface CourseSetupResult {
  domainId: string;
  domainName: string;
  domainSlug: string;
  institutionId?: string;
  playbookId: string;
  playbookName: string;
  contentSpecId?: string;
  curriculumId?: string;
  invitationCount: number;
  warnings: string[];
}

interface CourseSetupContext {
  input: CourseSetupInput;
  userId: string;
  results: Partial<CourseSetupResult> & { [key: string]: any };
  onProgress: ProgressCallback;
}

interface CourseSetupStep {
  id: string;
  name: string;
  operation: string;
  order: number;
  onError: "abort" | "continue";
  progressMessage: string;
  args?: Record<string, any>;
}

// ── Spec Loader ────────────────────────────────────────

/** Hardcoded fallback when COURSE-SETUP-001 spec is not seeded */
const FALLBACK_STEPS: CourseSetupStep[] = [
  { id: "intent", name: "Course Intent", operation: "noop", order: 1, onError: "continue", progressMessage: "Setting Course Intent" },
  { id: "content", name: "Add Content", operation: "noop", order: 2, onError: "continue", progressMessage: "Adding Content" },
  { id: "lesson-plan", name: "Lesson Plan", operation: "noop", order: 3, onError: "continue", progressMessage: "Planning Lessons" },
  { id: "course-config", name: "Configure AI", operation: "noop", order: 4, onError: "continue", progressMessage: "Configuring AI" },
  { id: "students", name: "Students", operation: "noop", order: 5, onError: "continue", progressMessage: "Adding Students" },
  { id: "done", name: "Launch", operation: "create_course", order: 6, onError: "continue", progressMessage: "Creating Course" },
];

/**
 * Load course setup steps from COURSE-SETUP-001 spec.
 * Falls back to hardcoded defaults if spec is not seeded.
 */
async function loadCourseSetupSteps(): Promise<CourseSetupStep[]> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: config.specs.courseSetup.toLowerCase(), mode: "insensitive" },
      isActive: true,
    },
    select: { slug: true, config: true },
  });

  if (!spec) {
    logSystem("course-setup", {
      level: "warn",
      message: `Spec "${config.specs.courseSetup}" not found — using hardcoded fallback. Run db:seed to import it.`,
    });
    return FALLBACK_STEPS;
  }

  const specConfig = spec.config as Record<string, any>;
  const params = specConfig?.parameters || [];
  const stepsParam = params.find((p: any) => p.id === "wizard_steps");
  const steps = stepsParam?.config?.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    logSystem("course-setup", {
      level: "warn",
      message: `Spec "${config.specs.courseSetup}" has no wizard_steps — using hardcoded fallback.`,
    });
    return FALLBACK_STEPS;
  }

  // Convert wizard steps to executor steps (add operation, onError, progressMessage)
  return (steps as any[])
    .map((step: any) => ({
      id: step.id,
      name: step.label,
      operation: mapStepToOperation(step.id),
      order: step.order,
      onError: "continue", // course setup is forgiving
      progressMessage: step.activeLabel,
      args: step.args,
    }))
    .sort((a, b) => a.order - b.order);
}

function mapStepToOperation(stepId: string): string {
  // Onboarding + enrollment logic runs inside create_course (after scaffold)
  // rather than as separate mapped steps, because they depend on domainId/playbookId.
  const mapping: Record<string, string> = {
    intent: "noop",
    content: "noop",
    "lesson-plan": "noop",
    "course-config": "noop",
    students: "noop",
    done: "create_course",
    // Legacy step IDs (kept for backwards compat with existing DB specs)
    "teaching-points": "noop",
    "lesson-structure": "noop",
  };
  return mapping[stepId] || "noop";
}

// ── Step Executor Registry ─────────────────────────────

const stepExecutors: Record<string, (ctx: CourseSetupContext, step: CourseSetupStep) => Promise<void>> = {
  noop: async (ctx) => {
    // No-op for UI-only steps
  },

  create_course: async (ctx) => {
    // 1. Create or find Domain
    const domainSlug = (ctx.input.courseName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    let domain;
    if (ctx.input.domainId) {
      // Use existing domain
      domain = await prisma.domain.findUnique({
        where: { id: ctx.input.domainId },
      });
      if (!domain) {
        throw new Error(`Domain not found: ${ctx.input.domainId}`);
      }
    } else {
      // Find or create domain
      domain = await prisma.domain.findFirst({ where: { slug: domainSlug } });
      if (!domain) {
        domain = await prisma.domain.create({
          data: {
            slug: domainSlug,
            name: ctx.input.courseName,
            description: `Course: ${ctx.input.courseName}`,
            isActive: true,
          },
        });
      }
    }

    ctx.results.domainId = domain.id;
    ctx.results.domainSlug = domain.slug;
    ctx.results.domainName = domain.name;
    ctx.results.institutionId = domain.institutionId ?? undefined;

    // 2. Create or find Subject (reuse pre-created from Generate & Review path, or pack upload)
    let subject;
    if (ctx.input.subjectId) {
      subject = await prisma.subject.findUnique({ where: { id: ctx.input.subjectId } });
      if (!subject) {
        // Pre-created subject was deleted — fall back to create
        ctx.results.warnings!.push("Pre-created subject not found, creating new one");
        ctx.input.subjectId = undefined;
      }
    }
    // If no subjectId but packSubjects exist, reuse the first one as the primary subject
    if (!subject && ctx.input.packSubjectIds?.length) {
      subject = await prisma.subject.findUnique({ where: { id: ctx.input.packSubjectIds[0] } });
    }
    if (!subject) {
      const subjectSlug = domainSlug;
      subject = await prisma.subject.findFirst({ where: { slug: subjectSlug } });
      if (!subject) {
        subject = await prisma.subject.create({
          data: {
            slug: subjectSlug,
            name: ctx.input.courseName,
            isActive: true,
          },
        });
      }
    }
    ctx.results.subjectId = subject.id;

    // 2b. Link uploaded ContentSource to Subject (if sourceId provided and not already linked)
    if (ctx.input.sourceId) {
      const existingSourceLink = await prisma.subjectSource.findFirst({
        where: { subjectId: subject.id, sourceId: ctx.input.sourceId },
      });
      if (!existingSourceLink) {
        await prisma.subjectSource.create({
          data: { subjectId: subject.id, sourceId: ctx.input.sourceId, tags: ["content"] },
        });
      }
    }

    // 3. Link Subject to Domain
    const existing = await prisma.subjectDomain.findFirst({
      where: { subjectId: subject.id, domainId: domain.id },
    });
    if (!existing) {
      await prisma.subjectDomain.create({
        data: { subjectId: subject.id, domainId: domain.id },
      });
    }

    // 4. Scaffold domain (identity spec + playbook)
    // Prefer user-edited phases over persona defaults if provided
    const personaFlowPhases = await loadPersonaFlowPhases(ctx.input.teachingStyle);
    const customFlowPhases = ctx.input.onboardingFlowPhases;
    const resolvedScaffoldPhases = customFlowPhases && customFlowPhases.length > 0
      ? { phases: customFlowPhases }
      : personaFlowPhases;
    const archetypeSlug = await loadPersonaArchetype(ctx.input.teachingStyle);
    const scaffoldResult = await scaffoldDomain(domain.id, {
      flowPhases: resolvedScaffoldPhases || undefined,
      extendsAgent: archetypeSlug || undefined,
      forceNewPlaybook: !!ctx.input.domainId,
      playbookName: ctx.input.courseName,
      groupId: ctx.input.groupId || undefined,
    });

    if (scaffoldResult.playbook) {
      ctx.results.playbookId = scaffoldResult.playbook.id;
      ctx.results.playbookName = scaffoldResult.playbook.name;

      // Store interactionPattern + teachingMode + subjectDiscipline in playbook config if provided
      if (ctx.input.interactionPattern || ctx.input.teachingMode || ctx.input.subjectDiscipline) {
        const pb = await prisma.playbook.findUnique({
          where: { id: scaffoldResult.playbook.id },
          select: { config: true },
        });
        const existingConfig = (pb?.config as Record<string, any>) || {};
        await prisma.playbook.update({
          where: { id: scaffoldResult.playbook.id },
          data: {
            config: {
              ...existingConfig,
              ...(ctx.input.interactionPattern && { interactionPattern: ctx.input.interactionPattern }),
              ...(ctx.input.teachingMode && { teachingMode: ctx.input.teachingMode }),
              ...(ctx.input.subjectDiscipline && { subjectDiscipline: ctx.input.subjectDiscipline }),
            },
          },
        });
      }

      // Link Subject to Playbook (course-scoped content retrieval)
      if (ctx.results.subjectId) {
        await prisma.playbookSubject.upsert({
          where: {
            playbookId_subjectId: {
              playbookId: scaffoldResult.playbook.id,
              subjectId: ctx.results.subjectId,
            },
          },
          update: {},
          create: {
            playbookId: scaffoldResult.playbook.id,
            subjectId: ctx.results.subjectId,
          },
        });
      }
    }

    // 4b. Link content-rich subjects from PackUploadStep (if any)
    if (ctx.input.packSubjectIds && ctx.input.packSubjectIds.length > 0 && scaffoldResult.playbook) {
      for (const packSubId of ctx.input.packSubjectIds) {
        // Link to Playbook
        await prisma.playbookSubject.upsert({
          where: {
            playbookId_subjectId: {
              playbookId: scaffoldResult.playbook.id,
              subjectId: packSubId,
            },
          },
          update: {},
          create: {
            playbookId: scaffoldResult.playbook.id,
            subjectId: packSubId,
          },
        });

        // Link to Domain
        const domainLink = await prisma.subjectDomain.findFirst({
          where: { subjectId: packSubId, domainId: domain.id },
        });
        if (!domainLink) {
          await prisma.subjectDomain.create({
            data: { subjectId: packSubId, domainId: domain.id },
          });
        }
      }
    }

    ctx.results.warnings = [...(ctx.results.warnings || []), ...scaffoldResult.skipped];

    // 5. Configure onboarding (always — persist user overrides or persona defaults)
    try {
      ctx.onProgress({ phase: "onboarding", message: "Configuring onboarding..." });
      await stepExecutors.configure_onboarding(ctx, step);
    } catch (err: any) {
      console.error("[course-setup] Onboarding configuration failed:", err.message);
      ctx.results.warnings!.push(`Onboarding config: ${err.message}`);
    }

    // 6. Enroll students (emails + cohorts + individual callers)
    const hasStudents =
      (ctx.input.studentEmails?.length ?? 0) > 0 ||
      (ctx.input.cohortGroupIds?.length ?? 0) > 0 ||
      (ctx.input.selectedCallerIds?.length ?? 0) > 0;
    if (hasStudents) {
      try {
        ctx.onProgress({ phase: "enrollment", message: "Enrolling students..." });
        await stepExecutors.invite_students(ctx, step);
      } catch (err: any) {
        console.error("[course-setup] Student enrollment failed:", err.message);
        ctx.results.warnings!.push(`Enrollment: ${err.message}`);
      }
    }
  },

  configure_onboarding: async (ctx) => {
    const domainId = ctx.results.domainId!;

    // Load identity spec (created during scaffold)
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        onboardingIdentitySpecId: true,
        onboardingDefaultTargets: true,
        playbooks: { where: { status: "PUBLISHED" }, take: 1, select: { id: true } },
      },
    });

    // Build onboarding default targets in structured format: { value, confidence }
    // Runtime (targets.ts) expects this shape for first-call default injection
    const existingTargets = (domain?.onboardingDefaultTargets as Record<string, any>) || {};
    const wrappedNewTargets: Record<string, { value: number; confidence: number }> = {};
    if (ctx.input.behaviorTargets) {
      for (const [paramId, value] of Object.entries(ctx.input.behaviorTargets)) {
        wrappedNewTargets[paramId] = { value, confidence: 0.5 };
      }
    }
    const mergedForDomain = Object.keys(wrappedNewTargets).length > 0
      ? { ...existingTargets, ...wrappedNewTargets }
      : existingTargets;

    // Resolve flow phases: prefer user-edited phases, fall back to persona defaults
    const customPhases = ctx.input.onboardingFlowPhases;
    const resolvedFlowPhases = customPhases && customPhases.length > 0
      ? { phases: customPhases }
      : await loadPersonaFlowPhases(ctx.input.teachingStyle);

    // Resolve welcome message: prefer user-provided, fall back to persona template
    const resolvedWelcome = ctx.input.welcomeMessage
      || await loadPersonaWelcomeTemplate(ctx.input.teachingStyle)
      || null;

    // Update onboarding config
    await prisma.domain.update({
      where: { id: domainId },
      data: {
        onboardingWelcome: resolvedWelcome,
        onboardingFlowPhases: resolvedFlowPhases,
        ...(Object.keys(mergedForDomain).length > 0 && {
          onboardingDefaultTargets: mergedForDomain,
        }),
      },
    });

    // Also create PLAYBOOK-scoped BehaviorTarget rows so values are visible in PlaybookBuilder
    // applyBehaviorTargets expects flat Record<string, number>, not the structured format
    const playbookId = domain?.playbooks?.[0]?.id;
    if (playbookId && ctx.input.behaviorTargets && Object.keys(ctx.input.behaviorTargets).length > 0) {
      await applyBehaviorTargets(playbookId, ctx.input.behaviorTargets);
    }
  },

  invite_students: async (ctx) => {
    const domainId = ctx.results.domainId!;
    const playbookId = ctx.results.playbookId;
    let invitationCount = 0;

    // 1. Link cohort groups to the playbook (if selected)
    if (ctx.input.cohortGroupIds && ctx.input.cohortGroupIds.length > 0 && playbookId) {
      for (const cohortId of ctx.input.cohortGroupIds) {
        try {
          await prisma.cohortPlaybook.upsert({
            where: { cohortGroupId_playbookId: { cohortGroupId: cohortId, playbookId } },
            update: {},
            create: {
              cohortGroupId: cohortId,
              playbookId,
              assignedBy: "course-setup",
            },
          });
        } catch (err) {
          ctx.results.warnings!.push(`Failed to link cohort ${cohortId}: ${err}`);
        }
      }
    }

    // 2. Enroll individual callers (if selected)
    if (ctx.input.selectedCallerIds && ctx.input.selectedCallerIds.length > 0) {
      for (const callerId of ctx.input.selectedCallerIds) {
        try {
          if (playbookId) {
            await enrollCaller(callerId, playbookId, "course-setup");
          } else {
            await enrollCallerInDomainPlaybooks(callerId, domainId);
          }
          invitationCount++;
        } catch (err) {
          ctx.results.warnings!.push(`Failed to enroll caller ${callerId}: ${err}`);
        }
      }
    }

    // 3. Email invites (existing flow)
    if (ctx.input.studentEmails && ctx.input.studentEmails.length > 0) {
      for (const email of ctx.input.studentEmails) {
        try {
          const existing = await prisma.invite.findFirst({
            where: { email, domainId },
          });

          if (!existing) {
            await prisma.invite.create({
              data: {
                email,
                domainId,
                role: "STUDENT",
                callerRole: "LEARNER",
                createdBy: ctx.userId,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                ...(playbookId ? { playbookId } : {}),
                ...(ctx.input.cohortGroupIds?.[0] ? { cohortGroupId: ctx.input.cohortGroupIds[0] } : {}),
              },
            });
            invitationCount++;
          }
        } catch (err) {
          ctx.results.warnings!.push(`Failed to invite ${email}: ${err}`);
        }
      }
    }

    ctx.results.invitationCount = invitationCount;
  },
};

// ── Main Executor ──────────────────────────────────────

/**
 * Execute Course Setup — spec-driven orchestration.
 */
export async function courseSetup(
  input: CourseSetupInput,
  userId: string,
  taskId: string,
  onProgress: ProgressCallback
): Promise<CourseSetupResult> {
  try {
    const steps = await loadCourseSetupSteps();

    const ctx: CourseSetupContext = {
      input,
      userId,
      results: { warnings: [] },
      onProgress,
    };

    onProgress({
      phase: "init",
      message: `Starting Course Setup (${steps.length} steps)...`,
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
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: steps.length,
        });
      } catch (err: any) {
        console.error(`[course-setup] Step "${step.id}" failed:`, err.message);

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

      // Update task progress after each step
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
      message: "Course Setup complete!",
      totalSteps: steps.length,
    });

    // Store completion summary in task context (available to UI via useTaskPoll)
    await updateTaskProgress(taskId, {
      context: {
        summary: {
          domain: { id: ctx.results.domainId, name: ctx.results.domainName, slug: ctx.results.domainSlug, institutionId: ctx.results.institutionId },
          playbook: { id: ctx.results.playbookId, name: ctx.results.playbookName },
          contentSpecId: ctx.results.contentSpecId || null,
          curriculumId: ctx.results.curriculumId || null,
          invitationCount: ctx.results.invitationCount || 0,
          warnings: ctx.results.warnings || [],
        },
      },
    });

    // Complete the task
    await completeTask(taskId);

    return {
      domainId: ctx.results.domainId!,
      domainName: ctx.results.domainName!,
      domainSlug: ctx.results.domainSlug!,
      institutionId: ctx.results.institutionId,
      playbookId: ctx.results.playbookId!,
      playbookName: ctx.results.playbookName!,
      contentSpecId: ctx.results.contentSpecId,
      curriculumId: ctx.results.curriculumId,
      invitationCount: ctx.results.invitationCount || 0,
      warnings: ctx.results.warnings || [],
    };
  } catch (error: any) {
    logSystem("course-setup", {
      level: "error",
      message: `Fatal error: ${error.message}`,
    });
    await failTask(taskId, error.message);
    throw error;
  }
}
