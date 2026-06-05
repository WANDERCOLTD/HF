"use client";

import React from "react";
import Link from "next/link";
import { useQualificationProgress } from "@/hooks/useQualificationProgress";
import type { MasteryTier } from "@/lib/curriculum/mastery-tiers";
import "./sim-qualification.css";

/**
 * Pre-call qualification context strip — #1098 Slice C.
 *
 * Renders a single-line context band above the SIM chat when the active
 * Curriculum has a qualificationAnchor. Shows the unit + tier + focus LO
 * so the learner walks into the call knowing what this session is for.
 *
 * If `requestedModuleId` matches a unit slug in the catalog, that unit becomes
 * the focus; otherwise we surface the qualification's `weakestUnitSlug`.
 * Silent when there's no qualification (non-anchored Curriculum or learner not
 * yet enrolled) — no real-estate waste.
 *
 * Real-estate discipline (audit risk #2): keeps to ONE line of meaningful
 * content + an unobtrusive border. The full dashboard at /x/student/progress
 * carries the heavy lifting.
 */

const TIER_LABELS: Record<MasteryTier, string> = {
  FOUNDATION: "Foundation",
  DEVELOPING: "Developing",
  PRACTITIONER: "Practitioner",
  DISTINCTION: "Distinction",
};

interface Props {
  /** From the URL `?requestedModuleId=` param, when present. */
  requestedModuleId?: string | null;
}

export function QualificationContextStrip({ requestedModuleId }: Props): React.ReactElement | null {
  const { data } = useQualificationProgress();
  if (!data?.qualification) return null;

  const focusUnitSlug =
    (requestedModuleId && data.units.find((u) => u.moduleSlug === requestedModuleId)?.moduleSlug) ||
    data.qualification.weakestUnitSlug ||
    data.units[0]?.moduleSlug ||
    null;

  const focusUnit = focusUnitSlug
    ? data.units.find((u) => u.moduleSlug === focusUnitSlug) ?? null
    : null;

  // Without a focus unit there's nothing useful to say; stay silent.
  if (!focusUnit) return null;

  const unitTierLabel = focusUnit.tier ? TIER_LABELS[focusUnit.tier] : "Not yet assessed";
  const focusLoRef = focusUnit.weakestLoRef;

  return (
    <div
      className="hf-sim-qual-strip"
      role="status"
      aria-label="Qualification context for this session"
    >
      <span className="hf-sim-qual-strip-line1">
        <span className="hf-sim-qual-strip-anchor">{data.qualification.displayName}</span>
        <span className="hf-sim-qual-strip-dot">·</span>
        <span className="hf-sim-qual-strip-unit">{focusUnit.displayName}</span>
      </span>
      <span className="hf-sim-qual-strip-line2">
        <span>You&apos;re at </span>
        <span className="hf-sim-qual-strip-tier">{unitTierLabel}</span>
        {focusLoRef && (
          <>
            <span className="hf-sim-qual-strip-dot">·</span>
            <span>Focus: </span>
            <code className="hf-sim-qual-strip-loref">{focusLoRef}</code>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Post-call qualification readiness summary — renders next to
 * `PostCallProgressCard` in `SimChat.tsx` when `callPhase === 'ended'`.
 *
 * Re-fetches qualification progress (via the hook's `refetch`) on mount, so
 * the AGGREGATE rollup written for the just-ended call is reflected here. No
 * before/after delta — the dashboard carries the running totals, and a
 * before/after probe would require dragging in a snapshot mechanism for
 * marginal UX value. Slice D may add the delta if user testing demands it.
 */
export function QualificationSessionSummary(): React.ReactElement | null {
  const { data, refetch, loading } = useQualificationProgress();
  const [didRefetch, setDidRefetch] = React.useState(false);

  React.useEffect(() => {
    if (!didRefetch) {
      refetch();
      setDidRefetch(true);
    }
  }, [didRefetch, refetch]);

  if (loading && !data) return null;
  if (!data?.qualification) return null;

  const focusUnitSlug = data.qualification.weakestUnitSlug ?? data.units[0]?.moduleSlug ?? null;
  const focusUnit = focusUnitSlug
    ? data.units.find((u) => u.moduleSlug === focusUnitSlug) ?? null
    : null;

  const qualTierLabel = data.qualification.tier ? TIER_LABELS[data.qualification.tier] : null;

  return (
    <section className="hf-sim-qual-summary" aria-label="Qualification readiness after this session">
      <header className="hf-sim-qual-summary-head">
        <h3 className="hf-sim-qual-summary-title">Qualification readiness</h3>
      </header>
      <p className="hf-sim-qual-summary-line">
        <span className="hf-sim-qual-summary-anchor">{data.qualification.displayName}</span>
        {qualTierLabel && (
          <>
            <span className="hf-sim-qual-strip-dot">·</span>
            <span className="hf-sim-qual-summary-tier">{qualTierLabel}</span>
          </>
        )}
        <span className="hf-sim-qual-strip-dot">·</span>
        <span>
          {data.qualification.losAtTierOrAbove} of {data.qualification.losTotal} Learning Outcomes
        </span>
      </p>

      {focusUnit && (
        <p className="hf-sim-qual-summary-unitline">
          <span className="hf-sim-qual-summary-unit">{focusUnit.displayName}</span>
          {focusUnit.tier && (
            <>
              <span className="hf-sim-qual-strip-dot">·</span>
              <span className="hf-sim-qual-summary-unittier">
                {TIER_LABELS[focusUnit.tier]} on {focusUnit.losCovered}/{focusUnit.losTotal} LOs
              </span>
            </>
          )}
          {focusUnit.weakestLoRef && (
            <>
              <span className="hf-sim-qual-strip-dot">·</span>
              <span>Focus next: </span>
              <code className="hf-sim-qual-strip-loref">{focusUnit.weakestLoRef}</code>
            </>
          )}
        </p>
      )}

      <Link href="/x/student/progress" className="hf-sim-qual-summary-link">
        View full progress →
      </Link>
    </section>
  );
}
