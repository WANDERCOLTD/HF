/**
 * Task Guidance & Flash Sidebar Context
 *
 * Provides AI with context about what task the user is working on,
 * and enables intelligent task guidance through flash sidebars.
 *
 * The "flash sidebar" appears contextually to guide users through complex tasks.
 */

import { prisma } from "@/lib/prisma";

// ============================================================================
// TYPES
// ============================================================================

export interface TaskContext {
  taskId: string;
  taskType: string;        // 'create_spec', 'configure_caller', 'setup_goal', etc.
  status: string;          // 'in_progress', 'completed', 'abandoned'
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
  stepDescription: string;
  completedSteps: string[];
  blockers?: string[];     // What's preventing progress
  userIntent?: string;     // What user is trying to accomplish
  context?: Record<string, any>; // Raw task context (progress messages, skeleton modules, etc.)
}

export interface TaskGuidance {
  task: TaskContext;
  suggestions: GuidanceSuggestion[];
  nextActions: NextAction[];
  warnings?: string[];
}

export interface GuidanceSuggestion {
  type: "tip" | "warning" | "shortcut" | "best-practice";
  message: string;
  action?: {
    label: string;
    handler: string; // Function name to call
  };
}

export interface NextAction {
  label: string;
  description: string;
  priority: "high" | "medium" | "low";
  estimated: string; // "2 min", "Quick", etc.
}

export interface FlashSidebarContent {
  visible: boolean;
  title: string;
  content: string;
  actions?: Array<{
    label: string;
    variant: "primary" | "secondary" | "danger";
    onClick: string; // Function name
  }>;
  progress?: {
    current: number;
    total: number;
  };
}

// ============================================================================
// TASK TRACKING
// ============================================================================

/**
 * Start tracking a task for guidance.
 *
 * @param initialCurrentStep — defaults to 1 (execution phase). Pass 0 for
 *   wizard-phase tasks that haven't started background execution yet.
 */
export async function startTaskTracking(
  userId: string,
  taskType: string,
  context?: Record<string, any>,
  initialCurrentStep?: number
): Promise<string> {
  const task = await prisma.userTask.create({
    data: {
      userId,
      taskType,
      status: "in_progress",
      currentStep: initialCurrentStep ?? 1,
      totalSteps: getTaskStepCount(taskType),
      context: context as any,
      startedAt: new Date(),
    },
  });

  return task.id;
}

/**
 * Update task progress.
 * Context is deep-merged (top-level keys) so callers can update
 * individual fields without losing the rest of the saved state.
 */
export async function updateTaskProgress(
  taskId: string,
  updates: {
    currentStep?: number;
    completedSteps?: string[];
    blockers?: string[];
    context?: Record<string, any>;
  }
): Promise<void> {
  // Build the data payload, only setting fields that were provided
  const data: Record<string, any> = { updatedAt: new Date() };
  if (updates.currentStep !== undefined) data.currentStep = updates.currentStep;
  if (updates.completedSteps !== undefined) data.completedSteps = updates.completedSteps;
  if (updates.blockers !== undefined) data.blockers = updates.blockers;

  // Deep-merge context atomically to avoid race conditions
  // (concurrent calls like autosave + extraction progress could lose data)
  if (updates.context !== undefined) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.userTask.findUnique({
        where: { id: taskId },
        select: { context: true },
      });
      const existingCtx = (existing?.context as Record<string, any>) ?? {};
      data.context = { ...existingCtx, ...updates.context };
      await tx.userTask.update({ where: { id: taskId }, data });
    });
    return;
  }

  await prisma.userTask.update({
    where: { id: taskId },
    data,
  });
}

/**
 * Complete a task.
 */
export async function completeTask(taskId: string): Promise<void> {
  await prisma.userTask.update({
    where: { id: taskId },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });
}

/**
 * Mark a task as failed/abandoned. Sets terminal status + records error in context.
 * Use this in every error handler instead of manually writing prisma.userTask.update().
 */
