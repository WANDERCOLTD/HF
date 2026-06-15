"use client";

/**
 * SnapshotInsightsBlock — Wave B of the legacy-tab retirement plan.
 *
 * Surfaces the three computed signals OverviewV2's "At a Glance" +
 * Focus Areas + Achievements cards used to show:
 *   1. Momentum tile (accelerating / steady / slowing / new) +
 *      callStreak + lastCallDaysAgo + totalCalls header
 *   2. Achievements row (badges from streak / mastered modules /
 *      call-count / memory threshold)
 *   3. Focus Areas list (needs_attention + ready_to_advance per
 *      module)
 *
 * Reads `/api/callers/[id]/insights` (new in Wave B). Component owns
 * its own fetch — same pattern as the other Snapshot blocks.
 */

import { useEffect, useState } from "react";

interface SnapshotInsightsBlockProps {
  callerId: string;
}

interface FocusAreaEntry {
  type: "needs_attention" | "ready_to_advance";
  moduleId: string;
  moduleName: string;
  mastery: number;
  reason: string;
  recommendation: string;
}

interface AchievementEntry {
  icon: string;
  label: string;
  value: string;
}

interface InsightsResponse {
  ok: boolean;
  callerId: string;
  momentum: "accelerating" | "steady" | "slowing" | "new";
  callStreak: number;
  lastCallDaysAgo: number | null;
  totalCalls: number;
  focusAreas: FocusAreaEntry[];
  achievements: AchievementEntry[];
}

const MOMENTUM_LABEL: Record<InsightsResponse["momentum"], string> = {
  accelerating: "Accelerating",
  steady: "Steady",
  slowing: "Slowing",
  new: "Just getting started",
};

const MOMENTUM_BADGE: Record<InsightsResponse["momentum"], string> = {
  accelerating: "hf-badge-success",
  steady: "hf-badge-info",
  slowing: "hf-badge-warning",
  new: "hf-badge-muted",
};

const MOMENTUM_TOOLTIP: Record<InsightsResponse["momentum"], string> = {
  accelerating: "Call cadence has increased over the recent window",
  steady: "Consistent call cadence",
  slowing: "Call cadence has decreased — consider re-engagement",
  new: "No call history yet",
};

function focusBadgeVariant(type: FocusAreaEntry["type"]): string {
  return type === "needs_attention"
    ? "hf-badge-warning"
    : "hf-badge-success";
}

export function SnapshotInsightsBlock({ callerId }: SnapshotInsightsBlockProps) {
  const [data, setData] = useState<InsightsResponse | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/insights`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as InsightsResponse;
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
        data-testid="hf-snapshot-insights"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Insights</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-insights"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Insights</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load insights
          </span>
        </div>
      </section>
    );
  }

  const achievements = Array.isArray(data.achievements)
    ? data.achievements
    : [];
  const focusAreas = Array.isArray(data.focusAreas) ? data.focusAreas : [];
  const totalCalls = data.totalCalls ?? 0;
  const callStreak = data.callStreak ?? 0;
  const momentum = (data.momentum ?? "new") as keyof typeof MOMENTUM_LABEL;
  const lastCallDaysAgo = data.lastCallDaysAgo ?? null;
  const lastCallLabel =
    lastCallDaysAgo === null
      ? "no calls yet"
      : lastCallDaysAgo === 0
        ? "last call today"
        : lastCallDaysAgo === 1
          ? "last call yesterday"
          : `last call ${lastCallDaysAgo}d ago`;

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-insights"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Insights
          <span
            className={`hf-badge ${MOMENTUM_BADGE[momentum]}`}
            style={{ marginLeft: 8 }}
            title={MOMENTUM_TOOLTIP[momentum]}
            data-testid="hf-insights-momentum"
          >
            {MOMENTUM_LABEL[momentum]}
          </span>
        </div>
        <div className="hf-text-sm hf-text-muted">
          {totalCalls} call{totalCalls === 1 ? "" : "s"} ·{" "}
          {callStreak > 0 && (
            <>🔥 {callStreak}-call streak · </>
          )}
          {lastCallLabel}
        </div>

        {achievements.length > 0 && (
          <div
            className="hf-snapshot-achievements"
            data-testid="hf-snapshot-achievements"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--gap-1, 4px)",
              marginTop: "var(--gap-2, 12px)",
            }}
          >
            {achievements.map((a, i) => (
              <span
                key={`${a.label}-${i}`}
                className="hf-badge hf-badge-info"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span aria-hidden>{a.icon}</span>
                {a.label}
              </span>
            ))}
          </div>
        )}

        {focusAreas.length > 0 && (
          <div
            className="hf-snapshot-focus-areas"
            data-testid="hf-snapshot-focus-areas"
            style={{ marginTop: "var(--gap-2, 12px)" }}
          >
            <div className="hf-text-sm hf-text-muted">Focus areas</div>
            <ul className="hf-list-row">
              {focusAreas.map((f) => (
                <li key={f.moduleId}>
                  <span className={`hf-badge ${focusBadgeVariant(f.type)}`}>
                    {f.type === "needs_attention"
                      ? "Needs attention"
                      : "Ready to advance"}
                  </span>{" "}
                  <strong>{f.moduleName}</strong>
                  <div className="hf-text-sm hf-text-muted">
                    {f.reason} — {f.recommendation}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {achievements.length === 0 && focusAreas.length === 0 && (
          <div className="hf-text-sm hf-text-muted" style={{ marginTop: 8 }}>
            No achievements or focus areas yet — these build up over the
            first few calls.
          </div>
        )}
      </div>
    </section>
  );
}
