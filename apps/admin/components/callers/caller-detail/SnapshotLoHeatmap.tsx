"use client";

/**
 * SnapshotLoHeatmap — #1661 (Epic #1606 Group C).
 *
 * Per-LO mastery heatmap for the Snapshot v3 tab. Implements the design
 * locked in `docs/decisions/2026-06-14-caller-snapshot-heatmap-grid.md`:
 *
 *   - Fixed grid: every row renders ALL tier-scheme columns; exactly one
 *     cell lit per row (the LO's resolved tier)
 *   - Inactive cells = 1px outline only; active cell = tier-mapped fill
 *     from `lib/banding/tier-colors`
 *   - Awaiting-evidence rows = dashed border across ALL cells (uniform
 *     grid shape — column alignment never breaks)
 *   - Sticky module subhead with module-level avg mastery
 *   - Click cell → side panel with LO description + mastery threshold
 *     (lazy-fetched evidence from /skills-evidence when available)
 *   - Escape / outside click / second click of same cell closes the panel
 *
 * Data wiring: one `/api/callers/[id]/lo-mastery?moduleId=X` per module
 * fired in parallel via `Promise.all`. Module list comes from the
 * Snapshot's already-cached attainment response (passed in as `modules` prop).
 *
 * Side-panel evidence: tries `/api/callers/[id]/skills-evidence?loRef=…`
 * for LO-grain; degrades to the LO's own description + masteryThreshold
 * when the route returns 404 (open question in the issue body — route
 * may need `?loRef=` extension).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AWAITING_EVIDENCE,
  tierBackground,
  tierColor,
  tierLabel,
} from "@/lib/banding/tier-colors";

import "./snapshot-lo-heatmap.css";

interface SnapshotLoHeatmapProps {
  callerId: string;
  modules: Array<{ id: string; slug: string; title: string }>;
  useFreshMastery: boolean;
}

interface LoEntry {
  ref: string;
  description: string;
  mastery: number | null;
  tier: string | null;
  bandLabel: number | null;
  masteryThreshold: number | null;
  status: "mastered" | "in_progress" | "not_started";
  updatedAt: string | null;
}

interface ModuleLoData {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  learningObjectives: LoEntry[];
  /** Average of non-not_started masteries; null when all not_started. */
  averageMastery: number | null;
  /** True when this module's loader returned 404 or threw. */
  error: boolean;
}

interface SelectedCell {
  moduleId: string;
  loRef: string;
  loDescription: string;
  masteryThreshold: number | null;
  mastery: number | null;
  tier: string | null;
}

interface EvidenceExcerpt {
  excerpt: string;
  callId: string | null;
  at: string | null;
}

/**
 * Canonical tier schemes (mirrors `KNOWN_TIER_SCHEMES` in
 * `lib/wizard/project-course-reference.ts`). Cold → hot, left → right.
 */
const TIER_SCHEMES: ReadonlyArray<readonly string[]> = [
  ["foundation", "developing", "practitioner", "distinction"], // 4-tier CTO
  ["emerging", "developing", "secure"], // 3-tier default
  ["a1", "a2", "b1", "b2", "c1", "c2"], // CEFR 6-tier
];

/**
 * Pick the tier scheme that contains every observed tier value. Falls back
 * to 3-tier (the default scheme per `KNOWN_TIER_SCHEMES`) when no observed
 * tiers OR no scheme matches every observation.
 */
function detectTierScheme(observed: string[]): readonly string[] {
  const lower = observed.map((t) => t.toLowerCase()).filter(Boolean);
  if (lower.length === 0) return TIER_SCHEMES[1]; // 3-tier default
  for (const scheme of TIER_SCHEMES) {
    if (lower.every((t) => scheme.includes(t))) return scheme;
  }
  return TIER_SCHEMES[1];
}

