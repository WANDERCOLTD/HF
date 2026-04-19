"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { VerticalSlider, SliderGroup } from "@/components/shared/VerticalSlider";
import { Sparkline } from "@/components/shared/Sparkline";
import { PersonalityRadar, type RadarTrait } from "@/components/shared/PersonalityRadar";
import { SpecPill, GoalPill, PlaybookPill, StatusBadge } from "@/src/components/shared/EntityPill";
import Link from "next/link";
import type { Memory, MemorySummary, PersonalityProfile, PersonalityObservation, ParamConfig } from "./types";
import { CATEGORY_COLORS } from "./constants";
import { useViewMode } from "@/contexts/ViewModeContext";
import { useTerminology } from "@/contexts/TerminologyContext";
import { DotRail, type DotRailStep, type DotState } from "@/components/shared/DotRail";
import type { EnrollmentJourney as EnrollmentJourneyItem } from "@/hooks/useEnrollmentJourney";

export function MemoriesSection({
  memories,
  summary,
  expandedMemory,
  setExpandedMemory,
  hideSummary,
}: {
  memories: Memory[];
  summary: MemorySummary | null;
  expandedMemory: string | null;
  setExpandedMemory: (id: string | null) => void;
  hideSummary?: boolean;
}) {
  const { isAdvanced } = useViewMode();
  return (
    <div>
      {/* Summary Cards - hidden when shown inline in SectionSelector */}
      {!hideSummary && summary && (
        <div className="hf-flex hf-flex-wrap hf-gap-md hf-mb-lg">
          {[
            { label: "Facts", count: summary.factCount, color: CATEGORY_COLORS.FACT },
            { label: "Preferences", count: summary.preferenceCount, color: CATEGORY_COLORS.PREFERENCE },
            { label: "Events", count: summary.eventCount, color: CATEGORY_COLORS.EVENT },
            { label: "Topics", count: summary.topicCount, color: CATEGORY_COLORS.TOPIC },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                padding: "10px 16px",
                background: stat.color.bg,
                borderRadius: 8,
                minWidth: 100,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 600, color: stat.color.text }}>{stat.count}</div>
              <div className="hf-text-xs" style={{ color: stat.color.text }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Memories List */}
      {memories.length === 0 ? (
        <div className="hf-empty-state">
          <div className="hf-empty-state-icon">💭</div>
          <div className="hf-empty-state-title">No memories extracted yet</div>
          <div className="hf-empty-state-desc">Run the Memory Extractor agent</div>
        </div>
      ) : (
        <div className="hf-flex-col hf-gap-sm">
          {memories.map((memory) => {
            const isExpanded = expandedMemory === memory.id;
            const categoryStyle = CATEGORY_COLORS[memory.category] || CATEGORY_COLORS.FACT;
            return (
              <div key={memory.id} style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 8, overflow: "hidden" }}>
                <button
                  onClick={() => setExpandedMemory(isExpanded ? null : memory.id)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: isExpanded ? "var(--background)" : "var(--surface-primary)",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  className="hf-flex-between"
                >
                  <div className="hf-flex hf-gap-md">
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 8px",
                        background: categoryStyle.bg,
                        color: categoryStyle.text,
                        borderRadius: 4,
                      }}
                    >
                      {memory.category}
                    </span>
                    <span className="hf-text-sm hf-text-bold hf-text-secondary">{memory.key}</span>
                    <span className="hf-text-sm hf-text-muted">= &quot;{memory.value}&quot;</span>
                  </div>
                  <div className="hf-flex hf-gap-sm">
                    {memory.decayFactor != null && memory.decayFactor < 1 && (
                      <span className="hf-text-placeholder hf-text-xxs" style={{ opacity: 0.8 }} title={`Decay: ${memory.decayFactor.toFixed(2)}`}>
                        {memory.decayFactor >= 0.8 ? "●" : memory.decayFactor >= 0.5 ? "◐" : "○"}
                      </span>
                    )}
                    <span className="hf-text-placeholder hf-text-xxs">{(memory.confidence * 100).toFixed(0)}%</span>
                    <span className="hf-text-placeholder hf-text-xxs">
                      {(() => {
                        const d = new Date(memory.extractedAt);
                        const now = new Date();
                        const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
                        if (days === 0) return "today";
                        if (days === 1) return "1d ago";
                        if (days < 30) return `${days}d ago`;
                        return `${Math.floor(days / 30)}mo ago`;
                      })()}
                    </span>
                    <div className={`hf-chevron--sm${isExpanded ? " hf-chevron--open" : ""}`}>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                </button>
                {isAdvanced && isExpanded && (
                  <div className="hf-text-sm hf-p-md" style={{ borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
                    {memory.evidence && (
                      <>
                        <div className="hf-text-muted hf-mb-xs hf-text-500">Evidence:</div>
                        <div className="hf-text-secondary hf-mb-sm hf-text-italic">&quot;{memory.evidence}&quot;</div>
                      </>
                    )}
                    <div className="hf-flex hf-flex-wrap hf-gap-lg hf-text-xs hf-text-placeholder">
                      <span>Extracted {new Date(memory.extractedAt).toLocaleString()}</span>
                      {memory.normalizedKey && memory.normalizedKey !== memory.key && (
                        <span>Key: {memory.normalizedKey}</span>
                      )}
                      {memory.decayFactor != null && (
                        <span>Decay: {memory.decayFactor.toFixed(2)}</span>
                      )}
                      {memory.expiresAt && (
                        <span>Expires: {new Date(memory.expiresAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Traits Section (formerly Personality) - FULLY DYNAMIC
export function PersonalitySection({
  personality,
  observations,
  paramConfig,
}: {
  personality: PersonalityProfile | null;
  observations: PersonalityObservation[];
  paramConfig: {
    grouped: Record<string, { parameterId: string; label: string; description: string; color: string; section: string; interpretationHigh?: string; interpretationLow?: string }[]>;
    params: Record<string, { parameterId: string; label: string; description: string; color: string; section: string; interpretationHigh?: string; interpretationLow?: string }>;
  } | null;
}) {
  const { isAdvanced } = useViewMode();
  // Show message if no paramConfig loaded
  if (!paramConfig) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">⚙️</div>
        <div className="hf-empty-state-title">Loading parameter configuration...</div>
        <div className="hf-empty-state-desc">Fetching dynamic parameter metadata from database</div>
      </div>
    );
  }

  if (!personality && observations.length === 0) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">🧠</div>
        <div className="hf-empty-state-title">No trait data yet</div>
        <div className="hf-empty-state-desc">Run analysis to measure personality traits</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
      {/* Aggregated Profile - FULLY DYNAMIC from database */}
      {personality && personality.parameterValues && Object.keys(personality.parameterValues).length > 0 && (
        <div className="hf-card-compact hf-p-20" style={{ marginBottom: 0 }}>
          <h3 className="hf-text-md hf-text-bold hf-text-secondary hf-mb-md">
            Measured Traits
            <span className="hf-text-placeholder" style={{ fontWeight: 400, marginLeft: 8 }}>
              ({Object.keys(personality.parameterValues).length} parameters across {Object.keys(paramConfig.grouped).length} groups)
            </span>
          </h3>

          {/* Radar chart for Big Five personality fingerprint */}
          {(() => {
            const bigFiveParams = paramConfig.grouped["Big Five"] || [];
            const radarTraits: RadarTrait[] = bigFiveParams
              .filter(p => personality.parameterValues[p.parameterId] !== undefined)
              .map(p => ({
                id: p.parameterId,
                label: p.label,
                value: personality.parameterValues[p.parameterId],
                color: p.color,
                interpretationHigh: p.interpretationHigh,
                interpretationLow: p.interpretationLow,
              }));
            if (radarTraits.length < 3) return null;
            return (
              <div className="hf-flex-center hf-mb-lg">
                <PersonalityRadar traits={radarTraits} />
              </div>
            );
          })()}

          {/* Dynamically render all parameter groups from paramConfig.grouped */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
            {Object.entries(paramConfig.grouped).map(([groupName, params]) => {
              // Check if any parameters in this group have values
              const hasValues = params.some(param => personality.parameterValues[param.parameterId] !== undefined);
              if (!hasValues) return null;

              return (
                <div key={groupName}>
                  <div className="hf-category-label hf-mb-md">
                    {groupName}
                  </div>
                  <div className="hf-flex-col hf-gap-lg">
                    {params.map(param => {
                      const value = personality.parameterValues[param.parameterId];
                      if (value === undefined) return null;
                      return (
                        <div key={param.parameterId}>
                          <div className="hf-flex-between hf-mb-xs">
                            <span className="hf-text-sm hf-text-500">{param.label}</span>
                            <span className="hf-text-sm hf-text-bold">{value !== null ? (value * 100).toFixed(0) : "—"}</span>
                          </div>
                          <div className="hf-progress-track">
                            <div
                              className="hf-progress-fill"
                              style={{
                                width: `${(value || 0) * 100}%`,
                                background: param.color,
                              }}
                            />
                          </div>
                          <div className="hf-text-xs hf-text-placeholder hf-mt-xs">{param.description}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {personality.lastUpdatedAt && (
            <div className="hf-text-xs hf-text-placeholder hf-mt-md">
              Last updated: {new Date(personality.lastUpdatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Trait History with Sparklines - Fully Dynamic */}
      {observations.length > 1 && personality && personality.parameterValues && paramConfig && (
        <div className="hf-card-compact hf-p-20" style={{ marginBottom: 0 }}>
          <h3 className="hf-text-md hf-text-bold hf-text-secondary hf-mb-xs">
            📈 Trait History
          </h3>
          <p className="hf-section-desc">
            Showing trends across {observations.length} observations
          </p>

          {/* Dynamic sparklines for ALL parameters from paramConfig */}
          {Object.entries(paramConfig.grouped).map(([groupName, params]) => {
            // Filter params that have historical data
            const paramsWithHistory = params.filter(param => {
              const hasHistory = observations.some((obs: any) => {
                const obsValues = typeof obs.parameterValues === 'string'
                  ? JSON.parse(obs.parameterValues)
                  : (obs.parameterValues || {});
                return obsValues[param.parameterId] !== undefined;
              });
              return hasHistory;
            });

            if (paramsWithHistory.length === 0) return null;

            return (
              <div key={groupName} className="hf-mb-lg">
                <div className="hf-category-label hf-mb-md">
                  {groupName}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  {paramsWithHistory.map(param => {
                    // Get historical values for this parameter from parameterValues
                    const history = observations
                      .map((obs: any) => {
                        const obsValues = typeof obs.parameterValues === 'string'
                          ? JSON.parse(obs.parameterValues)
                          : (obs.parameterValues || {});
                        return obsValues[param.parameterId];
                      })
                      .filter((v): v is number => v !== null && v !== undefined)
                      .slice(-10); // Last 10 observations

                    if (history.length === 0) return null;

                    const currentValue = personality.parameterValues[param.parameterId] || history[history.length - 1];
                    const min = Math.min(...history);
                    const max = Math.max(...history);
                    const range = max - min;

                    // Create sparkline points
                    const width = 100;
                    const height = 30;
                    const points = history.map((value, i) => {
                      const x = (i / (history.length - 1)) * width;
                      const y = range > 0 ? height - ((value - min) / range) * height : height / 2;
                      return `${x},${y}`;
                    }).join(" ");

                    return (
                      <div key={param.parameterId} className="hf-p-12" style={{ background: "var(--surface-secondary)", borderRadius: 8, border: "1px solid var(--border-default)" }}>
                        <div className="hf-flex-between hf-mb-sm">
                          <span className="hf-text-500" style={{ fontSize: 12 }}>{param.label}</span>
                          <span className="hf-text-md hf-text-bold" style={{ color: param.color }}>
                            {((currentValue || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                        <svg width={width} height={height} style={{ width: "100%", height: "30px" }}>
                          <polyline
                            points={points}
                            fill="none"
                            stroke={param.color}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {/* Latest point highlight */}
                          <circle
                            cx={history.length > 1 ? width : width / 2}
                            cy={range > 0 ? height - ((history[history.length - 1] - min) / range) * height : height / 2}
                            r="3"
                            fill={param.color}
                          />
                        </svg>
                        <div className="hf-text-placeholder hf-mt-xs hf-text-xxs">
                          {history.length} observations · Range: {(min * 100).toFixed(0)}%-{(max * 100).toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

{/* Communication Preferences section removed - fields no longer exist in PersonalityProfile */}

      {/* Observations Timeline - DEPRECATED: Legacy OCEAN data only */}
      {/* TODO: Simplify display, enhance with history sparklines showing parameter trends over time */}
      {isAdvanced && observations.length > 0 && (
        <details className="hf-p-20" style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12 }}>
          <summary className="hf-flex hf-gap-sm hf-text-md hf-text-bold hf-text-muted" style={{ cursor: "pointer", listStyle: "none" }}>
            <span className="hf-badge hf-badge-warning">DEPRECATED</span>
            Observation History ({observations.length}) - Legacy Big Five Only
            <span className="hf-text-xs hf-text-placeholder hf-ml-auto">Click to expand</span>
          </summary>
          <div className="hf-text-xs hf-text-placeholder hf-p-12" style={{ marginTop: 12, marginBottom: 16, background: "var(--background)", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
            ⚠️ <strong>Legacy data</strong> - This table stores only Big Five (OCEAN) traits in hardcoded columns.
            <br />Current system uses dynamic <code className="hf-mono" style={{ background: "var(--surface-secondary)", padding: "2px 4px", borderRadius: 3 }}>CallerPersonalityProfile.parameterValues</code> which measures all parameters shown above.
            <br />See TODO in API route: Migrate PersonalityObservation to dynamic storage.
          </div>

          {/* OCEAN Header Row */}
          <div className="hf-flex hf-gap-lg hf-mb-sm" style={{ padding: "8px 0", borderBottom: "2px solid var(--border-default)" }}>
            <span className="hf-text-xs hf-text-bold hf-text-secondary" style={{ width: 140 }}>Date/Time</span>
            <div className="hf-flex hf-gap-sm hf-flex-1">
              {[
                { label: "O", title: "Openness", color: "var(--trait-openness)" },
                { label: "C", title: "Conscientiousness", color: "var(--trait-conscientiousness)" },
                { label: "E", title: "Extraversion", color: "var(--trait-extraversion)" },
                { label: "A", title: "Agreeableness", color: "var(--trait-agreeableness)" },
                { label: "N", title: "Neuroticism", color: "var(--trait-neuroticism)" },
              ].map((trait) => (
                <div key={trait.label} className="hf-flex hf-gap-xs" title={trait.title}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: trait.color, width: 10 }}>{trait.label}</span>
                  <div style={{ width: 40, height: 6 }} />
                </div>
              ))}
            </div>
            <span className="hf-text-secondary hf-text-xxs hf-text-bold">Conf</span>
          </div>

          <div className="hf-flex-col hf-gap-sm">
            {observations.slice(0, 10).map((obs) => (
              <div key={obs.id} className="hf-flex hf-gap-lg" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span className="hf-text-xs hf-text-placeholder" style={{ width: 140 }}>{new Date(obs.observedAt).toLocaleString()}</span>
                <div className="hf-flex hf-gap-sm hf-flex-1">
                  {/* Legacy observations use old field names */}
                  {[
                    { key: "openness", label: "O", color: "var(--trait-openness)" },
                    { key: "conscientiousness", label: "C", color: "var(--trait-conscientiousness)" },
                    { key: "extraversion", label: "E", color: "var(--trait-extraversion)" },
                    { key: "agreeableness", label: "A", color: "var(--trait-agreeableness)" },
                    { key: "neuroticism", label: "N", color: "var(--trait-neuroticism)" },
                  ].map((trait) => {
                    const value = obs[trait.key as keyof PersonalityObservation] as number | null;
                    return (
                      <div key={trait.key} className="hf-flex hf-gap-xs">
                        <span className="hf-text-placeholder hf-text-xxs">{trait.label}</span>
                        <div style={{ width: 40, height: 6, background: "var(--border-default)", borderRadius: 3, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${(value || 0) * 100}%`,
                              background: trait.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <span className="hf-text-placeholder hf-text-xxs">
                  {obs.confidence !== null ? `${(obs.confidence * 100).toFixed(0)}% conf` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// =====================================================
// CALLER SLUGS SECTION - Shows all resolved template variables
// =====================================================

type SlugNode = {
  id: string;
  type: "category" | "spec" | "variable" | "value";
  name: string;
  path?: string;
  value?: string | number | boolean | null;
  specId?: string;
  specSlug?: string;
  children?: SlugNode[];
  meta?: Record<string, any>;
};

export function CallerSlugsSection({ callerId }: { callerId: string }) {
  const [slugsData, setSlugsData] = useState<{
    caller: { id: string; name: string; domain: string | null };
    playbook: { id: string; name: string; status: string } | null;
    tree: SlugNode[];
    counts: { memories: number; scores: number; targets: number; available: number; total: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (loadedForRef.current === callerId) return;
    loadedForRef.current = callerId;
    fetchSlugs();
  }, [callerId]);

  const fetchSlugs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/callers/${callerId}/slugs`);
      const result = await res.json();
      if (result.ok) {
        setSlugsData(result);
        // Auto-expand top-level categories
        const topLevel = new Set<string>();
        result.tree.forEach((node: SlugNode) => topLevel.add(node.id));
        setExpandedNodes(topLevel);
      }
    } catch (err) {
      console.error("Error fetching slugs:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="hf-text-center hf-text-muted" style={{ padding: 40 }}>
        Loading slugs...
      </div>
    );
  }

  if (!slugsData || slugsData.tree.length === 0) {
    const hasAvailableVars = (slugsData?.counts?.available ?? 0) > 0;
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">🏷️</div>
        <div className="hf-empty-state-title">
          {hasAvailableVars ? "No values yet" : "No template variables"}
        </div>
        <div className="hf-empty-state-desc">
          {hasAvailableVars
            ? `${slugsData!.counts.available} template variables are defined but awaiting values.`
            : "This caller has no memories, scores, or personalized targets yet."}
        </div>
        <div className="hf-empty-state-hint">
          Process calls through the pipeline to populate slug values.
        </div>
      </div>
    );
  }

  const categoryIcons: Record<string, string> = {
    IDENTITY: "🎭",
    MEMORIES: "🧠",
    SCORES: "📊",
    "PERSONALIZED TARGETS": "🎯",
    "AVAILABLE VARIABLES": "📋",
  };

  const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
    IDENTITY: { bg: "var(--status-success-bg)", border: "var(--status-success-border)", text: "var(--status-success-text)" },
    MEMORIES: { bg: "var(--status-warning-bg)", border: "var(--status-warning-border)", text: "var(--status-warning-text)" },
    SCORES: { bg: "var(--badge-blue-bg)", border: "var(--status-info-border)", text: "var(--badge-blue-text)" },
    "PERSONALIZED TARGETS": { bg: "var(--badge-pink-bg)", border: "var(--badge-pink-border)", text: "var(--badge-pink-text)" },
    "AVAILABLE VARIABLES": { bg: "var(--surface-secondary)", border: "var(--input-border)", text: "var(--text-muted)" },
  };

  return (
    <div className="hf-flex-col hf-gap-lg">
      {/* Header with context */}
      <div
        className="hf-flex-between hf-p-12"
        style={{
          background: "var(--background)",
          borderRadius: 8,
          border: "1px solid var(--border-default)",
        }}
      >
        <div>
          <div className="hf-text-md hf-text-bold hf-text-secondary">
            Caller Template Variables
          </div>
          <div className="hf-section-desc" style={{ marginBottom: 0, marginTop: 2 }}>
            {slugsData.counts.total} with values: {slugsData.counts.memories} memories, {slugsData.counts.scores} scores, {slugsData.counts.targets} targets
            {slugsData.counts.available > 0 && (
              <span className="hf-text-placeholder" style={{ marginLeft: 8 }}>
                • {slugsData.counts.available} available in templates
              </span>
            )}
          </div>
        </div>
        {slugsData.playbook && (
          <Link
            href={`/x/playbooks/${slugsData.playbook.id}`}
            className="hf-text-xs"
            style={{
              padding: "4px 8px",
              background: "var(--status-info-bg)",
              color: "var(--button-primary-bg)",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            📚 {slugsData.playbook.name}
          </Link>
        )}
      </div>

      {/* Tree view */}
      <div style={{ background: "var(--surface-primary)", border: "1px solid var(--border-default)", borderRadius: 12, overflow: "hidden" }}>
        {slugsData.tree.map((category) => {
          const isExpanded = expandedNodes.has(category.id);
          const colors = categoryColors[category.name] || { bg: "var(--surface-secondary)", border: "var(--border-default)", text: "var(--text-secondary)" };
          const icon = categoryIcons[category.name] || "📁";

          return (
            <div key={category.id}>
              {/* Category header */}
              <div
                onClick={() => toggleNode(category.id)}
                className="hf-flex hf-gap-sm"
                style={{
                  padding: "12px 16px",
                  background: colors.bg,
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: "pointer",
                }}
              >
                <div className={`hf-chevron--sm${isExpanded ? " hf-chevron--open" : ""}`}>
                  <ChevronRight size={14} />
                </div>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span className="hf-text-bold" style={{ color: colors.text }}>{category.name}</span>
                {category.meta?.count !== undefined && (
                  <span style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    background: colors.text,
                    color: "var(--text-on-dark)",
                    borderRadius: 4,
                  }}>
                    {category.meta.count}
                  </span>
                )}
              </div>

              {/* Category children */}
              {isExpanded && category.children && (
                <div style={{ borderBottom: "1px solid var(--border-default)" }}>
                  {category.children.map((spec) => (
                    <SlugSpecNode
                      key={spec.id}
                      spec={spec}
                      expandedNodes={expandedNodes}
                      onToggle={toggleNode}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Spec node component for caller slugs
function SlugSpecNode({
  spec,
  expandedNodes,
  onToggle,
}: {
  spec: SlugNode;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isExpanded = expandedNodes.has(spec.id);
  const hasChildren = spec.children && spec.children.length > 0;

  return (
    <div>
      <div
        onClick={() => hasChildren && onToggle(spec.id)}
        className="hf-flex hf-gap-sm"
        style={{
          padding: "8px 16px 8px 32px",
          background: isExpanded ? "var(--background)" : "var(--surface-primary)",
          borderBottom: "1px solid var(--border-subtle)",
          cursor: hasChildren ? "pointer" : "default",
        }}
      >
        {hasChildren ? (
          <div className={`hf-chevron--sm${isExpanded ? " hf-chevron--open" : ""}`}>
            <ChevronRight size={14} />
          </div>
        ) : (
          <span style={{ width: 20 }} />
        )}
        <span style={{ fontSize: 12 }}>📄</span>
        <span className="hf-text-sm hf-text-secondary hf-text-500">
          {spec.name}
        </span>
        {spec.specSlug && (
          <Link
            href={`/analysis-specs?slug=${spec.specSlug}`}
            onClick={(e) => e.stopPropagation()}
            className="hf-text-muted hf-text-xxs"
            style={{
              textDecoration: "none",
            }}
          >
            ({spec.specSlug})
          </Link>
        )}
        {spec.meta?.count !== undefined && (
          <span className="hf-text-placeholder hf-text-xxs">
            ({spec.meta.count} items)
          </span>
        )}
      </div>

      {/* Variables */}
      {isExpanded && spec.children && (
        <div>
          {spec.children.map((variable) => (
            <SlugVariableNode key={variable.id} variable={variable} />
          ))}
        </div>
      )}
    </div>
  );
}

// Variable node component for caller slugs
function SlugVariableNode({ variable }: { variable: SlugNode }) {
  const [showFull, setShowFull] = useState(false);
  const valueStr = variable.value !== undefined && variable.value !== null
    ? String(variable.value)
    : "—";
  const isLong = valueStr.length > 60;

  return (
    <div
      className="hf-flex hf-gap-sm hf-items-start"
      style={{
        padding: "6px 16px 6px 56px",
        background: "var(--background)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: 12,
      }}
    >
      <code className="hf-mono hf-nowrap" style={{
        padding: "2px 6px",
        background: "var(--border-default)",
        borderRadius: 4,
        color: "var(--text-secondary)",
      }}>
        {variable.path || variable.name}
      </code>
      <span className="hf-text-placeholder">=</span>
      <span
        className="hf-text-secondary hf-flex-1"
        style={{
          wordBreak: "break-word",
          cursor: isLong ? "pointer" : "default",
        }}
        onClick={() => isLong && setShowFull(!showFull)}
        title={isLong ? "Click to expand" : undefined}
      >
        {showFull || !isLong ? valueStr : `${valueStr.substring(0, 60)}...`}
      </span>
      {variable.meta?.confidence !== undefined && (
        <span style={{
          fontSize: 10,
          padding: "1px 4px",
          background: variable.meta.confidence > 0.7 ? "var(--status-success-bg)" : "var(--status-warning-bg)",
          color: variable.meta.confidence > 0.7 ? "var(--status-success-text)" : "var(--status-warning-text)",
          borderRadius: 3,
        }}>
          {(variable.meta.confidence * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

// Enrollment types and constants
type EnrollmentItem = {
  id: string;
  status: string;
  enrolledAt: string;
  enrolledBy: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  droppedAt: string | null;
  playbook: {
    id: string;
    name: string;
    status: string;
    version: string;
    domain?: { id: string; name: string } | null;
  };
};

const ENROLLMENT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)" },
  COMPLETED: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
  PAUSED: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)" },
  DROPPED: { bg: "var(--surface-secondary)", text: "var(--text-muted)" },
};

export function CallerEnrollmentsSection({
  callerId,
  domainId,
  onCountChange,
  enrollmentJourneys,
}: {
  callerId: string;
  domainId: string | null | undefined;
  onCountChange: (count: number) => void;
  enrollmentJourneys?: EnrollmentJourneyItem[];
}) {
  const { terms, plural } = useTerminology();
  const [enrollments, setEnrollments] = useState<EnrollmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [availablePlaybooks, setAvailablePlaybooks] = useState<{ id: string; name: string; version: string }[]>([]);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const enrollLoadedRef = useRef<string | null>(null);

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await fetch(`/api/callers/${callerId}/enrollments`);
      const result = await res.json();
      if (result.ok) {
        setEnrollments(result.enrollments || []);
        onCountChange(result.enrollments?.length || 0);
      }
    } catch (err) {
      console.error("Error fetching enrollments:", err);
    } finally {
      setLoading(false);
    }
  }, [callerId, onCountChange]);

  useEffect(() => {
    if (enrollLoadedRef.current === callerId) return;
    enrollLoadedRef.current = callerId;
    fetchEnrollments();
  }, [fetchEnrollments]);

  const fetchAvailable = async () => {
    if (!domainId) return;
    try {
      const res = await fetch(`/api/domains/${domainId}`);
      const result = await res.json();
      if (result.ok && result.playbooks) {
        const enrolledIds = new Set(enrollments.map((e) => e.playbook.id));
        setAvailablePlaybooks(
          result.playbooks
            .filter((p: any) => p.status === "PUBLISHED" && !enrolledIds.has(p.id))
            .map((p: any) => ({ id: p.id, name: p.name, version: p.version }))
        );
      }
    } catch (err) {
      console.error("Error fetching available playbooks:", err);
    }
  };

  const handleEnroll = async (playbookId: string) => {
    setEnrolling(playbookId);
    try {
      const res = await fetch(`/api/callers/${callerId}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playbookId }),
      });
      if (res.ok) {
        setShowEnroll(false);
        await fetchEnrollments();
      }
    } catch (err) {
      console.error("Error enrolling:", err);
    } finally {
      setEnrolling(null);
    }
  };

  const handleStatusChange = async (enrollmentId: string, newStatus: string) => {
    setUpdating(enrollmentId);
    try {
      const res = await fetch(`/api/callers/${callerId}/enrollments/${enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await fetchEnrollments();
      }
    } catch (err) {
      console.error("Error updating enrollment:", err);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="hf-text-center hf-text-muted hf-p-lg">Loading enrollments...</div>
    );
  }

  if (enrollments.length === 0 && !showEnroll) {
    return (
      <div className="hf-empty-state hf-mt-sm hf-p-lg">
        <div className="hf-text-md hf-text-bold hf-text-secondary hf-mb-xs">No enrolled playbooks</div>
        <div className="hf-section-desc hf-mb-md" style={{ marginBottom: 12 }}>
          This caller is not enrolled in any specific playbooks.
        </div>
        {domainId && (
          <button
            onClick={() => { setShowEnroll(true); fetchAvailable(); }}
            className="hf-btn hf-btn-primary"
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            Enroll in {terms.playbook}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="hf-mt-sm">
      <div className="hf-flex-between hf-mb-sm">
        <span className="hf-category-label">
          Enrolled {plural("playbook")}
        </span>
        {domainId && (
          <button
            onClick={() => { setShowEnroll(!showEnroll); if (!showEnroll) fetchAvailable(); }}
            className="hf-btn hf-text-bold"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 5,
              background: showEnroll ? "var(--surface-secondary)" : "var(--button-primary-bg)",
              color: showEnroll ? "var(--text-secondary)" : "var(--button-primary-text)",
            }}
          >
            {showEnroll ? "Cancel" : "+ Enroll"}
          </button>
        )}
      </div>

      {/* Enroll picker */}
      {showEnroll && (
        <div className="hf-p-md hf-mb-sm" style={{ background: "var(--surface-secondary)", borderRadius: 8 }}>
          {availablePlaybooks.length === 0 ? (
            <div className="hf-section-desc hf-text-center" style={{ marginBottom: 0 }}>
              No more playbooks available to enroll in.
            </div>
          ) : (
            <div className="hf-flex-col hf-gap-xs">
              {availablePlaybooks.map((pb) => (
                <button
                  key={pb.id}
                  onClick={() => handleEnroll(pb.id)}
                  disabled={enrolling === pb.id}
                  className="hf-flex-between hf-text-sm"
                  style={{
                    padding: "8px 12px",
                    background: "var(--surface-primary)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    cursor: enrolling === pb.id ? "not-allowed" : "pointer",
                    opacity: enrolling === pb.id ? 0.6 : 1,
                    color: "var(--text-primary)",
                  }}
                >
                  <span>{pb.name} <span className="hf-text-xs hf-text-muted">v{pb.version}</span></span>
                  <span className="hf-text-xs hf-text-bold" style={{ color: "var(--button-primary-bg)" }}>
                    {enrolling === pb.id ? "Enrolling..." : "Enroll"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Enrollment list */}
      <div className="hf-flex-col" style={{ gap: 6 }}>
        {enrollments.map((enr) => {
          const colors = ENROLLMENT_STATUS_COLORS[enr.status] || ENROLLMENT_STATUS_COLORS.ACTIVE;
          const isUpdating = updating === enr.id;
          const journey = enrollmentJourneys?.find((ej) => ej.playbookId === enr.playbook.id);
          return (
            <div
              key={enr.id}
              style={{
                background: "var(--surface-primary)",
                border: "1px solid var(--border-default)",
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              <div className="hf-flex hf-gap-sm hf-text-sm">
                <Link href={`/x/playbooks/${enr.playbook.id}`} className="hf-flex-1 hf-text-500" style={{ textDecoration: "none", color: "var(--text-primary)" }}>
                  {enr.playbook.name}
                  <span className="hf-text-xs hf-text-muted" style={{ marginLeft: 4 }}>v{enr.playbook.version}</span>
                </Link>
                <span
                  className="hf-text-xxs hf-text-bold"
                  style={{
                    padding: "2px 8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderRadius: 10,
                    background: colors.bg,
                    color: colors.text,
                  }}
                >
                  {enr.status}
                </span>
                {enr.enrolledBy && (
                  <span className="hf-text-placeholder hf-text-xxs">{enr.enrolledBy}</span>
                )}
                {/* Status actions */}
                {!isUpdating && enr.status === "ACTIVE" && (
                  <>
                    <button onClick={() => handleStatusChange(enr.id, "PAUSED")} title="Pause" className="hf-btn-inline hf-text-muted">Pause</button>
                    <button onClick={() => handleStatusChange(enr.id, "COMPLETED")} title="Complete" className="hf-btn-inline" style={{ color: "var(--badge-green-text)" }}>Complete</button>
                  </>
                )}
                {!isUpdating && enr.status === "PAUSED" && (
                  <button onClick={() => handleStatusChange(enr.id, "ACTIVE")} title="Resume" className="hf-btn-inline" style={{ color: "var(--button-primary-bg)" }}>Resume</button>
                )}
                {!isUpdating && enr.status === "DROPPED" && (
                  <button onClick={() => handleStatusChange(enr.id, "ACTIVE")} title="Re-enroll" className="hf-btn-inline" style={{ color: "var(--button-primary-bg)" }}>Re-enroll</button>
                )}
                {isUpdating && (
                  <span className="hf-text-xs hf-text-muted">...</span>
                )}
              </div>
              {/* Journey DotRail */}
              {journey && journey.sessions.length > 0 && (
                <EnrollmentDotRail journey={journey} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function enrollmentDotState(session: number, currentSession: number | null): DotState {
  if (currentSession === null) return "upcoming";
  if (session < currentSession) return "completed";
  if (session === currentSession) return "active";
  return "upcoming";
}

function EnrollmentDotRail({ journey }: { journey: EnrollmentJourneyItem }) {
  const isContinuous = journey.sessions.length === 1 && journey.sessions[0]?.type === "continuous";

  // Continuous mode: show progress bar instead of dots
  if (isContinuous) {
    return (
      <div style={{ marginTop: 6 }}>
        <div className="hf-flex hf-items-center hf-gap-sm">
          <span className="hf-text-xs hf-text-muted">Continuous</span>
          <div style={{
            flex: 1, height: 6, borderRadius: 3,
            background: "var(--surface-secondary)", overflow: "hidden",
          }}>
            <div style={{
              width: "0%", height: "100%", borderRadius: 3,
              background: "var(--accent-primary)", transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      </div>
    );
  }

  const steps: DotRailStep[] = journey.sessions.map((s) => ({
    session: s.session,
    type: s.type,
    label: s.label,
  }));
  const activeSession = journey.sessions.find((s) => s.session === journey.currentSession);

  return (
    <div style={{ marginTop: 6 }}>
      <DotRail
        steps={steps}
        getState={(session) => enrollmentDotState(session, journey.currentSession)}
      />
      {journey.currentSession != null && (
        <div className="hf-text-xs hf-text-muted" style={{ marginTop: 2 }}>
          Session {journey.currentSession} of {journey.totalSessions}
          {activeSession && <> · {activeSession.label}</>}
        </div>
      )}
    </div>
  );
}
