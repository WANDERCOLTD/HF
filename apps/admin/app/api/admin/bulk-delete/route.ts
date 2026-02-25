import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { auditLog, AuditAction } from "@/lib/audit";
import {
  getPreviewFn,
  getExecuteFn,
  getSyncLimit,
  type EntityType,
} from "@/lib/admin/bulk-delete";

const VALID_TYPES: EntityType[] = ["caller", "playbook", "domain", "subject"];

/**
 * @api POST /api/admin/bulk-delete
 * @visibility internal
 * @scope admin:write
 * @auth session (ADMIN+)
 * @tags admin, bulk-delete
 * @description Execute synchronous bulk delete for small batches.
 *   Rejects if over sync threshold — use /api/admin/bulk-delete/job instead.
 * @body entityType string - "caller" | "playbook" | "domain" | "subject"
 * @body entityIds string[] - Array of entity UUIDs to delete
 * @response 200 { ok: true, result: BulkDeleteResult }
 * @response 400 { ok: false, error: "...", useBackground?: true }
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

    // Check sync threshold
    const syncLimit = getSyncLimit(entityType);
    if (entityIds.length > syncLimit) {
      return NextResponse.json(
        {
          ok: false,
          error: `Too many items for sync delete (${entityIds.length} > ${syncLimit}). Use background job.`,
          useBackground: true,
        },
        { status: 400 }
      );
    }

    // Run preview to check for recommended background
    const previewFn = getPreviewFn(entityType);
    const preview = await previewFn(entityIds);

    if (preview.recommendBackground) {
      return NextResponse.json(
        {
          ok: false,
          error: "Operation too large for sync delete. Use background job.",
          useBackground: true,
          preview,
        },
        { status: 400 }
      );
    }

    // Filter to only deletable IDs
    const deletableIds = preview.items.filter((i) => i.canDelete).map((i) => i.id);
    if (deletableIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No items can be deleted", blocked: preview.blocked },
        { status: 400 }
      );
    }

    // Execute
    const executeFn = getExecuteFn(entityType);
    const result = await executeFn(deletableIds);

    // Audit
    const auditAction = {
      caller: AuditAction.BULK_DELETED_CALLERS,
      playbook: AuditAction.BULK_DELETED_PLAYBOOKS,
      domain: AuditAction.BULK_DEACTIVATED_DOMAINS,
      subject: AuditAction.BULK_DELETED_SUBJECTS,
    }[entityType];

    await auditLog({
      userId: authResult.session.user.id,
      userEmail: authResult.session.user.email ?? undefined,
      action: auditAction,
      metadata: {
        entityIds: deletableIds,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
        failedItems: result.failed,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("Bulk delete error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Bulk delete failed" },
      { status: 500 }
    );
  }
}
