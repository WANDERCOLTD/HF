import { NextResponse } from "next/server";
import type { CriterionScore, ScoresResponse, SessionScore } from "@/lib/types";
import { fetchScoresLive, HF_BASE } from "@/lib/hf";

// ===========================================================================
// SEAM — FOH ↔ HF backend.
//
// Item #4 of epic #2277 (IELTS market test readiness). This route proxies
// HF's admin endpoint:
//   GET /api/calls/scores   (apps/admin — requireAuth("VIEWER"); session)
//
// The admin endpoint returns one row per (callId, parameterId); fetchScoresLive
// (lib/hf.ts) reshapes it into SessionScore[] by grouping on callId and
// mapping IELTS Parameter.parameterId → CriterionKey. ResultsReadoutShell
// (apps/admin/components/sim/ResultsReadoutShell.tsx) consumes the same
// shape already; the Progress page (apps/foh/app/progress/page.tsx) consumes
// SessionScore[] for the band-over-time trend.
//
// Auth: cross-origin to HF, so we log in once via hfLogin() (session-cookie
// flow against ${HF_BASE}/api/auth) using HF_USER_EMAIL / HF_USER_PASSWORD.
// The cookie is cached for ~20 min — same shim apps/foh/app/api/callers
// uses today.
//
// Scoping: the admin endpoint returns scores across every caller the
// admin session can see. We accept a `?callerId=` query param so the
// proxy filters server-side before returning to the browser. Without it,
// the response includes every caller — fine for a single-tenant market-test
// deploy, but the Progress page should pass `?callerId=<own>` for STUDENT
// safety once #2280 lands the per-learner session.
//
// Failure mode: when the admin endpoint is unreachable, login fails, or
// the response is malformed, we fall back to a representative SAMPLE in
// the same shape (so the Progress page never breaks for a demo). A `note`
// field surfaces the reason so the operator sees the degradation. We
// do NOT fabricate scoring data when the endpoint succeeds-but-empty —
// per the operator-pinned "never fill empty scores with hardcoded
// defaults" rule (MEMORY.md 2026-06-21). Empty = empty.
// ===========================================================================

function criteria(
  fluency: number,
  lexical: number,
  grammar: number,
  pronunciation: number,
): CriterionScore[] {
  return [
    { key: "fluency", label: "Fluency & Coherence", score: fluency },
    { key: "lexical", label: "Lexical Resource", score: lexical },
    { key: "grammar", label: "Grammatical Range", score: grammar },
    { key: "pronunciation", label: "Pronunciation", score: pronunciation },
  ];
}

// Representative sample (lifted from the prototype's HISTORY_DATA).
// Served ONLY when the live proxy fails (network / auth / no-creds) —
// never as a silent default on top of partial live data.
const SAMPLE: SessionScore[] = [
  { id: "s1", date: "2026-04-08", type: "P1", overall: 4.5, criteria: criteria(4.0, 4.5, 4.5, 5.0) },
  { id: "s2", date: "2026-04-09", type: "P1", overall: 5.0, criteria: criteria(4.5, 5.0, 5.0, 5.5) },
  { id: "s3", date: "2026-04-10", type: "P2", overall: 5.0, criteria: criteria(5.0, 4.5, 5.0, 5.5) },
  { id: "s4", date: "2026-04-11", type: "P3", overall: 5.5, criteria: criteria(5.5, 5.0, 5.5, 6.0) },
  { id: "s5", date: "2026-04-12", type: "P1", overall: 5.5, criteria: criteria(5.5, 5.5, 5.0, 6.0) },
  { id: "s6", date: "2026-04-13", type: "Mock", overall: 5.5, criteria: criteria(5.5, 5.0, 6.0, 6.0) },
  { id: "s7", date: "2026-04-14", type: "P2", overall: 6.0, criteria: criteria(6.0, 5.5, 6.0, 6.5) },
  { id: "s8", date: "2026-04-15", type: "P1", overall: 6.0, criteria: criteria(6.0, 5.5, 6.0, 6.5) },
];

export async function GET(req: Request): Promise<NextResponse<ScoresResponse>> {
  const callerId = new URL(req.url).searchParams.get("callerId");
  try {
    const sessions = await fetchScoresLive({ callerId });
    return NextResponse.json({
      ok: true,
      live: true,
      source: HF_BASE,
      sessions,
      count: sessions.length,
    });
  } catch (e) {
    const reason = (e as Error).message;
    return NextResponse.json({
      ok: true,
      live: false,
      source: "sample",
      sessions: SAMPLE,
      count: SAMPLE.length,
      note:
        reason === "no-credentials"
          ? "Set HF_USER_EMAIL / HF_USER_PASSWORD to load real scores."
          : `Live load failed (${reason}) — showing sample data.`,
    });
  }
}