export function SnapshotLoHeatmap({
  callerId,
  modules,
  useFreshMastery,
}: SnapshotLoHeatmapProps) {
  const [perModule, setPerModule] = useState<ModuleLoData[] | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [evidence, setEvidence] = useState<EvidenceExcerpt[] | null>(null);
  const [evidenceMissing, setEvidenceMissing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cold-load: parallel fetch per module
  useEffect(() => {
    let cancelled = false;
    if (modules.length === 0) {
      setPerModule([]);
      return;
    }
    const tasks = modules.map(async (m): Promise<ModuleLoData> => {
      try {
        const res = await fetch(
          `/api/callers/${callerId}/lo-mastery?moduleId=${encodeURIComponent(m.id)}`,
        );
        if (!res.ok) {
          return {
            moduleId: m.id,
            moduleSlug: m.slug,
            moduleTitle: m.title,
            learningObjectives: [],
            averageMastery: null,
            error: true,
          };
        }
        const json = (await res.json()) as {
          learningObjectives?: LoEntry[];
        };
        const los = Array.isArray(json.learningObjectives)
          ? json.learningObjectives
          : [];
        const scored = los.filter(
          (l) => l.mastery !== null && l.status !== "not_started",
        );
        const avg =
          scored.length === 0
            ? null
            : scored.reduce((sum, l) => sum + (l.mastery ?? 0), 0) / scored.length;
        return {
          moduleId: m.id,
          moduleSlug: m.slug,
          moduleTitle: m.title,
          learningObjectives: los,
          averageMastery: avg,
          error: false,
        };
      } catch {
        return {
          moduleId: m.id,
          moduleSlug: m.slug,
          moduleTitle: m.title,
          learningObjectives: [],
          averageMastery: null,
          error: true,
        };
      }
    });
    Promise.all(tasks).then((rows) => {
      if (!cancelled) setPerModule(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [callerId, modules]);

  // Lazy-fetch evidence when a cell is selected
  useEffect(() => {
    if (!selected) {
      setEvidence(null);
      setEvidenceMissing(false);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/callers/${callerId}/skills-evidence?loRef=${encodeURIComponent(selected.loRef)}&moduleId=${encodeURIComponent(selected.moduleId)}`,
    )
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) {
            setEvidenceMissing(true);
            setEvidence([]);
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setEvidenceMissing(true);
            setEvidence([]);
          }
          return;
        }
        const j = (await res.json()) as {
          evidence?: Array<{ excerpts?: EvidenceExcerpt[] }>;
        };
        const flat: EvidenceExcerpt[] = [];
        for (const entry of j.evidence ?? []) {
          for (const e of entry.excerpts ?? []) flat.push(e);
        }
        if (!cancelled) {
          setEvidence(flat);
          setEvidenceMissing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvidenceMissing(true);
          setEvidence([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [callerId, selected]);

  // Escape closes the side panel
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  const allObservedTiers = useMemo(() => {
    if (!perModule) return [];
    const set = new Set<string>();
    for (const m of perModule) {
      for (const lo of m.learningObjectives) {
        if (lo.tier && lo.tier !== "not_started") set.add(lo.tier.toLowerCase());
      }
    }
    return Array.from(set);
  }, [perModule]);

  const tierScheme = useMemo(
    () => detectTierScheme(allObservedTiers),
    [allObservedTiers],
  );

  const onCellClick = useCallback(
    (module: ModuleLoData, lo: LoEntry) => {
      setSelected((prev) => {
        if (prev && prev.moduleId === module.moduleId && prev.loRef === lo.ref) {
          return null; // toggle off on second click
        }
        return {
          moduleId: module.moduleId,
          loRef: lo.ref,
          loDescription: lo.description,
          masteryThreshold: lo.masteryThreshold,
          mastery: lo.mastery,
          tier: lo.tier,
        };
      });
    },
    [],
  );

  if (modules.length === 0) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-lo-heatmap-empty"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">LO mastery heatmap</div>
          <span className="hf-badge hf-badge-muted">
            No modules in curriculum yet
          </span>
        </div>
      </section>
    );
  }

  if (perModule === null) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-lo-heatmap-loading"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">LO mastery heatmap</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="hf-snapshot-section hf-lo-heatmap-section"
      ref={containerRef}
      data-testid="hf-snapshot-lo-heatmap"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          LO mastery heatmap
          {useFreshMastery && (
            <span className="hf-badge hf-badge-info" style={{ marginLeft: 8 }}>
              Showing mock-exam scratch mastery — resets at end of session
            </span>
          )}
        </div>

        <div
          className="hf-lo-heatmap-body"
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(120px, 1fr) repeat(${tierScheme.length}, minmax(60px, 1fr)) minmax(110px, auto)`,
          }}
        >
          {/* Column header row */}
          <div className="hf-lo-heatmap-colhdr">&nbsp;</div>
          {tierScheme.map((t) => (
            <div key={`hdr-${t}`} className="hf-lo-heatmap-colhdr">
              {tierLabel(t)}
            </div>
          ))}
          <div className="hf-lo-heatmap-colhdr">Score</div>

          {perModule.map((module) => (
            <ModuleRows
              key={module.moduleId}
              module={module}
              tierScheme={tierScheme}
              selected={selected}
              onCellClick={onCellClick}
            />
          ))}
        </div>
      </div>

      {selected && (
        <aside
          className="hf-lo-heatmap-panel"
          data-testid="hf-snapshot-lo-evidence-panel"
        >
          <div className="hf-card-compact">
            <div className="hf-category-label">
              {selected.loRef} —{" "}
              {selected.tier ? tierLabel(selected.tier) : "Awaiting evidence"}
              <button
                type="button"
                className="hf-lo-heatmap-close"
                aria-label="Close panel"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <div className="hf-text-sm">{selected.loDescription}</div>
            {selected.mastery !== null && (
              <div className="hf-text-sm hf-text-muted">
                Mastery: {selected.mastery.toFixed(2)}
                {selected.masteryThreshold !== null &&
                  ` / threshold ${selected.masteryThreshold.toFixed(2)}`}
              </div>
            )}
            {evidence === null ? (
              <div className="hf-text-sm hf-text-muted">Loading evidence…</div>
            ) : evidence.length === 0 ? (
              <div className="hf-text-sm hf-text-muted">
                {evidenceMissing
                  ? "Evidence not available for this LO yet"
                  : "No evidence recorded for this LO yet"}
              </div>
            ) : (
              <ol className="hf-list-row">
                {evidence.slice(0, 4).map((e, i) => (
                  <li key={i}>
                    <div className="hf-text-sm">{e.excerpt}</div>
                    {e.callId && (
                      <div className="hf-text-sm hf-text-muted">
                        from {e.callId}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      )}
    </section>
  );
}

interface ModuleRowsProps {
  module: ModuleLoData;
  tierScheme: readonly string[];
  selected: SelectedCell | null;
  onCellClick: (module: ModuleLoData, lo: LoEntry) => void;
}

function ModuleRows({
  module,
  tierScheme,
  selected,
  onCellClick,
}: ModuleRowsProps) {
  const avgLabel =
    module.averageMastery === null
      ? "—"
      : module.averageMastery.toFixed(2);
  const colSpan = tierScheme.length + 2; // LO label + tier cells + score
  return (
    <>
      <div
        className="hf-lo-heatmap-modhdr"
        style={{ gridColumn: `1 / span ${colSpan}` }}
        data-testid={`hf-snapshot-lo-modhdr-${module.moduleSlug}`}
      >
        {module.moduleTitle} <span className="hf-text-muted">(avg {avgLabel})</span>
        {module.error && (
          <span className="hf-badge hf-badge-muted" style={{ marginLeft: 8 }}>
            failed to load
          </span>
        )}
      </div>
      {module.learningObjectives.length === 0 && !module.error && (
        <div
          className="hf-text-sm hf-text-muted"
          style={{ gridColumn: `1 / span ${colSpan}` }}
        >
          No learning objectives in this module.
        </div>
      )}
      {module.learningObjectives.map((lo) => (
        <LoRow
          key={`${module.moduleId}-${lo.ref}`}
          module={module}
          lo={lo}
          tierScheme={tierScheme}
          selected={selected}
          onCellClick={onCellClick}
        />
      ))}
    </>
  );
}

interface LoRowProps {
  module: ModuleLoData;
  lo: LoEntry;
  tierScheme: readonly string[];
  selected: SelectedCell | null;
  onCellClick: (module: ModuleLoData, lo: LoEntry) => void;
}

function LoRow({ module, lo, tierScheme, selected, onCellClick }: LoRowProps) {
  const isAwaiting = lo.status === "not_started" || lo.tier === null;
  const activeTier = isAwaiting ? null : (lo.tier ?? "").toLowerCase();
  const isSelectedRow =
    selected !== null &&
    selected.moduleId === module.moduleId &&
    selected.loRef === lo.ref;

  return (
    <>
      <div className="hf-lo-heatmap-lolabel" title={lo.description}>
        <strong>{lo.ref}</strong>{" "}
        <span className="hf-text-muted">{truncate(lo.description, 40)}</span>
      </div>
      {tierScheme.map((t) => {
        const isActive = !isAwaiting && t === activeTier;
        const cellStyle: React.CSSProperties = isAwaiting
          ? {
              borderStyle: "dashed",
              borderWidth: 1,
              borderColor: "var(--text-muted)",
              background: "transparent",
            }
          : isActive
            ? {
                background: tierBackground(t),
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: tierColor(t),
              }
            : {
                borderStyle: "solid",
                borderWidth: 1,
                borderColor: "var(--surface-border)",
                background: "transparent",
              };
        return (
          <button
            type="button"
            key={`${module.moduleId}-${lo.ref}-${t}`}
            className={`hf-lo-heatmap-cell ${isSelectedRow && isActive ? "hf-lo-heatmap-cell-selected" : ""}`}
            style={cellStyle}
            onClick={() => onCellClick(module, lo)}
            aria-label={`${lo.ref} ${tierLabel(t)}${isActive ? " (current)" : ""}`}
            aria-pressed={isSelectedRow && isActive}
            title={
              isAwaiting
                ? `${lo.ref} — ${tierLabel(AWAITING_EVIDENCE)}`
                : `${lo.ref} — ${tierLabel(t)}${isActive && lo.mastery !== null ? ` (${lo.mastery.toFixed(2)})` : ""}`
            }
          >
            &nbsp;
          </button>
        );
      })}
      <div className="hf-lo-heatmap-score">
        {isAwaiting
          ? "Awaiting evidence"
          : lo.mastery !== null
            ? lo.mastery.toFixed(2)
            : "—"}
      </div>
    </>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
