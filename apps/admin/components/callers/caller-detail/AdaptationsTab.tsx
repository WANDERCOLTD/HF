"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, AlertTriangle, Info } from "lucide-react";

import "./adaptations-tab.css";

/**
 * Caller Detail → Adaptations tab.
 *
 * Sister of `AttainmentTab` (SP4-A) — Attainment shows "where this
 * learner IS"; Adaptations shows "what the engine CHANGED for this
 * learner, why, and what's next".
 *
 * **Wave C3b — role-tiered visibility** (replaces the SP5-A OPERATOR+
 * client lock). The route is now `requireAuth("VIEWER")` + STUDENT
 * path-param scope; the server applies `redactAdaptationsForTier`
 * before responding. The component reads the `viewerTier`
 * discriminator on the response:
 *
 *   - `redacted` (STUDENT / VIEWER / TESTER) — parameter names +
 *     direction chips + "N adjustments since you started"; nextAdaptation
 *     section omitted.
 *   - `full` / `diagnostic` (OPERATOR+) — full sections (cascade chips,
 *     numeric values, rationale text, next-call preview).
 *
 * Sections:
 *
 *   - SP5-B "What was adapted" — `CallerTarget` overrides vs PLAYBOOK
 *     default + cascade chips (full tier) / direction chip (redacted)
 *   - SP5-C "Why" — `RewardScore` rationale timeline (full) / count +
 *     most-recent date (redacted)
 *   - SP5-D "Next call's adaptation" — `goalAdaptationGuidance`
 *     LOW/MID/HIGH preview (full only)
 */

interface AdaptationOverrideFull {
  parameterId: string;
  parameterName: string;
  defaultValue: number;
  overrideValue: number;
  sourceScope: "SYSTEM" | "PLAYBOOK" | "CALLER";
  confidence: number | null;
  callsApplied: number;
  updatedAt: string | null;
}

interface AdaptationOverrideRedacted {
  parameterId: string;
  parameterName: string;
  direction: "up" | "down" | "hold";
  updatedAt: string | null;
}

interface AdaptationReason {
  callId: string;
  at: string;
  rationale: string;
  direction: "up" | "down" | "hold";
  parameterId: string | null;
  parameterName: string | null;
  delta: number | null;
}

interface AdaptationReasonRedacted {
  count: number;
  mostRecentAt: string | null;
}

interface NextAdaptationGuidanceEntry {
  goalId: string;
  goalName: string;
  goalType: string;
  progress: number;
  band: "low" | "mid" | "high";
  guidance: string;
  isAssessmentTarget: boolean;
}

interface AdaptationsResponseFull {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  whatWasAdapted: AdaptationOverrideFull[];
  why: AdaptationReason[];
  nextAdaptation: NextAdaptationGuidanceEntry[];
  empty: boolean;
  viewerTier: "full" | "diagnostic";
}

interface AdaptationsResponseRedacted {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  whatWasAdapted: AdaptationOverrideRedacted[];
  whyRedacted: AdaptationReasonRedacted;
  nextAdaptation: never[];
  empty: boolean;
  viewerTier: "redacted";
}

type AdaptationsResponse = AdaptationsResponseFull | AdaptationsResponseRedacted;

function isRedacted(
  r: AdaptationsResponse,
): r is AdaptationsResponseRedacted {
  return r.viewerTier === "redacted";
}

interface Props {
  callerId: string;
}

