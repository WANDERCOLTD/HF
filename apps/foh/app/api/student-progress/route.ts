import { NextResponse } from "next/server";

// ===========================================================================
// SEAM — this is where HF's real backend plugs in.
//
// FOH does NOT own learner progress. In production this handler proxies HF's
//   GET /api/student/progress   (apps/admin — STUDENT-secured via
//   requireStudentOrAdmin; surfaces Session.metadata.lessonPlan +
//   nextRecommended; written by `pickNextRecommendedModule` at AGGREGATE).
// Until that proxy is wired (epic #2277 follow-on for cross-app session),
// this returns a representative payload in the SAME shape so the home
// page is built against the real contract, not a throwaway mock.
// Swapping to live data is a one-function change here — the page never moves.
// ===========================================================================

export interface FohModuleCard {
  slug: string;
  title: string;
  status: "MASTERED" | "IN_PROGRESS" | "NOT_STARTED";
}

export interface FohNextRecommended {
  moduleSlug: string;
  fromSessionId: string | null;
}

export interface FohLessonPlan {
  focusCriterion: string;
  focusLabel: string;
  focusScore: number;
  reason: string;
  nextRecommendedModuleSlug?: string;
  emittedAt: string;
}

export interface FohStudentProgressResponse {
  ok: true;
  modules: FohModuleCard[];
  lessonPlan: FohLessonPlan | null;
  nextRecommended: FohNextRecommended | null;
}

// Representative IELTS Speaking Practice shape — 5 modules. Replace with the
// HF proxy call described above. The lessonPlan + nextRecommended carry the
// AGGREGATE writer's output for the most recent COMPLETED session.
const SAMPLE: FohStudentProgressResponse = {
  ok: true,
  modules: [
    { slug: "intro", title: "Welcome & Setup", status: "MASTERED" },
    { slug: "baseline", title: "Baseline Assessment", status: "MASTERED" },
    { slug: "part1", title: "Part 1 — Familiar Topics", status: "IN_PROGRESS" },
    { slug: "part2", title: "Part 2 — Long Turn", status: "NOT_STARTED" },
    { slug: "part3", title: "Part 3 — Discussion", status: "NOT_STARTED" },
  ],
  lessonPlan: {
    // LEARNER-SAFE values only — internal IELTS criterion slugs and
    // criterion labels MUST NOT appear in FOH source per the rule at
    // `.claude/rules/learner-ui-leak-coverage.md`. The real backend's
    // `/api/admin/student/progress` proxy is responsible for redacting
    // the internal criterion to a learner-safe technique label per
    // IELTS-P3-FOCUS-001 (D5, PR #2306) before the payload crosses the
    // FOH boundary. Until that proxy is wired (epic #2277), the sample
    // reflects what the redacted payload looks like: a
    // Part3TechniqueFocus member (giving reasons / structuring an
    // argument / handling a challenge / expanding an answer), not the
    // criterion that drove the selection.
    // NOTE: the learner-ui-leak gate scans this file for quoted
    // internal-label literals INCLUDING inside comments — that's why
    // the forbidden examples appear unquoted above.
    focusCriterion: "part3-technique-focus",
    focusLabel: "expanding an answer",
    focusScore: 0.55,
    reason:
      "Your next session focuses on expanding an answer — practising fuller, more detailed responses lifts your overall band fastest.",
    nextRecommendedModuleSlug: "part1",
    emittedAt: "2026-06-22T10:00:00Z",
  },
  nextRecommended: {
    moduleSlug: "part1",
    fromSessionId: "sess-mock-1",
  },
};

export async function GET(): Promise<NextResponse<FohStudentProgressResponse>> {
  // const upstream = await fetch(`${process.env.HF_API_URL}/api/student/progress`, {
  //   headers: { authorization: `Bearer ${session.accessToken}` },
  // });
  // return NextResponse.json(reshape(await upstream.json()));
  return NextResponse.json(SAMPLE);
}
