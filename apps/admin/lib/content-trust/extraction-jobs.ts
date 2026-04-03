/**
 * Extraction job compatibility wrapper.
 *
 * Previously used an in-memory Map to track extraction jobs.
 * Now delegates to the UserTask system for DB-backed persistence.
 *
 * Callers that still import from this module continue to work,
 * but new code should use startTaskTracking/updateTaskProgress/completeTask
 * from lib/ai/task-guidance.ts directly.
 */

import { prisma } from "@/lib/prisma";
import {
  startTaskTracking,
  updateTaskProgress,
  failTask,
  completeTask,
} from "@/lib/ai/task-guidance";

export type JobStatus = "pending" | "extracting" | "importing" | "done" | "error";

export interface ExtractionJob {
  id: string;
  sourceId: string;
  fileName: string;
  status: JobStatus;
  currentChunk: number;
  totalChunks: number;
  extractedCount: number;
  importedCount?: number;
  duplicatesSkipped?: number;
  warnings: string[];
  error?: string;
  /** Quick-pass preview teaching points (lives in job context only, not DB) */
  quickPreview?: Array<{ text: string; category: string }>;
  quickPreviewCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Map UserTask status + context to the legacy ExtractionJob shape. */
function taskToJob(task: {
  id: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  context: any;
  startedAt: Date;
  updatedAt: Date;
}): ExtractionJob {
  const ctx = (task.context as Record<string, any>) ?? {};
  // Map UserTask status to legacy JobStatus
  let status: JobStatus;
  if (task.status === "completed") {
    status = ctx.error ? "error" : "done";
  } else if (task.status === "abandoned") {
    status = "error";
  } else {
    // in_progress — use step to determine sub-status
    status = task.currentStep >= 2 ? "importing" : "extracting";
  }

  return {
    id: task.id,
    sourceId: ctx.sourceId ?? "",
    fileName: ctx.fileName ?? "",
    status,
    currentChunk: ctx.currentChunk ?? 0,
    totalChunks: ctx.totalChunks ?? task.totalSteps,
    extractedCount: ctx.extractedCount ?? 0,
    importedCount: ctx.importedCount,
    duplicatesSkipped: ctx.duplicatesSkipped,
    warnings: ctx.warnings ?? [],
    error: ctx.error,
    quickPreview: ctx.quickPreview || undefined,
    quickPreviewCount: ctx.quickPreviewCount || 0,
    createdAt: task.startedAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * Create an extraction job. Now creates a UserTask in the DB.
 * Requires userId — pass from requireAuth().session.user.id.
 */
export async function createExtractionTask(
  userId: string,
  sourceId: string,
  fileName: string,
  subjectId?: string,
  subjectName?: string,
  subjectSourceId?: string,
): Promise<ExtractionJob> {
  const taskId = await startTaskTracking(userId, "extraction", {
    sourceId,
    fileName,
    subjectId,
    subjectName,
    subjectSourceId,
    currentChunk: 0,
    totalChunks: 0,
    extractedCount: 0,
    warnings: [],
  });

  const task = await prisma.userTask.findUniqueOrThrow({
    where: { id: taskId },
  });

  return taskToJob(task);
}

/**
 * @deprecated Use createExtractionTask() which accepts userId.
 * Falls back to a system user lookup for backward compat.
 */
export async function createJob(sourceId: string, fileName: string): Promise<ExtractionJob> {
  // Find any admin user as fallback — background jobs triggered without explicit user
  const fallbackUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  const userId = fallbackUser?.id ?? "system";
  return createExtractionTask(userId, sourceId, fileName);
}

/** Get an extraction job by ID. Reads from UserTask. */
export async function getJob(id: string): Promise<ExtractionJob | undefined> {
  const task = await prisma.userTask.findUnique({
    where: { id },
  });
  if (!task || task.taskType !== "extraction") return undefined;
  return taskToJob(task);
}

/** Update extraction job progress. Updates the UserTask context. */
export async function updateJob(id: string, patch: Partial<ExtractionJob>) {
  const contextPatch: Record<string, any> = {};
  if (patch.currentChunk !== undefined) contextPatch.currentChunk = patch.currentChunk;
  if (patch.totalChunks !== undefined) contextPatch.totalChunks = patch.totalChunks;
  if (patch.extractedCount !== undefined) contextPatch.extractedCount = patch.extractedCount;
  if (patch.importedCount !== undefined) contextPatch.importedCount = patch.importedCount;
  if (patch.duplicatesSkipped !== undefined) contextPatch.duplicatesSkipped = patch.duplicatesSkipped;
  if (patch.warnings !== undefined) contextPatch.warnings = patch.warnings;
  if (patch.error !== undefined) contextPatch.error = patch.error;
  if (patch.quickPreview !== undefined) contextPatch.quickPreview = patch.quickPreview;
  if (patch.quickPreviewCount !== undefined) contextPatch.quickPreviewCount = patch.quickPreviewCount;

  // Map legacy status to UserTask step + status
  const updates: {
    currentStep?: number;
    context?: Record<string, any>;
  } = {};

  if (Object.keys(contextPatch).length > 0) {
    updates.context = contextPatch;
  }

  if (patch.status === "importing") {
    updates.currentStep = 2;
  } else if (patch.status === "done") {
    // Read existing context for summary fields
    const task = await prisma.userTask.findUnique({
      where: { id },
      select: { context: true },
    });
    const existingCtx = (task?.context as Record<string, any>) ?? {};
    contextPatch.summary = {
      source: { id: existingCtx.sourceId ?? "", name: existingCtx.fileName ?? "" },
      counts: {
        extracted: contextPatch.extractedCount ?? existingCtx.extractedCount ?? 0,
        imported: contextPatch.importedCount ?? existingCtx.importedCount ?? 0,
        duplicates: contextPatch.duplicatesSkipped ?? existingCtx.duplicatesSkipped ?? 0,
      },
    };
    await updateTaskProgress(id, { context: contextPatch });
    await completeTask(id);
    return;
  } else if (patch.status === "error") {
    // Store error in context, then mark abandoned
    contextPatch.error = patch.error || "Unknown error";
    await updateTaskProgress(id, { context: contextPatch });
    await failTask(id, patch.error || "Unknown error");
    return;
  }

  if (Object.keys(updates).length > 0) {
    await updateTaskProgress(id, updates);
  }
}
