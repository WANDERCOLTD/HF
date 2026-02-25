import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { auditLog, AuditAction } from "@/lib/audit";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  backgroundRun,
} from "@/lib/ai/task-guidance";
import {
  getPreviewFn,
  getExecuteFn,
  type EntityType,
} from "@/lib/admin/bulk-delete";

const VALID_TYPES: EntityType[] = ["caller", "playbook", "domain", "subject"];
const MAX_IDS = 100;

/**
 * @api POST /api/admin/bulk-delete/job
 * @visibility internal
 * @scope admin:write
 * @auth session (ADMIN+)
 * @tags admin, bulk-delete
 * @description Start a background bulk delete job. Returns taskId for polling.
 *   Use when batch is too large for sync delete.
 * @body entityType string - "caller" | "playbook" | "domain" | "subject"
 * @body entityIds string[] - Array of entity UUIDs to delete (max 100)
 * @response 200 { ok: true, taskId: string }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const { entityType, entityIds } = body;

    if (!entityType || !VALID_TYPES.includes(entityType)) {
      return NextResponse.json(
        { ok: false, error: `Invalid entityType. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "entityIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (entityIds.length > MAX_IDS) {
      return NextResponse.json(
        { ok: false, error: `Too many IDs. Maximum ${MAX_IDS} per request.` },
        { status: 400 }
      );
    }

    // Preview first to filter deletable items
    const previewFn = getPreviewFn(entityType);
    const preview = await previewFn(entityIds);
    const deletableIds = preview.items.filter((i) => i.canDelete).map((i) => i.id);

    if (deletableIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No items can be deleted", blocked: preview.blocked },
        { status: 400 }
      );
    }

    const userId = authResult.session.user.id;
    const userEmail = authResult.session.user.email ?? undefined;

    // Create task
    const taskId = await startTaskTracking(userId, "bulk_delete", {
      entityType,
      entityIds: deletableIds,
      totalCount: deletableIds.length,
      deletedCount: 0,
      failedCount: 0,
      blocked: preview.blocked,
    });

    // Fire-and-forget
    backgroundRun(taskId, async () => {
      // Step 1: Validating
      await updateTaskProgress(taskId, {
        currentStep: 1,
        context: { phase: "validating" },
      });

      // Step 2: Deleting
      await updateTaskProgress(taskId, {
        currentStep: 2,
        context: { phase: "deleting" },
      });

      const executeFn = getExecuteFn(entityType);
      const result = await executeFn(deletableIds, async (completed, total, current) => {
        await updateTaskProgress(taskId, {
          context: {
            deletedCount: completed,
            totalCount: total,
            currentEntity: current,
          },
        });
      });

      // Step 3: Complete
      await updateTaskProgress(taskId, {
        currentStep: 3,
        context: {
          phase: "complete",
          deletedCount: result.totalDeleted,
          failedCount: result.totalFailed,
          succeeded: result.succeeded.map((s) => ({ id: s.id, name: s.name })),
          failedItems: result.failed,
        },
      });

      await completeTask(taskId);

      // Audit
      const auditAction = {
        caller: AuditAction.BULK_DELETED_CALLERS,
        playbook: AuditAction.BULK_DELETED_PLAYBOOKS,
        domain: AuditAction.BULK_DEACTIVATED_DOMAINS,
        subject: AuditAction.BULK_DELETED_SUBJECTS,
      }[entityType];

      await auditLog({
        userId,
        userEmail,
        action: auditAction,
        metadata: {
          entityIds: deletableIds,
          succeeded: result.totalDeleted,
          failed: result.totalFailed,
          failedItems: result.failed,
          taskId,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      taskId,
      deletableCount: deletableIds.length,
      blocked: preview.blocked,
    });
  } catch (error: any) {
    console.error("Bulk delete job error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to start bulk delete job" },
      { status: 500 }
    );
  }
}
