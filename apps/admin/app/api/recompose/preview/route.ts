/**
 * Preview endpoint for the pending-changes tray (epic #854).
 *
 * Returns the count of callers that a full fan-out recompose would touch,
 * a small first-name sample, and a coarse ETA. Backed by a 30s in-memory
 * cache keyed by `(scope, scopeId)` — the tray hits this on open + on each
 * entry push (debounced client-side at 500ms per Story #856 / A2), so the
 * cache absorbs rapid bursts without N+1 join traversal.
 *
 * No cache invalidation in v1 — the 30s TTL is tight enough that fresh
 * enrollments / status flips appear within a tray refresh. If the
 * denormalised counter from #860 lands, this route flips to read-from-row
 * and the cache becomes redundant for playbook + domain scopes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  previewRecomposeFanout,
  type RecomposePreviewScope,
  type RecomposePreview,
} from "@/lib/recompose/preview";

export const runtime = "nodejs";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  preview: RecomposePreview;
  fetchedAt: number;
}

// Module-scoped Map — survives across requests within the same Node process.
// Next.js dev-mode HMR resets this on file change, which is fine for v1.
const previewCache = new Map<string, CacheEntry>();

function cacheKey(scope: RecomposePreviewScope, scopeId: string | null): string {
  return `${scope}:${scopeId ?? ""}`;
}

function isValidScope(value: string | null): value is RecomposePreviewScope {
  return value === "playbook" || value === "domain" || value === "system";
}

/**
 * @api GET /api/recompose/preview?scope=playbook|domain|system&scopeId=<uuid>
 * @visibility internal
 * @scope recompose:read
 * @auth session OPERATOR
 * @tags recompose, preview
 * @description Returns `{ count, sampleNames[3], etaSeconds, cacheHit, source }`
 *   for the pending-changes tray. SYSTEM scope ignores `scopeId`.
 * @queryParam scope playbook|domain|system
 * @queryParam scopeId? UUID — required for playbook + domain scopes
 * @response 200 RecomposePreview
 * @response 400 { ok: false, error } when scope is invalid
 * @response 401/403 via requireAuth
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const scopeId = searchParams.get("scopeId");

    if (!isValidScope(scope)) {
      return NextResponse.json(
        {
          ok: false,
          error: `invalid scope "${scope ?? ""}" — must be playbook|domain|system`,
        },
        { status: 400 },
      );
    }

    const key = cacheKey(scope, scopeId);
    const now = Date.now();
    const cached = previewCache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached.preview, cacheHit: true });
    }

    const preview = await previewRecomposeFanout(scope, scopeId);
    previewCache.set(key, { preview, fetchedAt: now });

    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/recompose/preview] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
