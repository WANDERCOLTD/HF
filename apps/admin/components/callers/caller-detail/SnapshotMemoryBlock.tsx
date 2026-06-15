"use client";

/**
 * SnapshotMemoryBlock — Wave A1 of the legacy-tab retirement plan.
 *
 * Folds the Profile tab's MemoriesSection into Snapshot v3 (per the user
 * decision: Profile retires; memories/slugs/enrollments fold into
 * Snapshot). Renders the 4 category-count tiles (Facts / Prefs / Events /
 * Topics) + a collapsible list of the active memories with confidence +
 * decay + age + evidence excerpt.
 *
 * Read via `/api/callers/[id]/memories` (new in this PR). Component owns
 * its own fetch — matches the pattern from #1662 (sub-skills), #1663
 * (scheduler-decision), #1665 (personality), #1666 (carry-over actions).
 *
 * Decision 5: no interpretation strings here (memories don't carry
 * `Parameter.interpretationHigh/Low`; documented for completeness).
 *
 * Visual contract:
 *  - 4 category tiles always rendered (zero counts shown as muted)
 *  - List collapsed by default; click "Show all <N>" to expand
 *  - Each row: category chip + key/value + confidence pill + age
 *  - Evidence shown in a muted sub-line when present
 */

import { useEffect, useMemo, useState } from "react";

interface SnapshotMemoryBlockProps {
  callerId: string;
}

interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidence: string | null;
  extractedAt: string | null;
  decayFactor: number;
}

interface MemorySummaryEntry {
  factCount: number;
  preferenceCount: number;
  eventCount: number;
  topicCount: number;
  totalCount: number;
  lastMemoryAt: string | null;
}

interface MemoriesResponse {
  ok: boolean;
  callerId: string;
  memories: MemoryEntry[];
  summary: MemorySummaryEntry;
}

const PREVIEW_COUNT = 6;

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function categoryBadgeVariant(category: string): string {
  switch (category.toUpperCase()) {
    case "FACT":
      return "hf-badge-info";
    case "PREFERENCE":
      return "hf-badge-success";
    case "EVENT":
      return "hf-badge-warning";
    case "TOPIC":
      return "hf-badge-info";
    default:
      return "hf-badge-muted";
  }
}

export function SnapshotMemoryBlock({ callerId }: SnapshotMemoryBlockProps) {
  const [data, setData] = useState<MemoriesResponse | null | "error">(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/memories`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as MemoriesResponse;
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  const visible = useMemo(() => {
    if (!data || data === "error") return [];
    const list = Array.isArray(data.memories) ? data.memories : [];
    return expanded ? list : list.slice(0, PREVIEW_COUNT);
  }, [data, expanded]);

  if (data === null) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-memory"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Memory</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-memory"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Memory</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load memory
          </span>
        </div>
      </section>
    );
  }

  const memories = Array.isArray(data.memories) ? data.memories : [];
  const summary: MemorySummaryEntry = data.summary ?? {
    factCount: 0,
    preferenceCount: 0,
    eventCount: 0,
    topicCount: 0,
    totalCount: 0,
    lastMemoryAt: null,
  };
  const tiles = [
    { label: "Facts", count: summary.factCount },
    { label: "Prefs", count: summary.preferenceCount },
    { label: "Events", count: summary.eventCount },
    { label: "Topics", count: summary.topicCount },
  ];
  const lastUpdated = formatRelative(summary.lastMemoryAt);

  if (memories.length === 0 && summary.totalCount === 0) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-memory"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Memory</div>
          <span className="hf-badge hf-badge-muted">
            No memories captured yet — builds up over calls
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="hf-snapshot-section" data-testid="hf-snapshot-memory">
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Memory — {summary.totalCount} captured
          {lastUpdated && (
            <span className="hf-text-sm hf-text-muted" style={{ marginLeft: 8 }}>
              last updated {lastUpdated}
            </span>
          )}
        </div>
        <div
          className="hf-memory-tiles"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
            gap: "var(--gap-1, 4px)",
            marginTop: "var(--gap-1, 4px)",
            marginBottom: "var(--gap-2, 12px)",
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              className="hf-card-compact"
              data-testid={`hf-memory-tile-${t.label.toLowerCase()}`}
              style={{ textAlign: "center", padding: "8px 4px" }}
            >
              <div className="hf-text-sm hf-text-muted">{t.label}</div>
              <div className="hf-text-bold" style={{ fontSize: "1.25rem" }}>
                {t.count}
              </div>
            </div>
          ))}
        </div>
        {memories.length === 0 ? (
          <span className="hf-badge hf-badge-muted">
            Counts present but no individual entries available
          </span>
        ) : (
          <>
            <ol className="hf-list-row">
              {visible.map((m) => (
                <li key={m.id}>
                  <span
                    className={`hf-badge ${categoryBadgeVariant(m.category)}`}
                  >
                    {m.category}
                  </span>{" "}
                  <strong>{m.key}</strong>
                  <span className="hf-text-sm" style={{ marginLeft: 4 }}>
                    {m.value}
                  </span>
                  <div className="hf-text-sm hf-text-muted">
                    confidence {Math.round(m.confidence * 100)}%
                    {m.decayFactor < 1 && (
                      <> · decayed to {Math.round(m.decayFactor * 100)}%</>
                    )}
                    {m.extractedAt && <> · {formatRelative(m.extractedAt)}</>}
                  </div>
                  {m.evidence && (
                    <div className="hf-text-sm hf-text-muted">
                      “{m.evidence}”
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {memories.length > PREVIEW_COUNT && (
              <button
                type="button"
                className="hf-btn hf-btn-secondary hf-btn-sm"
                onClick={() => setExpanded((v) => !v)}
                data-testid="hf-snapshot-memory-toggle"
              >
                {expanded
                  ? `Show fewer`
                  : `Show all ${memories.length} memories`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
