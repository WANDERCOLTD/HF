// GET /api/intake/audit-bundle
//
// Returns the composed AuditBundle for the in-flight or completed
// IntakeSession identified by the `__hf_intake_sid` cookie (HF-D P1
// #3 — issue #1542; bearer was a URL `?intentId=` query param pre-fix).
//
// Phase 1 in-memory session-store; Phase 1.5 wires PrismaEventStore-
// backed retrieval. The audit-doc landmine check (P2 #7) MUST happen
// before that migration — disk persistence widens any leakage window
// the cookie migration just closed.
//
// HF-D P0 hardening (2026-06-12, defence-in-depth) — rate-limited per
// IP under the "intake-pii-read" key. See
// `docs/audit/HF-D-evidence-pii-intentid-bearer.md`.

import { NextRequest, NextResponse } from "next/server";
import {
  composeIntakeAuditBundle,
  SessionNotFoundError,
} from "@/lib/intake/audit-bundle";
import { canonicalJSON } from "@/lib/intake/tallyseal";
import type { IntentId } from "@/lib/intake/tallyseal";
import { readIntakeSid } from "@/lib/intake/intake-session-cookie";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(getClientIP(req), "intake-pii-read");
  if (!rl.ok) return rl.error;

  const intentId = readIntakeSid(req);
  if (!intentId) {
    return NextResponse.json(
      { error: "no_intake_session", message: "No in-flight intake session." },
      { status: 401 },
    );
  }
  try {
    const bundle = composeIntakeAuditBundle({ intentId: intentId as IntentId });
    // canonicalJSON guarantees byte-stable serialisation — auditors
    // recompute hashes locally over this exact string.
    return new NextResponse(canonicalJSON(bundle), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return NextResponse.json(
        {
          error: "session_expired",
          message: "Your session has expired. Please restart the intake flow.",
        },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
