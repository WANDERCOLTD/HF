import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  getVoiceCostForCaller,
  getVoiceCostForCohort,
  getVoiceCostForPlaybook,
  getVoiceCostByProviderSystemWide,
} from "@/lib/voice/cost-aggregator";

export const runtime = "nodejs";

const SCOPES = ["caller", "cohort", "playbook", "system"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * @api GET /api/voice/costs
 * @visibility internal
 * @scope voice:costs:read
 * @auth session (OPERATOR for scoped; ADMIN for system-wide)
 * @tags voice, costs, metering
 * @description Returns voice-call cost rollups for a chosen scope. Reads
 *   from Call.voiceCostUsd (denorm snapshot written by the webhook
 *   normaliser). Currency: USD. Default lookback: 30 days; pass `since`
 *   as an ISO timestamp to override.
 * @queryParam scope "caller" | "cohort" | "playbook" | "system" (required)
 * @queryParam id    The matching id for caller/cohort/playbook scope (required for non-system)
 * @queryParam since ISO timestamp (optional; default = 30 days ago)
 * @response 200 { ok: true, summary: VoiceCostSummary }
 * @response 400 { ok: false, error: "scope required" | "id required" }
 * @response 403 { ok: false, error: "system scope requires ADMIN" }
 */
export async function GET(request: Request) {
  // Most scopes admit OPERATOR; system requires ADMIN — start permissive,
  // tighten when scope === "system".
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(request.url);
  const rawScope = searchParams.get("scope");
  const id = searchParams.get("id");
  const sinceRaw = searchParams.get("since");

  if (!rawScope || !SCOPES.includes(rawScope as Scope)) {
    return NextResponse.json(
      { ok: false, error: `scope must be one of ${SCOPES.join(", ")}` },
      { status: 400 },
    );
  }
  const scope = rawScope as Scope;

  if (scope !== "system" && !id) {
    return NextResponse.json(
      { ok: false, error: `id is required for scope=${scope}` },
      { status: 400 },
    );
  }

  if (scope === "system" && auth.session.user.role !== "ADMIN" && auth.session.user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { ok: false, error: "system scope requires ADMIN" },
      { status: 403 },
    );
  }

  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (sinceRaw && since && isNaN(since.getTime())) {
    return NextResponse.json({ ok: false, error: "since must be an ISO timestamp" }, { status: 400 });
  }

  let summary;
  switch (scope) {
    case "caller":
      summary = await getVoiceCostForCaller(id as string, since);
      break;
    case "cohort":
      summary = await getVoiceCostForCohort(id as string, since);
      break;
    case "playbook":
      summary = await getVoiceCostForPlaybook(id as string, since);
      break;
    case "system":
      summary = await getVoiceCostByProviderSystemWide(since);
      break;
  }

  return NextResponse.json({ ok: true, summary });
}
