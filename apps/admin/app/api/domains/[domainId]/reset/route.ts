/**
 * Domain Reset API
 *
 * Purges all child data for a domain and optionally re-seeds with demo data.
 * Dev/admin tool — requires ADMIN auth.
 *
 * GET  — Preview what will be deleted (counts)
 * POST — Execute purge + optional re-seed
 *
 * @api GET /api/domains/:domainId/reset
 * @visibility internal
 * @scope domains:admin
 * @auth session (ADMIN)
 * @tags domains, admin
 * @pathParam domainId string - Domain UUID
 * @response 200 { ok: true, preview: DomainResetPreview }
 * @response 404 { ok: false, error: "Domain not found" }
 *
 * @api POST /api/domains/:domainId/reset
 * @visibility internal
 * @scope domains:admin
 * @auth session (ADMIN)
 * @tags domains, admin
 * @pathParam domainId string - Domain UUID
 * @response 200 { ok: true, result: DomainResetResult }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { previewDomainReset, executeDomainReset, type ResetMode } from "@/lib/admin/domain-reset";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const preview = await previewDomainReset(domainId);

    if (!preview) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    console.error("[domain-reset] GET error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to preview domain reset" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const body = await request.json().catch(() => ({}));
    const validModes: ResetMode[] = ["delete_courses", "reset_courses", "everything"];
    const mode: ResetMode = validModes.includes(body.mode) ? body.mode : "delete_courses";
    const result = await executeDomainReset(domainId, mode);

    if (!result) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[domain-reset] POST error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to reset domain" },
      { status: 500 }
    );
  }
}