export function AdaptationsTab({ callerId }: Props) {
  const [data, setData] = useState<AdaptationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/callers/${callerId}/adaptations`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: AdaptationsResponse) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (loading) {
    return (
      <div className="hf-adaptations-loading" role="status" aria-live="polite">
        Loading adaptations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-adaptations-error hf-banner-error" role="alert">
        <AlertTriangle size={16} />
        <div>
          <strong>Could not load Adaptations.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.playbookId) {
    return (
      <div className="hf-adaptations-empty">
        <Info size={20} aria-hidden />
        <div>
          <strong>No course enrolment found.</strong>
          <p>
            This learner isn&apos;t enrolled on a course yet. Once they
            start a course and complete a call, the engine&apos;s
            adaptations show here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-adaptations-tab">
      <header className="hf-adaptations-header">
        <h2 className="hf-section-title">
          <SlidersHorizontal size={18} aria-hidden /> Adaptations
        </h2>
        <p className="hf-section-desc">
          What the engine changed for{" "}
          {data.callerName ? <strong>{data.callerName}</strong> : "this learner"}
          {data.playbookName ? (
            <>
              {" "}on <strong>{data.playbookName}</strong>
            </>
          ) : null}
          {" "}— and why.
        </p>
      </header>

      {isRedacted(data) ? (
        <>
          <WhatWasAdaptedRedactedSection
            overrides={data.whatWasAdapted}
            empty={data.empty}
          />
          <WhyRedactedSection
            redacted={data.whyRedacted}
            empty={data.empty}
          />
          {/* Next-call preview is hidden at the redacted tier so the
              learner can't pre-read the plan. */}
        </>
      ) : (
        <>
          <WhatWasAdaptedSection
            overrides={data.whatWasAdapted}
            empty={data.empty}
          />
          <WhySection reasons={data.why} empty={data.empty} />
          <NextAdaptationSection
            guidance={data.nextAdaptation}
            empty={data.empty}
          />
        </>
      )}
    </div>
  );
}

// ── Section 1: What was adapted (SP5-B) ─────────────────────────────────────

function WhatWasAdaptedSection({
  overrides,
  empty,
}: {
  overrides: AdaptationOverrideFull[];
  empty: boolean;
}) {
  return (
    <section className="hf-adaptations-section">
      <h3 className="hf-adaptations-section-title">What was adapted</h3>
      <p className="hf-adaptations-section-desc">
        Per-parameter overrides this learner has earned. Each row shows the
        system default, the current effective value, and the cascade chip
        for the layer winning right now (CALLER overrides PLAYBOOK overrides
        SYSTEM). SYSTEM-only rows (unchanged baseline) are hidden.
      </p>
      {overrides.length === 0 ? (
        <p className="hf-adaptations-empty-text">
          {empty
            ? "No adaptations yet — the engine starts with the playbook's defaults and adapts after the first scoring call."
            : "No per-parameter overrides recorded yet on top of the playbook + system baseline."}
        </p>
      ) : (
        <ul className="hf-adaptations-override-rows">
          {overrides.map((o) => (
            <OverrideRow key={o.parameterId} override={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OverrideRow({ override }: { override: AdaptationOverrideFull }) {
  const defaultPct = Math.round(override.defaultValue * 100);
  const overridePct = Math.round(override.overrideValue * 100);
  const delta = override.overrideValue - override.defaultValue;
  const direction = delta > 0.02 ? "up" : delta < -0.02 ? "down" : "flat";
  const deltaLabel =
    direction === "flat"
      ? "≈ default"
      : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)} pts`;
  return (
    <li className="hf-adaptations-override-row">
      <div className="hf-adaptations-override-head">
        <span className="hf-adaptations-override-name">
          {override.parameterName}
        </span>
        <span
          className={`hf-adaptations-cascade-chip hf-adaptations-cascade-chip-${override.sourceScope.toLowerCase()}`}
        >
          {sourceScopeLabel(override.sourceScope)}
        </span>
        <span
          className={`hf-adaptations-override-delta hf-adaptations-override-delta-${direction}`}
        >
          {deltaLabel}
        </span>
      </div>
      <div className="hf-adaptations-override-bars">
        <div className="hf-adaptations-override-bar-row">
          <span className="hf-adaptations-override-bar-label">Default</span>
          <span className="hf-adaptations-override-bar">
            <span
              className="hf-adaptations-override-bar-fill hf-adaptations-override-bar-fill-default"
              style={{ width: `${defaultPct}%` }}
            />
          </span>
          <span className="hf-adaptations-override-bar-pct">{defaultPct}%</span>
        </div>
        <div className="hf-adaptations-override-bar-row">
          <span className="hf-adaptations-override-bar-label">Now</span>
          <span className="hf-adaptations-override-bar">
            <span
              className="hf-adaptations-override-bar-fill hf-adaptations-override-bar-fill-now"
              style={{ width: `${overridePct}%` }}
            />
          </span>
          <span className="hf-adaptations-override-bar-pct">{overridePct}%</span>
        </div>
      </div>
      {override.sourceScope === "CALLER" ? (
        <div className="hf-adaptations-override-meta">
          {override.callsApplied > 0
            ? `${override.callsApplied} call${override.callsApplied === 1 ? "" : "s"} of evidence`
            : "Evidence pending"}
          {override.confidence != null
            ? ` · ${Math.round(override.confidence * 100)}% confidence`
            : ""}
        </div>
      ) : override.sourceScope === "PLAYBOOK" ? (
        <div className="hf-adaptations-override-meta">
          Playbook-scope default (no caller-specific adaptation yet)
        </div>
      ) : null}
    </li>
  );
}

