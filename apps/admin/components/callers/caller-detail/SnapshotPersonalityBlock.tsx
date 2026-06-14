"use client";

/**
 * SnapshotPersonalityBlock — #1665 (Epic #1606 Group C Phase 3,
 * folded A.7).
 *
 * Net-new component per Decision 3 from the Group C grooming —
 * deliberately NOT a `compact` prop extension of the existing
 * `PersonalitySection` (`ProfileTab`), `WhoTheyAreV2`
 * (`caller-detail-v2`), or `WhoTheyAreCard` (Guide lens). Keeping it
 * separate locks scope and avoids breaking Profile tab tests.
 *
 * Reads `/api/callers/[id]/personality` (new in this PR). The route
 * partitions `CallerPersonalityProfile.parameterValues` by
 * `Parameter.domainGroup` so the UI can render scan-friendly grouped
 * rows.
 *
 * **Decision 5 (cross-cutting Group C): interpretation strings stay
 * OPERATOR-only.** This component does NOT render
 * `Parameter.interpretationHigh/Low` — the route omits them and the
 * #1664 sweep handles the gated render on OPERATOR-only surfaces.
 *
 * Empty states (from #1665 Open Question 2 — sandbox population
 * follow-up):
 *  - Loading → muted "Loading…" badge
 *  - Fetch error → muted "Unable to load personality profile"
 *  - `profile === null` (no PERS-001 run for this caller yet) →
 *    muted "No personality profile yet" with a hint that it builds
 *    up over calls
 *  - Profile present but `parameters.length === 0` (parameterValues
 *    JSON empty) → same empty-state copy
 */

import { useEffect, useState } from "react";

interface SnapshotPersonalityBlockProps {
  callerId: string;
}

interface PersonalityParameterEntry {
  parameterId: string;
  name: string;
  domainGroup: string;
  value: number;
}

interface PersonalityResponse {
  ok: boolean;
  callerId: string;
  profile: {
    parameters: PersonalityParameterEntry[];
    lastUpdatedAt: string | null;
    callsUsed: number;
    specsUsed: number;
  } | null;
}

function formatDomainGroupLabel(raw: string): string {
  if (!raw) return "Other";
  if (/^[A-Z]{2,}$/.test(raw)) return raw;
  return raw
    .split(/[_\-\s]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function groupByDomain(
  parameters: PersonalityParameterEntry[],
): Array<{ domainGroup: string; entries: PersonalityParameterEntry[] }> {
  const buckets = new Map<string, PersonalityParameterEntry[]>();
  for (const p of parameters) {
    const bucket = buckets.get(p.domainGroup);
    if (bucket) bucket.push(p);
    else buckets.set(p.domainGroup, [p]);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainGroup, entries]) => ({ domainGroup, entries }));
}

export function SnapshotPersonalityBlock({
  callerId,
}: SnapshotPersonalityBlockProps) {
  const [data, setData] = useState<PersonalityResponse | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/personality`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as PersonalityResponse;
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
        data-testid="hf-snapshot-personality"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Who we think they are</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-personality"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Who we think they are</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load personality profile
          </span>
        </div>
      </section>
    );
  }

  if (!data.profile || data.profile.parameters.length === 0) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-personality"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Who we think they are</div>
          <span className="hf-badge hf-badge-muted">
            No personality profile yet — builds up over calls
          </span>
        </div>
      </section>
    );
  }

  const { profile } = data;
  const grouped = groupByDomain(profile.parameters);
  const relative = formatRelative(profile.lastUpdatedAt);

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-personality"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Who we think they are — {profile.parameters.length} signal
          {profile.parameters.length === 1 ? "" : "s"}
          {relative && (
            <span
              className="hf-text-sm hf-text-muted"
              style={{ marginLeft: 8 }}
            >
              updated {relative}
            </span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "var(--gap-2, 12px)",
            marginTop: "var(--gap-1, 4px)",
          }}
        >
          {grouped.map((g) => (
            <PersonalityGroupCard key={g.domainGroup} group={g} />
          ))}
        </div>
        <div className="hf-text-sm hf-text-muted" style={{ marginTop: 6 }}>
          Built from {profile.callsUsed} call{profile.callsUsed === 1 ? "" : "s"}
          {profile.specsUsed > 0 && (
            <> · {profile.specsUsed} spec{profile.specsUsed === 1 ? "" : "s"}</>
          )}
        </div>
      </div>
    </section>
  );
}

interface PersonalityGroupCardProps {
  group: { domainGroup: string; entries: PersonalityParameterEntry[] };
}

function PersonalityGroupCard({ group }: PersonalityGroupCardProps) {
  return (
    <div
      className="hf-card-compact"
      data-testid={`hf-personality-group-${group.domainGroup}`}
      style={{ minWidth: 0 }}
    >
      <div className="hf-category-label">
        {formatDomainGroupLabel(group.domainGroup)} — {group.entries.length}
      </div>
      <ul className="hf-list-row">
        {group.entries.map((p) => (
          <li key={p.parameterId}>
            <strong>{p.name}</strong>
            <span className="hf-text-sm hf-text-muted" style={{ marginLeft: 4 }}>
              {p.value.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