export async function failTask(taskId: string, error: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.userTask.findUnique({
        where: { id: taskId },
        select: { context: true },
      });
      const existingCtx = (existing?.context as Record<string, any>) ?? {};
      await tx.userTask.update({
        where: { id: taskId },
        data: {
          status: "abandoned",
          completedAt: new Date(),
          context: { ...existingCtx, error },
        },
      });
    });
  } catch (err) {
    console.error(`[failTask] Could not record failure for task ${taskId}:`, err);
  }
}

/**
 * Wrap a fire-and-forget async function so errors always call failTask().
 *
 * Use this instead of `fn().catch(console.error)` for any background job
 * that has a UserTask. Guarantees the task reaches a terminal state on error.
 *
 * @example
 *   backgroundRun(taskId, () => runMyLongJob(taskId, ...args));
 */
export function backgroundRun(taskId: string, fn: () => Promise<void>): void {
  fn().catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backgroundRun] Task ${taskId} failed:`, err);
    await failTask(taskId, message);
  });
}

// ============================================================================
// GUIDANCE GENERATION
// ============================================================================

/**
 * Get AI-powered guidance for current task.
 * This uses accumulated knowledge to provide smart suggestions.
 */
export async function getTaskGuidance(taskId: string): Promise<TaskGuidance> {
  const task = await prisma.userTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const taskContext: TaskContext = {
    taskId: task.id,
    taskType: task.taskType,
    status: task.status,
    currentStep: task.currentStep,
    totalSteps: task.totalSteps,
    stepTitle: getStepTitle(task.taskType, task.currentStep),
    stepDescription: getStepDescription(task.taskType, task.currentStep),
    completedSteps: (task.completedSteps as string[]) || [],
    blockers: (task.blockers as string[]) || undefined,
    userIntent: (task.context as any)?.intent,
    context: (task.context as Record<string, any>) || undefined,
  };

  // Generate suggestions based on task type and current step
  const suggestions = await generateSuggestions(taskContext);
  const nextActions = await generateNextActions(taskContext);
  const warnings = await detectWarnings(taskContext);

  return {
    task: taskContext,
    suggestions,
    nextActions,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Generate contextual suggestions for the current task step.
 */
async function generateSuggestions(task: TaskContext): Promise<GuidanceSuggestion[]> {
  const suggestions: GuidanceSuggestion[] = [];

  // Task-specific suggestions
  switch (task.taskType) {
    case "create_spec":
      if (task.currentStep === 1) {
        suggestions.push({
          type: "tip",
          message: "Use the AI assistant to auto-fill fields - just describe what you want to measure",
          action: {
            label: "Try AI Assistant",
            handler: "focusAIInput",
          },
        });
      }
      if (task.currentStep === 3) {
        suggestions.push({
          type: "best-practice",
          message: "Write user stories from the AI's perspective, not the end user's",
        });
      }
      break;

    case "configure_caller":
      suggestions.push({
        type: "shortcut",
        message: "Press ⌘K to quickly search and set parameters",
        action: {
          label: "Open Command Palette",
          handler: "openCommandPalette",
        },
      });
      break;

    case "extraction":
      suggestions.push({
        type: "tip",
        message: "You can continue working while extraction runs in the background",
      });
      break;

    case "curriculum_generation":
      suggestions.push({
        type: "tip",
        message: "Curriculum generation runs in the background — you'll be notified when it's ready to review",
      });
      break;

    case "curriculum_enrichment":
      suggestions.push({
        type: "tip",
        message: "Your curriculum skeleton is already usable. Full detail (learning outcomes, assessment criteria) is being added in the background.",
      });
      break;

    case "content_wizard":
      if (task.currentStep === 1) {
        suggestions.push({
          type: "tip",
          message: "Create a new content source or upload PDF, TXT, or MD documents",
        });
      }
      if (task.currentStep === 2) {
        suggestions.push({
          type: "tip",
          message: "The AI is extracting teaching points from your document — this usually takes 1-3 minutes",
        });
      }
      if (task.currentStep === 4) {
        suggestions.push({
          type: "best-practice",
          message: "Pick a template or enter a custom session count. AI will distribute onboarding, teaching, review, and assessment phases.",
        });
      }
      break;

    case "course_setup":
      if (task.currentStep === 1) {
        suggestions.push({
          type: "tip",
          message: "Enter your course name, learning outcomes, and preferred teaching style",
        });
      }
      if (task.currentStep === 5) {
        suggestions.push({
          type: "tip",
          message: "Student invitations are being sent — they'll receive an email with signup instructions",
        });
      }
      break;
  }

  // Check for common blockers
  if (task.blockers && task.blockers.length > 0) {
    suggestions.push({
      type: "warning",
      message: `You have ${task.blockers.length} blocker(s) - would you like help resolving them?`,
      action: {
        label: "Get Help",
        handler: "showBlockerHelp",
      },
    });
  }

  return suggestions;
}

/**
 * Generate next action recommendations.
 */
async function generateNextActions(task: TaskContext): Promise<NextAction[]> {
  const actions: NextAction[] = [];

  const stepMap = TASK_STEP_MAPS[task.taskType];
  if (!stepMap) return actions;

  // Next step
  if (task.currentStep < task.totalSteps) {
    const nextStep = stepMap[task.currentStep];
    actions.push({
      label: nextStep.title,
      description: nextStep.description,
      priority: "high",
      estimated: nextStep.estimated || "5 min",
    });
  }

  // Optional enhancements
  if (task.taskType === "create_spec" && task.currentStep >= 3) {
    actions.push({
      label: "Add scoring anchors",
      description: "Provide example conversations at different score levels",
      priority: "medium",
      estimated: "10 min",
    });
  }

  // Completion
  if (task.currentStep === task.totalSteps) {
    if (task.taskType === "curriculum_generation") {
      actions.push({
        label: "Review Curriculum",
        description: "Review the generated curriculum and save or regenerate",
        priority: "high",
        estimated: "2 min",
      });
    } else if (task.taskType === "extraction") {
      actions.push({
        label: "View Assertions",
        description: "Review the extracted teaching points",
        priority: "high",
        estimated: "Quick",
      });
    } else {
      actions.push({
        label: "Create & Activate",
        description: "Finish creating your spec and make it active",
        priority: "high",
        estimated: "Quick",
      });
    }
  }

  return actions;
}

/**
 * Detect warnings or issues with current task state.
 */
async function detectWarnings(task: TaskContext): Promise<string[]> {
  const warnings: string[] = [];

  // Check for stalled tasks
  const taskRecord = await prisma.userTask.findUnique({
    where: { id: task.taskId },
    select: { updatedAt: true },
  });

  if (taskRecord) {
    const timeSinceUpdate = Date.now() - taskRecord.updatedAt.getTime();
    const minutesSinceUpdate = timeSinceUpdate / (1000 * 60);

    if (minutesSinceUpdate > 30) {
      warnings.push("You've been on this step for a while - need help?");
    }
  }

  return warnings;
}

// ============================================================================
// FLASH SIDEBAR GENERATION
// ============================================================================

/**
 * Generate flash sidebar content for current task.
 * This creates the contextual help sidebar that appears.
 */
export async function generateFlashSidebar(
  taskId: string
): Promise<FlashSidebarContent> {
  const guidance = await getTaskGuidance(taskId);

  return {
    visible: true,
    title: guidance.task.stepTitle,
    content: formatSidebarContent(guidance),
    actions: formatSidebarActions(guidance),
    progress: {
      current: guidance.task.currentStep,
      total: guidance.task.totalSteps,
    },
  };
}

function formatSidebarContent(guidance: TaskGuidance): string {
  let content = `**Step ${guidance.task.currentStep} of ${guidance.task.totalSteps}**\n\n`;
  content += `${guidance.task.stepDescription}\n\n`;

  if (guidance.suggestions.length > 0) {
    content += "### Tips\n";
    guidance.suggestions.forEach((s) => {
      const icon = s.type === "warning" ? "⚠️" : s.type === "tip" ? "💡" : "✨";
      content += `${icon} ${s.message}\n`;
    });
    content += "\n";
  }

  if (guidance.nextActions.length > 0) {
    content += "### Next Steps\n";
    guidance.nextActions.forEach((a, i) => {
      content += `${i + 1}. **${a.label}** (${a.estimated})\n`;
      content += `   ${a.description}\n`;
    });
  }

  return content;
}

function formatSidebarActions(guidance: TaskGuidance): FlashSidebarContent["actions"] {
  const actions: NonNullable<FlashSidebarContent["actions"]> = [];

  // Primary action - next step
  if (guidance.nextActions.length > 0) {
    const primary = guidance.nextActions[0];
    actions.push({
      label: primary.label,
      variant: "primary",
      onClick: `handleNextAction('${primary.label}')`,
    });
  }

  // Secondary actions from suggestions
  guidance.suggestions.forEach((s) => {
    if (s.action) {
      actions.push({
        label: s.action.label,
        variant: "secondary",
        onClick: s.action.handler,
      });
    }
  });

  return actions.length > 0 ? actions : undefined;
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

interface TaskStep {
  title: string;
  description: string;
  estimated?: string;
}

const TASK_STEP_MAPS: Record<string, Record<number, TaskStep>> = {
  create_spec: {
    1: {
      title: "Basic Information",
      description: "Define the core identity: ID, title, domain, and classification",
      estimated: "2 min",
    },
    2: {
      title: "User Story",
      description: "Explain what this spec does and why it's needed",
      estimated: "3 min",
    },
    3: {
      title: "Parameters",
      description: "Define what this spec measures or tracks",
      estimated: "5 min",
    },
    4: {
      title: "Review & Create",
      description: "Review your spec and activate it",
      estimated: "1 min",
    },
  },
  configure_caller: {
    1: {
      title: "Caller Profile",
      description: "Set up basic caller information",
      estimated: "2 min",
    },
    2: {
      title: "Personality Settings",
      description: "Configure personality parameters and targets",
      estimated: "5 min",
    },
    3: {
      title: "Goals & Learning",
      description: "Set up caller goals and learning paths",
      estimated: "5 min",
    },
  },
  quick_launch: {
    1: {
      title: "Form",
      description: "Enter subject, style, goals, and upload course material",
      estimated: "2 min",
    },
    2: {
      title: "Analysis",
      description: "AI is extracting content and generating your tutor identity",
      estimated: "1-3 min",
    },
    3: {
      title: "Review",
      description: "Review and edit what AI created before finalizing",
      estimated: "2 min",
    },
    4: {
      title: "Create",
      description: "Building your tutor domain, curriculum, and test caller",
      estimated: "30 sec",
    },
  },
  extraction: {
    1: {
      title: "Extracting",
      description: "AI is reading your document and extracting teaching points",
      estimated: "1-3 min",
    },
    2: {
      title: "Saving",
      description: "Importing extracted assertions to database",
      estimated: "30 sec",
    },
  },
  curriculum_generation: {
    1: {
      title: "Loading",
      description: "Loading assertions from all sources",
      estimated: "10 sec",
    },
    2: {
      title: "Generating",
      description: "AI is structuring your curriculum into modules and learning outcomes",
      estimated: "1-3 min",
    },
    3: {
      title: "Complete",
      description: "Curriculum ready for review",
    },
  },
  curriculum_enrichment: {
    1: {
      title: "Generating Detail",
      description: "AI is adding learning outcomes, assessment criteria, and key terms",
      estimated: "30-60 sec",
    },
    2: {
      title: "Updating",
      description: "Patching curriculum with full detail",
      estimated: "5 sec",
    },
    3: {
      title: "Complete",
      description: "Curriculum enrichment complete",
    },
  },
  content_wizard: {
    1: {
      title: "Add Source",
      description: "Create or upload a content source document",
      estimated: "2 min",
    },
    2: {
      title: "Extract",
      description: "AI extracts teaching points from your documents",
      estimated: "1-3 min",
    },
    3: {
      title: "Review",
      description: "Review and approve extracted teaching points",
      estimated: "2 min",
    },
    4: {
      title: "Plan Lessons",
      description: "Set session count and generate a lesson plan",
      estimated: "2 min",
    },
    5: {
      title: "Onboard",
      description: "Configure domain and first-call onboarding",
      estimated: "2 min",
    },
    6: {
      title: "Preview",
      description: "Preview the AI tutor's first prompt",
      estimated: "1 min",
    },
    7: {
      title: "Done",
      description: "Review summary and check course readiness",
      estimated: "1 min",
    },
  },
  course_setup: {
    1: {
      title: "Setting up course",
      description: "Creating institution and subject",
      estimated: "30 sec",
    },
    2: {
      title: "Building curriculum",
      description: "Generating lesson structure",
      estimated: "1-2 min",
    },
    3: {
      title: "Configuring AI tutor",
      description: "Scaffolding identity and playbook",
      estimated: "30 sec",
    },
    4: {
      title: "Configuring onboarding",
      description: "Welcome message and flow phases",
      estimated: "10 sec",
    },
    5: {
      title: "Inviting students",
      description: "Sending student invitations",
      estimated: "30 sec",
    },
  },
  classroom_setup: {
    1: {
      title: "Name & Focus",
      description: "Set classroom name, description, and institution",
      estimated: "1 min",
    },
    2: {
      title: "Courses",
      description: "Select courses to include in the classroom",
      estimated: "1 min",
    },
    3: {
      title: "Review",
      description: "Review and create the classroom",
      estimated: "30 sec",
    },
    4: {
      title: "Invite",
      description: "Invite students with a join link",
      estimated: "1 min",
    },
  },
  snapshot_take: {
    1: {
      title: "Exporting",
      description: "Reading database tables and exporting data",
      estimated: "30 sec - 2 min",
    },
    2: {
      title: "Writing",
      description: "Saving snapshot file to disk",
      estimated: "5 sec",
    },
  },
  snapshot_restore: {
    1: {
      title: "Validating",
      description: "Checking snapshot file integrity",
    },
    2: {
      title: "Clearing",
      description: "Removing existing data from affected tables",
      estimated: "30 sec",
    },
    3: {
      title: "Restoring",
      description: "Inserting snapshot data into database",
      estimated: "1-3 min",
    },
    4: {
      title: "Complete",
      description: "Database restored successfully",
    },
  },
  bulk_delete: {
    1: {
      title: "Validating",
      description: "Checking entity relationships and permissions",
      estimated: "5 sec",
    },
    2: {
      title: "Deleting",
      description: "Removing entities and cleaning up references",
      estimated: "10 sec - 5 min",
    },
    3: {
      title: "Complete",
      description: "Bulk delete finished",
    },
  },
};

function getTaskStepCount(taskType: string): number {
  return Object.keys(TASK_STEP_MAPS[taskType] || {}).length || 5;
}

function getStepTitle(taskType: string, step: number): string {
  return TASK_STEP_MAPS[taskType]?.[step]?.title || `Step ${step}`;
}

function getStepDescription(taskType: string, step: number): string {
  return TASK_STEP_MAPS[taskType]?.[step]?.description || "";
}

// ============================================================================
// CONTEXT INJECTION
// ============================================================================

/**
 * Format task context for injection into AI prompts.
 * Use this to make AI aware of what user is currently doing.
 */
export function formatTaskContext(task: TaskContext): string {
  let text = "\n## Current User Task\n\n";
  text += `**Task**: ${task.taskType.replace(/_/g, " ")}\n`;
  text += `**Progress**: Step ${task.currentStep} of ${task.totalSteps}\n`;
  text += `**Current Step**: ${task.stepTitle}\n`;

  if (task.completedSteps.length > 0) {
    text += `**Completed**: ${task.completedSteps.join(", ")}\n`;
  }

  if (task.blockers && task.blockers.length > 0) {
    text += `**Blockers**: ${task.blockers.join(", ")}\n`;
  }

  if (task.userIntent) {
    text += `**User Intent**: ${task.userIntent}\n`;
  }

  return text;
}