function sourceScopeLabel(scope: "SYSTEM" | "PLAYBOOK" | "CALLER"): string {
  switch (scope) {
    case "SYSTEM":
      return "System";
    case "PLAYBOOK":
      return "Playbook";
    case "CALLER":
      return "Caller";
  }
}

// ── Section 2: Why (SP5-C) ──────────────────────────────────────────────────

function WhySection({
  reasons,
  empty,
}: {
  reasons: AdaptationReason[];
  empty: boolean;
}) {
  return (
    <section className="hf-adaptations-section">
      <h3 className="hf-adaptations-section-title">Why</h3>
      <p className="hf-adaptations-section-desc">
        Timeline of REWARD-stage adaptations — what the engine pushed up,
        down, or held, with the rationale the writer logged. Each entry
        links back to the call that triggered it (callId shown).
      </p>
      {reasons.length === 0 ? (
        <p className="hf-adaptations-empty-text">
          {empty
            ? "No adaptation reasoning logged yet — appears after the first scoring call."
            : "No target updates have been logged in the most recent calls."}
        </p>
      ) : (
        <ul className="hf-adaptations-reason-rows">
          {reasons.map((r, i) => (
            <ReasonRow key={`${r.callId}-${i}`} reason={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReasonRow({ reason }: { reason: AdaptationReason }) {
  const arrow =
    reason.direction === "up" ? "↑" : reason.direction === "down" ? "↓" : "→";
  const deltaLabel =
    reason.delta != null
      ? `${reason.delta > 0 ? "+" : ""}${(reason.delta * 100).toFixed(0)} pts`
      : "";
  const when = formatReasonDate(reason.at);
  return (
    <li className="hf-adaptations-reason-row">
      <div className="hf-adaptations-reason-head">
        <span
          className={`hf-adaptations-reason-arrow hf-adaptations-reason-arrow-${reason.direction}`}
          aria-label={`Direction ${reason.direction}`}
        >
          {arrow}
        </span>
        <span className="hf-adaptations-reason-param">
          {reason.parameterName ?? "(no parameter)"}
        </span>
        <span className="hf-adaptations-reason-delta">{deltaLabel}</span>
        <span className="hf-adaptations-reason-when">{when}</span>
      </div>
      <p className="hf-adaptations-reason-text">{reason.rationale}</p>
      <div className="hf-adaptations-reason-callid">
        Call {reason.callId.slice(0, 8)}…
      </div>
    </li>
  );
}

function formatReasonDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = Date.now() - then.getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 0) return then.toLocaleDateString();
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return then.toLocaleDateString();
}

// ── Section 3: Next call's adaptation (SP5-D) ───────────────────────────────

function NextAdaptationSection({
  guidance,
  empty,
}: {
  guidance: NextAdaptationGuidanceEntry[];
  empty: boolean;
}) {
  return (
    <section className="hf-adaptations-section">
      <h3 className="hf-adaptations-section-title">Next call</h3>
      <p className="hf-adaptations-section-desc">
        Preview of the guidance the AI will receive when composing this
        learner&apos;s next prompt. One entry per top-3 active goal, banded
        by current progress: LOW (&lt;30%) · MID (&lt;70%) · HIGH (≥70%).
      </p>
      {guidance.length === 0 ? (
        <p className="hf-adaptations-empty-text">
          {empty
            ? "Nothing queued yet — the engine plans the next adaptation once at least one active goal is set."
            : "No active goals — set or import a goal for this learner to see the next-call preview."}
        </p>
      ) : (
        <ul className="hf-adaptations-next-rows">
          {guidance.map((g) => (
            <NextRow key={g.goalId} entry={g} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NextRow({ entry }: { entry: NextAdaptationGuidanceEntry }) {
  const pct = Math.round(entry.progress * 100);
  return (
    <li className="hf-adaptations-next-row">
      <div className="hf-adaptations-next-head">
        <span
          className={`hf-adaptations-next-band hf-adaptations-next-band-${entry.band}`}
        >
          {entry.band.toUpperCase()}
        </span>
        <span className="hf-adaptations-next-type">{entry.goalType}</span>
        <span className="hf-adaptations-next-name">{entry.goalName}</span>
        <span className="hf-adaptations-next-pct">{pct}%</span>
        {entry.isAssessmentTarget ? (
          <span className="hf-adaptations-next-assessment">
            assessment target
          </span>
        ) : null}
      </div>
      <p className="hf-adaptations-next-guidance">{entry.guidance}.</p>
    </li>
  );
}

// ── Redacted sections (STUDENT / VIEWER / TESTER tier) ──────────────────────

function WhatWasAdaptedRedactedSection({
  overrides,
  empty,
}: {
  overrides: AdaptationOverrideRedacted[];
  empty: boolean;
}) {
  return (
    <section
      className="hf-adaptations-section"
      data-testid="hf-adaptations-what-redacted"
    >
      <h3 className="hf-adaptations-section-title">What was adapted</h3>
      <p className="hf-adaptations-section-desc">
        Parameters the engine has nudged for this learner. Direction-only —
        numeric values, source layer, and confidence are operator-only.
      </p>
      {overrides.length === 0 ? (
        <p className="hf-adaptations-empty-text">
          {empty
            ? "No adaptations yet — the engine starts with the playbook's defaults and adapts after the first scoring call."
            : "No per-parameter overrides recorded yet."}
        </p>
      ) : (
        <ul className="hf-adaptations-override-rows">
          {overrides.map((o) => (
            <li
              key={o.parameterId}
              className="hf-adaptations-override-row hf-adaptations-override-row-redacted"
            >
              <div className="hf-adaptations-override-head">
                <span className="hf-adaptations-override-name">
                  {o.parameterName}
                </span>
                <span
                  className={`hf-adaptations-override-delta hf-adaptations-override-delta-${
                    o.direction === "hold" ? "flat" : o.direction
                  }`}
                  aria-label={`Direction ${o.direction}`}
                >
                  {o.direction === "up"
                    ? "↑ nudged up"
                    : o.direction === "down"
                      ? "↓ nudged down"
                      : "→ holding"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WhyRedactedSection({
  redacted,
  empty,
}: {
  redacted: AdaptationReasonRedacted;
  empty: boolean;
}) {
  return (
    <section
      className="hf-adaptations-section"
      data-testid="hf-adaptations-why-redacted"
    >
      <h3 className="hf-adaptations-section-title">Why</h3>
      <p className="hf-adaptations-section-desc">
        Summary of recent adaptation activity. Per-event rationale is
        operator-only.
      </p>
      {redacted.count === 0 ? (
        <p className="hf-adaptations-empty-text">
          {empty
            ? "No adaptation activity yet — appears after the first scoring call."
            : "No target updates have been logged in the most recent calls."}
        </p>
      ) : (
        <p className="hf-adaptations-redacted-summary">
          <strong>
            {redacted.count} adjustment{redacted.count === 1 ? "" : "s"}
          </strong>{" "}
          recorded
          {redacted.mostRecentAt ? (
            <>
              {" "}— most recent on{" "}
              <time dateTime={redacted.mostRecentAt}>
                {formatReasonDate(redacted.mostRecentAt)}
              </time>
            </>
          ) : (
            ""
          )}
          .
        </p>
      )}
    </section>
  );
}
