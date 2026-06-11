// GET /api/intake/audit-bundle?intentId=<id>
//
// Returns the composed AuditBundle for an in-flight or completed
// IntakeSession. Phase 1 in-memory session-store; Phase 1.5 wires
// PrismaEventStore-backed retrieval.
//
// HF-D P0 hardening (2026-06-12): rate-limited per IP under the
// "intake-pii-read" key. See docs/audit/HF-D-evidence-pii-intentid-bearer.md.

import { NextRequest, NextResponse } from "next/server";
import {
  composeIntakeAuditBundle,
  SessionNotFoundError,
} from "@/lib/intake/audit-bundle";
import { canonicalJSON } from "@/lib/intake/tallyseal";
import type { IntentId } from "@/lib/intake/tallyseal";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(getClientIP(req), "intake-pii-read");
  if (!rl.ok) return rl.error;

  const intentId = req.nextUrl.searchParams.get("intentId");
  if (!intentId) {
    return NextResponse.json({ error: "intentId required" }, { status: 400 });
  }
  try {
    const bundle = composeIntakeAuditBundle({ intentId: intentId as IntentId });
    // Use canonicalJSON to guarantee byte-stable serialisation —
    // auditors recompute hashes locally over this exact string.
    return new NextResponse(canonicalJSON(bundle), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
