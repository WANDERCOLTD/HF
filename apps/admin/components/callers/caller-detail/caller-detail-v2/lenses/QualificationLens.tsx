"use client";

import React, { useEffect, useState } from "react";
import { QualificationCard } from "@/components/student/qualification/QualificationCard";
import type { QualificationProgressData } from "@/hooks/useQualificationProgress";

interface Props {
  callerId: string;
}

/**
 * Qualification lens — Progress v2 (#1098 Slice B).
 *
 * Educator/admin view of the same qualification dashboard the learner sees on
 * `/x/student/progress`. Composition is intentionally identical (single source
 * of truth = `QualificationCard`) so the educator sees exactly the same data
 * the learner does — minus the "Start call" CTA, which would be confusing
 * from an educator surface (the educator can't take the call for the learner).
 *
 * Fetches via `/api/student/qualification-progress?callerId=<callerId>` — an
 * admin/OPERATOR+ session is required by the route's scope guard.
 */
export function QualificationLens({ callerId }: Props): React.ReactElement {
  const [data, setData] = useState<QualificationProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/student/qualification-progress?callerId=${encodeURIComponent(callerId)}`)
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload?.ok) {
          setData({
            qualification: payload.qualification ?? null,
            units: Array.isArray(payload.units) ? payload.units : [],
            skills: Array.isArray(payload.skills) ? payload.skills : [],
            recentActivity: Array.isArray(payload.recentActivity) ? payload.recentActivity : [],
            nextBestStep: payload.nextBestStep ?? null,
          });
        } else {
          setError(typeof payload?.error === "string" ? payload.error : "failed to load");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
      <div
        className="hf-progress-v2-lens hf-progress-v2-lens--loading"
        role="status"
        aria-live="polite"
      >
        <div className="hf-spinner" aria-hidden="true" />
        <span>Loading qualification progress…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-progress-v2-lens">
        <div className="hf-progress-v2-lens-head">
          <h3 className="hf-progress-v2-lens-title">Qualification</h3>
        </div>
        <p className="hf-qualification-coldstart">
          Could not load qualification progress: {error}
        </p>
      </div>
    );
  }

  if (!data?.qualification) {
    return (
      <div className="hf-progress-v2-lens">
        <div className="hf-progress-v2-lens-head">
          <h3 className="hf-progress-v2-lens-title">Qualification</h3>
        </div>
        <p className="hf-qualification-coldstart">
          This learner&apos;s active course is not part of a regulated qualification —
          nothing to show here. (See the Modules lens for the per-course view.)
        </p>
      </div>
    );
  }

  return (
    <div className="hf-progress-v2-lens">
      <div className="hf-progress-v2-lens-head">
        <h3 className="hf-progress-v2-lens-title">Qualification</h3>
        <span className="hf-progress-v2-lens-sub">
          {data.qualification.displayName}
        </span>
      </div>
      <QualificationCard data={data} hideNextBestStep />
    </div>
  );
}
