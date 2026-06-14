"use client";

/**
 * SnapshotSubSkills — #1662 (Epic #1606 Group C Phase 2).
 *
 * Renders the caller's non-skill CallerTarget rows grouped by
 * `Parameter.domainGroup`. Reads from the new
 * `/api/callers/[id]/sub-skills` route shipped in the same PR; the
 * route's `groups` array is rendered as a 3-column responsive card grid.
 *
 * Each parameter row shows: name + score-vs-target + tier badge.
 * "exceeds target" rows get a small success chip; null-score rows get
 * the muted "awaiting evidence" label.
 *
 * `Parameter.interpretationHigh/Low` strings are **deliberately NOT
 * rendered** here — Decision 5 from the Group C grooming locks
 * interpretations as OPERATOR-only and ships the sweep in #1664.
 */

import { useEffect, useState } from "react";

import { tierBackground, tierColor, tierLabel } from "@/lib/banding/tier-colors";

interface SnapshotSubSkillsProps {
  callerId: string;
}

interface SubSkillEntry {
  parameterId: string;
  name: string;
  currentScore: number | null;
  targetValue: number;
  exceedsTarget: boolean;
  tier: string | null;
  callsUsed: number;
}

interface SubSkillGroup {
  domainGroup: string;
  parameters: SubSkillEntry[];
}

interface SubSkillsResponse {
  ok: boolean;
  callerId: string;
  groups: SubSkillGroup[];
}

function formatDomainGroupLabel(raw: string): string {
  if (!raw) return "Other";
  // Acronyms (DISC, COACH, COMP) stay uppercase; words get title-cased.
  if (/^[A-Z]{2,}$/.test(raw)) return raw;
  return raw
    .split(/[_\-\s]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

export function SnapshotSubSkills({ callerId }: SnapshotSubSkillsProps) {
  const [data, setData] = useState<SubSkillsResponse | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/sub-skills`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as SubSkillsResponse;
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
        data-testid="hf-snapshot-subskills"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Sub-skills</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-subskills"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Sub-skills</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load sub-skills
          </span>
        </div>
      </section>
    );
  }

  const groups = Array.isArray(data.groups) ? data.groups : [];
  if (groups.length === 0) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-subskills"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Sub-skills</div>
          <span className="hf-badge hf-badge-muted">No sub-skills tracked yet</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-subskills"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Sub-skills — {groups.length} group{groups.length === 1 ? "" : "s"}
        </div>
        <div
          className="hf-subskills-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "var(--gap-2, 12px)",
            marginTop: "var(--gap-1, 4px)",
          }}
        >
          {groups.map((g) => (
            <SubSkillGroupCard key={g.domainGroup} group={g} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SubSkillGroupCard({ group }: { group: SubSkillGroup }) {
  return (
    <div
      className="hf-card-compact"
      data-testid={`hf-subskill-group-${group.domainGroup}`}
      style={{ minWidth: 0 }}
    >
      <div className="hf-category-label">
        {formatDomainGroupLabel(group.domainGroup)} — {group.parameters.length}
      </div>
      {group.parameters.length === 0 ? (
        <span className="hf-badge hf-badge-muted">No parameters</span>
      ) : (
        <ul className="hf-list-row">
          {group.parameters.map((p) => (
            <li key={p.parameterId}>
              <strong>{p.name}</strong>
              {p.tier ? (
                <span
                  className="hf-badge"
                  style={{
                    marginLeft: 4,
                    background: tierBackground(p.tier),
                    color: tierColor(p.tier),
                    border: `1px solid ${tierColor(p.tier)}`,
                  }}
                >
                  {tierLabel(p.tier)}
                </span>
              ) : (
                <span className="hf-badge hf-badge-muted" style={{ marginLeft: 4 }}>
                  Awaiting evidence
                </span>
              )}
              {p.exceedsTarget && (
                <span
                  className="hf-badge hf-badge-success"
                  style={{ marginLeft: 4 }}
                >
                  exceeds target
                </span>
              )}
              <div className="hf-text-sm hf-text-muted">
                {p.currentScore !== null
                  ? `${p.currentScore.toFixed(2)} / target ${p.targetValue.toFixed(2)}`
                  : `target ${p.targetValue.toFixed(2)}`}
                {p.callsUsed > 0 && (
                  <> · {p.callsUsed} call{p.callsUsed === 1 ? "" : "s"}</>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
