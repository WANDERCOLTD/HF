// ---------------------------------------------------------------------------
// Front-of-house score contract.
//
// These types mirror HF's existing data model so FOH is built against the REAL
// contract from day one:
//   - apps/admin/prisma/schema.prisma  → model CallScore (score, scoredAt, …)
//   - model Parameter                  → the four IELTS criteria are Parameter rows
//   - GET /api/calls/scores            → the session-secured source of truth (Paul's backend)
//
// FOH never owns scoring. It consumes it. See app/api/scores/route.ts for the seam.
// ---------------------------------------------------------------------------

export type CriterionKey = "fluency" | "lexical" | "grammar" | "pronunciation";

export interface CriterionScore {
  key: CriterionKey;
  label: string;
  /** 0–9 IELTS band. Mirrors CallScore.score. */
  score: number;
}

export interface SessionScore {
  /** Mirrors CallScore.callId — one practice session. */
  id: string;
  /** ISO date. Mirrors CallScore.scoredAt. */
  date: string;
  /** Practice type: "P1" | "P2" | "P3" | "Mock". */
  type: string;
  /** Overall estimated band for the session. */
  overall: number;
  criteria: CriterionScore[];
}

export interface ScoresResponse {
  ok: boolean;
  sessions: SessionScore[];
  count: number;
  /** True when sourced from a live HF backend proxy; false when the
   *  proxy fell back to representative SAMPLE data (e.g. no creds,
   *  network failure, auth error). Mirrors the `live` field on
   *  `CallersResponse` — same fallback shape as `apps/foh/app/api/callers`. */
  live?: boolean;
  /** Live source URL when `live === true`, or "sample" for the fallback. */
  source?: string;
  /** Human-readable note explaining the fallback (only set when
   *  `live === false`). */
  note?: string;
}
