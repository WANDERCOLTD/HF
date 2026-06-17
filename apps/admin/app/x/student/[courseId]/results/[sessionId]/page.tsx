"use client";

/**
 * /x/student/[courseId]/results/[sessionId] — Mock-exam Results screen (#1751).
 *
 * Renders the final IELTS-shape Results block: Overall band hero + strength /
 * area chips + per-criterion × per-part table. Polls
 * `/api/student/[courseId]/results/[sessionId]` at 5s until the pipeline
 * lands (response `processing: false`) or the 3 minute deadline elapses.
 *
 * The `no-bespoke-async-polling` ESLint rule (`apps/admin/eslint-rules/no-bespoke-async-polling.mjs`)
 * fires only on `setInterval` / `setTimeout` inside `while / for / do-while`
 * loop bodies — a `useEffect` setInterval is the canonical React pattern and
 * does not trigger the rule. Convergence with `useTaskPoll` is structural
 * (same shape, different fetch URL); useTaskPoll itself is hardcoded to
 * `/api/tasks` and cannot be reused for `Session.status`.
 *
 * STUDENT scope: server-side via `studentAllowedToReadCaller` in the API
 * route. Client just reads — a foreign sessionId returns 403 and lands here
 * as an error banner.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ResultsPayload, ResultsResponse } from "@/app/api/student/[courseId]/results/[sessionId]/route";
import "./results.css";

const POLL_INTERVAL_MS = 5_000;
const POLL_DEADLINE_MS = 3 * 60_000; // 3 min — pipeline EXTRACT+MEASURE budget

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; data: ResultsPayload }
  | { kind: "error"; message: string };

export default function MockResultsPage() {
  const { courseId, sessionId } = useParams<{ courseId: string; sessionId: string }>();
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/${courseId}/results/${sessionId}`);
      const body = (await res.json()) as ResultsResponse;
      if (!res.ok || !body.ok) {
        const msg = !body.ok ? body.error : `Request failed (${res.status})`;
        setState({ kind: "error", message: msg });
        return { processing: false };
      }
      setState({ kind: "ready", data: body });
      return { processing: body.processing };
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
      return { processing: false };
    }
  }, [courseId, sessionId]);

  useEffect(() => {
    if (!courseId || !sessionId) return;
    const startedAt = Date.now();
    let stopped = false;

    void fetchOnce().then(({ processing }) => {
      if (!processing) return;
    });

    const interval = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - startedAt > POLL_DEADLINE_MS) {
        stopped = true;
        clearInterval(interval);
        return;
      }
      const { processing } = await fetchOnce();
      if (!processing) {
        stopped = true;
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [courseId, sessionId, fetchOnce]);

  return (
    <div className="hf-results-wrap">
      <div className="hf-results-container">
        <header className="hf-results-header">
          <span className="hf-results-header-eyebrow">Mock results</span>
          <h1 className="hf-results-header-title">
            {state.kind === "ready" ? state.data.courseTitle ?? "Your results" : "Your results"}
          </h1>
        </header>

        {state.kind === "loading" && <ProcessingCard />}

        {state.kind === "error" && (
          <div className="hf-results-error" role="alert">
            {state.message}
          </div>
        )}

        {state.kind === "ready" && state.data.processing && <ProcessingCard />}

        {state.kind === "ready" && !state.data.processing && <ResultsView data={state.data} />}
      </div>
    </div>
  );
}

function ProcessingCard() {
  return (
    <section className="hf-results-processing" aria-busy="true">
      <Loader2 className="hf-results-processing-spinner" aria-hidden />
      <div className="hf-results-processing-title">Reviewing your exam…</div>
      <div className="hf-results-processing-desc">
        Hold tight — we&rsquo;re scoring each part. This usually takes about a minute after the call
        ends.
      </div>
    </section>
  );
}

function ResultsView({ data }: { data: ResultsPayload }) {
  // Build the per-criterion × per-part table. Rows = parameters, columns = segmentKeys.
  const segmentKeys: (string | null)[] = Array.from(
    new Set(data.scores.map((s) => s.segmentKey)),
  ).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b);
  });

  const parameters: { parameterId: string; parameterName: string }[] = Array.from(
    new Map(data.scores.map((s) => [s.parameterId, { parameterId: s.parameterId, parameterName: s.parameterName }])).values(),
  );

  function cellFor(parameterId: string, segmentKey: string | null) {
    return data.scores.find((s) => s.parameterId === parameterId && s.segmentKey === segmentKey);
  }

  const hasScores = data.scores.length > 0;

  return (
    <>
      {data.overallBand !== null && (
        <section className="hf-results-hero">
          <span className="hf-results-hero-label">Overall band</span>
          <div className="hf-results-hero-band">{data.overallBand.toFixed(1)}</div>
          {data.overallBandSource === "computed" && (
            <span className="hf-results-hero-source">Computed from per-criterion bands</span>
          )}
        </section>
      )}

      {(data.strength || data.area) && (
        <section className="hf-results-chips" aria-label="Strength and area to work on">
          {data.strength && (
            <div className="hf-results-chip hf-results-chip-strength">
              <span className="hf-results-chip-label">Strength</span>
              <span className="hf-results-chip-name">{data.strength.parameterName}</span>
              <span className="hf-results-chip-band">Band {data.strength.band.toFixed(1)}</span>
            </div>
          )}
          {data.area && (
            <div className="hf-results-chip hf-results-chip-area">
              <span className="hf-results-chip-label">Area to work on</span>
              <span className="hf-results-chip-name">{data.area.parameterName}</span>
              <span className="hf-results-chip-band">Band {data.area.band.toFixed(1)}</span>
            </div>
          )}
        </section>
      )}

      <section className="hf-results-table-wrap" aria-label="Per-criterion band table">
        {hasScores ? (
          <table className="hf-results-table">
            <thead>
              <tr>
                <th>Criterion</th>
                {segmentKeys.map((seg) => (
                  <th key={seg ?? "overall"}>{seg ?? "Overall"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parameters.map((p) => (
                <tr key={p.parameterId}>
                  <td>{p.parameterName}</td>
                  {segmentKeys.map((seg) => {
                    const cell = cellFor(p.parameterId, seg);
                    return (
                      <td key={seg ?? "overall"} className="hf-results-table-band">
                        {cell ? cell.band.toFixed(1) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="hf-results-table-empty">No scores recorded for this session.</div>
        )}
      </section>

      {/* Outbound navigation — Results is a per-session band card; learner
       *  still needs a path to their broader Progress dashboard and back
       *  to module pick for another attempt. Added in the Epic #1700
       *  missing-surface sweep — pre-fix learner was stranded here. */}
      <nav className="hf-results-actions" aria-label="What's next">
        <Link
          className="hf-btn hf-btn-primary"
          href={`/x/student/${data.courseId}/modules`}
          data-testid="hf-results-pick-module"
        >
          Pick another module
        </Link>
        <Link
          className="hf-btn hf-btn-secondary"
          href="/x/student/progress"
          data-testid="hf-results-view-progress"
        >
          View overall progress
        </Link>
      </nav>
    </>
  );
}
