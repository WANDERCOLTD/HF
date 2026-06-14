"use client";

/**
 * SnapshotWhyThisCall — #1663 (Epic #1606 Group C Phase 2).
 *
 * Renders the scheduler's last recorded decision for the caller so the
 * educator can see the system's reasoning at a glance on the Snapshot
 * v3 tab.
 *
 * Reads `/api/callers/[id]/scheduler-decision` (new route in this PR).
 * Decision 1 from the #1663 grooming: surface raw `mode + reason +
 * writtenAt` only — do NOT attempt to resolve
 * `workingSetAssertionIds` to LO refs (that's a follow-on if educators
 * ask for the extra detail).
 *
 * Empty states:
 *  - Loading → muted "Loading…" badge
 *  - Fetch error → muted "Unable to load scheduler reason"
 *  - 404 / no decision → muted "No scheduler decision recorded yet"
 *  - Decision present → mode chip + reason prose + relative writtenAt
 */

import { useEffect, useState } from "react";

interface SnapshotWhyThisCallProps {
  callerId: string;
}

interface DecisionView {
  mode: string;
  reason: string;
  writtenAt: string;
}

interface SchedulerDecisionResponse {
  ok: boolean;
  callerId: string;
  decision: DecisionView | null;
}

function modeBadgeVariant(mode: string): string {
  switch (mode) {
    case "assess":
      return "hf-badge-warning";
    case "teach":
      return "hf-badge-info";
    case "review":
      return "hf-badge-success";
    case "practice":
      return "hf-badge-info";
    default:
      return "hf-badge-muted";
  }
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return "scheduled";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function SnapshotWhyThisCall({ callerId }: SnapshotWhyThisCallProps) {
  const [data, setData] = useState<SchedulerDecisionResponse | null | "error">(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/scheduler-decision`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled)
            setData({ ok: true, callerId, decision: null });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as SchedulerDecisionResponse;
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (data === null) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-why-this-call"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Why this call?</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-why-this-call"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Why this call?</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load scheduler reason
          </span>
        </div>
      </section>
    );
  }

  if (!data.decision) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-why-this-call"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Why this call?</div>
          <span className="hf-badge hf-badge-muted">
            No scheduler decision recorded yet
          </span>
        </div>
      </section>
    );
  }

  const { decision } = data;
  const relative = formatRelative(decision.writtenAt);

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-why-this-call"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Why this call?{" "}
          <span className={`hf-badge ${modeBadgeVariant(decision.mode)}`}>
            {decision.mode}
          </span>
          {relative && (
            <span
              className="hf-text-sm hf-text-muted"
              style={{ marginLeft: 8 }}
            >
              decided {relative}
            </span>
          )}
        </div>
        <div className="hf-text-sm">{decision.reason}</div>
      </div>
    </section>
  );
}
