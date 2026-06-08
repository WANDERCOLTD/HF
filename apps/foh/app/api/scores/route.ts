import { NextResponse } from "next/server";
import type { CriterionScore, ScoresResponse, SessionScore } from "@/lib/types";

// ===========================================================================
// SEAM — this is where HF's real backend plugs in.
//
// FOH does NOT own scoring. In production this handler proxies HF's
//   GET /api/calls/scores   (apps/admin — session-secured; Prisma CallScore
//   × Parameter × AnalysisSpec; Paul's backend)
// and reshapes the rows into SessionScore[] (group CallScore by callId,
// map each Parameter → criterion, average for `overall`).
//
// Until that endpoint is wired, it returns representative data in the SAME
// shape so the UI is built against the real contract, not a throwaway mock.
// Swapping to live data is a one-function change here — the page never moves.
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

// Representative sample (lifted from the prototype's HISTORY_DATA), reshaped
// to the production contract. Replace with the HF proxy call described above.
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

export async function GET(): Promise<NextResponse<ScoresResponse>> {
  // const upstream = await fetch(`${process.env.HF_API_URL}/api/calls/scores`, {
  //   headers: { authorization: `Bearer ${session.accessToken}` },
  // });
  // const sessions = reshape(await upstream.json());
  return NextResponse.json({ ok: true, sessions: SAMPLE, count: SAMPLE.length });
}
