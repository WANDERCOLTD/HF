import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveEffective,
  type ScopeChain,
} from "@/lib/cascade/effective-value";

export const runtime = "nodejs";

/**
 * @api GET /api/cascade/resolve
 * @visibility internal
 * @scope cascade:resolve:read
 * @auth session (OPERATOR)
 * @tags cascade, inspector, epic-1442
 * @description Resolves the effective value of a cascade-eligible knob
 *   against the provided scope chain. Powers `<CascadeInspectorTray>`
 *   and the upcoming Cmd+K cascade tools. Read-only — see
 *   `lib/cascade/set-at-layer.ts` for the write counterpart.
 * @queryParam knobKey    e.g. "BEH-WARMTH" / "welcomeMessage" / "voiceId" (required)
 * @queryParam courseId   scope chain id (optional) — operator-facing alias
 * @queryParam playbookId scope chain id (optional) — synonym of `courseId`
 *                        accepted for back-compat; `courseId` is preferred
 * @queryParam callerId   scope chain id (optional)
 * @queryParam domainId   scope chain id (optional)
 * @response 200 Effective<unknown> envelope: { value, source, layers, isInherited, recommendedLayerForEdit }
 * @response 400 { ok: false, error: "Unknown knob key …" | "Missing required scope …" }
 * @response 403 (returned by requireAuth)
 */
export async function GET(request: Request) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(request.url);
  const knobKey = searchParams.get("knobKey");
  if (!knobKey) {
    return NextResponse.json(
      { ok: false, error: "knobKey is required" },
      { status: 400 },
    );
  }

  const scopeChain: ScopeChain = {};
  // Operators think in courses; the schema layer underneath is Playbook.
  // Accept both — `courseId` takes precedence if both supplied.
  const courseId =
    searchParams.get("courseId") ?? searchParams.get("playbookId");
  const callerId = searchParams.get("callerId");
  const domainId = searchParams.get("domainId");
  if (courseId) scopeChain.playbookId = courseId;
  if (callerId) scopeChain.callerId = callerId;
  if (domainId) scopeChain.domainId = domainId;

  try {
    const envelope = await resolveEffective({ knobKey, scopeChain });
    return NextResponse.json(envelope);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish unknown knob keys from missing-scope params from
    // unexpected internal errors — gives the client a useful 400 vs 500.
    if (/Unknown cascade knob key/.test(message)) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    if (/requires\s+`?\w+`?\s+in\s+scopeChain/.test(message)) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    if (/not found/.test(message)) {
      return NextResponse.json({ ok: false, error: message }, { status: 404 });
    }
    console.error("[api/cascade/resolve] internal error", err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
