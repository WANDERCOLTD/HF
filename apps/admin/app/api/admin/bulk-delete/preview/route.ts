import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getPreviewFn, type EntityType } from "@/lib/admin/bulk-delete";

const VALID_TYPES: EntityType[] = ["caller", "playbook", "domain", "subject"];
const MAX_IDS = 100;

/**
 * @api POST /api/admin/bulk-delete/preview
 * @visibility internal
 * @scope admin:write
 * @auth session (ADMIN+)
 * @tags admin, bulk-delete
 * @description Preview cascade impact for bulk delete. Returns per-entity counts
 *   of affected records, blocked items, and whether to use background job.
 * @body entityType string - "caller" | "playbook" | "domain" | "subject"
 * @body entityIds string[] - Array of entity UUIDs to preview (max 100)
 * @response 200 { ok: true, preview: BulkDeletePreview }
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

    const previewFn = getPreviewFn(entityType);
    const preview = await previewFn(entityIds);

    return NextResponse.json({ ok: true, preview });
  } catch (error: any) {
    console.error("Bulk delete preview error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Preview failed" },
      { status: 500 }
    );
  }
}
