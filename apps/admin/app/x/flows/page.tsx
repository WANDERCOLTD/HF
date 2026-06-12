"use client";

import { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { OrchestratorShell, type SpecDetail, type FeatureSet } from "@/components/orchestrator/OrchestratorShell";
import { FancySelect } from "@/components/shared/FancySelect";
import { DemoFlowView } from "@/components/demo/DemoFlowView";
import { listAllDemos } from "@/lib/demo/registry";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";

// Lazy load heavy supervisor components
const FlowVisualizer = lazy(() => import("@/app/supervisor/components/FlowVisualizer"));
const RunInspector = lazy(() => import("@/app/x/pipeline/components/RunInspector"));

// ============================================================================
// Types
// ============================================================================

type OrchestratorSpec = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  specType: string;
  specRole: string | null;
  outputType: string;
  isActive: boolean;
  isDeletable: boolean;
  version: string | null;
  updatedAt: string;
};

type Domain = {
  id: string;
  slug: string;
  name: string;
};

type SpecInfo = {
  id: string;
  slug: string;
  name: string;
  outputType: string;
  specRole: string | null;
  scope: string;
  isActive: boolean;
  priority: number;
  domain: string | null;
};

type PipelineStage = {
  name: string;
  order: number;
  outputTypes: string[];
  description?: string;
  batched?: boolean;
  requiresMode?: "prep" | "prompt";
  systemSpecs: SpecInfo[];
  domainSpecs: SpecInfo[];
  totalSpecs: number;
};

type SupervisorData = {
  superviseSpec: { id: string; slug: string; name: string } | null;
  domain: Domain | null;
  playbook: { id: string; name: string; status: string } | null;
  stages: PipelineStage[];
  allDomains: Domain[];
  counts: {
    stages: number;
    systemSpecs: number;
    domainSpecs: number;
    totalSpecs: number;
    domains: number;
  };
};

// ============================================================================
// Pipeline Live View (embedded supervisor for PIPELINE-001 tab)
// ============================================================================

function PipelineLiveView() {
  const [activeView, setActiveView] = useState<"flow" | "stages" | "traces">("flow");
  const [data, setData] = useState<SupervisorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    const url = selectedDomainId
      ? `/api/supervisor?domainId=${selectedDomainId}`
      : "/api/supervisor";
    fetch(url)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) setData(result);
        else setError(result.error);
      })
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedDomainId]);

  const outputTypeBadge = (outputType: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      LEARN: { bg: "var(--badge-violet-bg)", color: "var(--badge-violet-text)" },
      MEASURE: { bg: "var(--badge-green-bg)", color: "var(--badge-green-text)" },
      MEASURE_AGENT: { bg: "var(--badge-blue-bg)", color: "var(--badge-blue-text)" },
      AGGREGATE: { bg: "var(--badge-amber-bg)", color: "var(--badge-amber-text)" },
      REWARD: { bg: "var(--badge-red-bg)", color: "var(--badge-red-text)" },
      ADAPT: { bg: "var(--badge-pink-bg)", color: "var(--badge-pink-text)" },
      SUPERVISE: { bg: "var(--badge-orange-bg)", color: "var(--badge-orange-text)" },
      COMPOSE: { bg: "var(--badge-indigo-bg)", color: "var(--badge-indigo-text)" },
    };
    const s = styles[outputType] || { bg: "var(--surface-secondary)", color: "var(--text-muted)" };
    return (
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 500, background: s.bg, color: s.color }}>
        {outputType}
      </span>
    );
  };

  const scopeBadge = (scope: string) => {
    const isSystem = scope === "SYSTEM";
    return (
      <span
        style={{
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 500,
          background: isSystem ? "var(--badge-blue-bg)" : "var(--badge-green-bg)",
          color: isSystem ? "var(--badge-blue-text)" : "var(--badge-green-text)",
        }}
      >
        {scope}
      </span>
    );
  };

  const stageIcon = (stageName: string) => {
    // SECURITY: the `dangerouslySetInnerHTML` consumer of this function (~L326)
    // is safe because every return value comes from a hardcoded dictionary of
    // numeric HTML entities. The `stageName` argument is the LOOKUP key, never
    // the value — a malicious / unknown stage name falls through to the
    // clipboard fallback. There is no path from external input to the rendered
    // HTML. Audit follow-up to HF-M, "what else can we do" sweep.
    const icons: Record<string, string> = {
      EXTRACT: "&#128269;",
      SCORE_AGENT: "&#128202;",
      AGGREGATE: "&#129518;",
      REWARD: "&#11088;",
      ADAPT: "&#127919;",
      SUPERVISE: "&#128065;",
      COMPOSE: "&#9997;",
    };
    return icons[stageName] || "&#128203;";
  };

  const VIEWS = [
    { id: "flow" as const, label: "Flow Visualizer" },
    { id: "stages" as const, label: "Pipeline Stages" },
    { id: "traces" as const, label: "Traces" },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* View selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-default, #e5e7eb)",
          background: "var(--surface-secondary, #f9fafb)",
          flexShrink: 0,
        }}
      >
        {VIEWS.map((v) => {
          const isActive = activeView === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: isActive ? "1px solid var(--accent-primary, #3b82f6)" : "1px solid var(--border-default, #e5e7eb)",
                background: isActive
                  ? "color-mix(in srgb, var(--accent-primary, #3b82f6) 10%, transparent)"
                  : "var(--surface-primary, #fff)",
                color: isActive ? "var(--accent-primary, #3b82f6)" : "var(--text-secondary, #6b7280)",
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {v.label}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* Stats */}
        {data && (
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ fontSize: 11, color: "var(--text-secondary, #6b7280)" }}>
              <strong style={{ color: "var(--button-primary-bg)" }}>{data.counts.stages}</strong> stages
            </span>
            <span style={{ fontSize: 11, color: "var(--text-secondary, #6b7280)" }}>
              <strong style={{ color: "var(--accent-primary)" }}>{data.counts.systemSpecs}</strong> system
            </span>
            <span style={{ fontSize: 11, color: "var(--text-secondary, #6b7280)" }}>
              <strong style={{ color: "var(--status-success-text)" }}>{data.counts.domainSpecs}</strong> domain
            </span>
          </div>
        )}
      </div>

      {/* View content */}
      <div style={{ flex: 1, overflowY: "auto", padding: activeView === "flow" ? 0 : 16 }}>
        {activeView === "flow" && (
          <Suspense
            fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
                <div style={{ width: 32, height: 32, border: "4px solid var(--border-default)", borderTopColor: "var(--button-primary-bg)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              </div>
            }
          >
            <FlowVisualizer />
          </Suspense>
        )}

        {activeView === "traces" && (
          <Suspense
            fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
                <div style={{ width: 32, height: 32, border: "4px solid var(--border-default)", borderTopColor: "var(--button-primary-bg)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              </div>
            }
          >
            <RunInspector />
          </Suspense>
        )}

        {activeView === "stages" && (
          <div>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
                <div style={{ width: 32, height: 32, border: "4px solid var(--border-default)", borderTopColor: "var(--button-primary-bg)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              </div>
            ) : error ? (
              <div style={{ padding: 16, borderRadius: 8, background: "var(--status-error-bg)", border: "1px solid var(--status-error-border)", color: "var(--status-error-text)", fontSize: 13 }}>
                Error: {error}
              </div>
            ) : !data ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--text-tertiary, #9ca3af)", fontSize: 13 }}>
                No data available
              </div>
            ) : (
              <>
                {/* Domain filter */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 16,
                    padding: 12,
                    background: "var(--surface-secondary, #f9fafb)",
                    borderRadius: 8,
                    border: "1px solid var(--border-default, #e5e7eb)",
                  }}
                >
                  <div style={{ width: 260 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--text-secondary, #6b7280)", marginBottom: 4 }}>
                      Filter by Domain
                    </label>
                    <FancySelect
                      value={selectedDomainId}
                      onChange={setSelectedDomainId}
                      placeholder="All Institutions (System specs only)"
                      clearable
                      options={data.allDomains.map((domain) => ({
                        value: domain.id,
                        label: domain.name,
                        subtitle: domain.slug,
                      }))}
                    />
                  </div>
                  <div style={{ flex: 1 }} />
                  {data.superviseSpec && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary, #9ca3af)", marginBottom: 2 }}>Supervise Spec</div>
                      <Link
                        href={`/x/specs?id=${data.superviseSpec.id}`}
                        style={{ fontSize: 12, fontWeight: 500, color: "var(--button-primary-bg)", textDecoration: "none" }}
                      >
                        {data.superviseSpec.slug}
                      </Link>
                    </div>
                  )}
                </div>

                {/* Stages */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {data.stages.map((stage) => (
                    <div
                      key={stage.name}
                      style={{
                        border: "1px solid var(--border-default, #e5e7eb)",
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "var(--surface-primary, #fff)",
                      }}
                    >
                      {/* Stage header */}
                      <div
                        style={{
                          padding: "12px 14px",
                          borderBottom: "1px solid var(--border-default, #e5e7eb)",
                          background: "var(--surface-secondary, #f9fafb)",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 18 }} dangerouslySetInnerHTML={{ __html: stageIcon(stage.name) }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary, #111827)" }}>
                              {stage.order}. {stage.name}
                            </span>
                            {stage.batched && (
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--badge-purple-bg)", color: "var(--badge-purple-text)", fontWeight: 500 }}>
                                BATCHED
                              </span>
                            )}
                            {stage.requiresMode && (
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--status-warning-bg)", color: "var(--status-warning-text)", fontWeight: 500 }}>
                                {stage.requiresMode.toUpperCase()} ONLY
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary, #6b7280)", marginTop: 2 }}>
                            {stage.description || "No description"}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {stage.outputTypes.map((type) => (
                            <span key={type}>{outputTypeBadge(type)}</span>
                          ))}
                          <span style={{ fontSize: 11, color: "var(--text-tertiary, #9ca3af)", marginLeft: 4 }}>
                            {stage.totalSpecs} spec{stage.totalSpecs !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Spec lists */}
                      {stage.systemSpecs.length > 0 && (
                        <div style={{ padding: "10px 14px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #6b7280)", marginBottom: 8 }}>
                            SYSTEM SPECS ({stage.systemSpecs.length})
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {stage.systemSpecs.map((spec) => (
                              <Link
                                key={spec.id}
                                href={`/x/specs?id=${spec.id}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border-default, #e5e7eb)",
                                  background: "var(--surface-primary, #fff)",
                                  textDecoration: "none",
                                  transition: "all 0.15s",
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary, #111827)" }}>{spec.name}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-tertiary, #9ca3af)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.slug}</div>
                                </div>
                                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                  {scopeBadge(spec.scope)}
                                  {outputTypeBadge(spec.outputType)}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {stage.domainSpecs.length > 0 && (
                        <div style={{ padding: "10px 14px", borderTop: stage.systemSpecs.length > 0 ? "1px solid var(--border-default, #e5e7eb)" : undefined }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #6b7280)", marginBottom: 8 }}>
                            DOMAIN SPECS ({stage.domainSpecs.length})
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {stage.domainSpecs.map((spec) => (
                              <Link
                                key={spec.id}
                                href={`/x/specs?id=${spec.id}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border-default, #e5e7eb)",
                                  background: "var(--surface-primary, #fff)",
                                  textDecoration: "none",
                                  transition: "all 0.15s",
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary, #111827)" }}>{spec.name}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-tertiary, #9ca3af)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.slug}</div>
                                </div>
                                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                  {scopeBadge(spec.scope)}
                                  {outputTypeBadge(spec.outputType)}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {stage.systemSpecs.length === 0 && stage.domainSpecs.length === 0 && (
                        <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary, #9ca3af)", fontSize: 12 }}>
                          No specs configured for this stage
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Flows Page
// ============================================================================

/** Derive a short tab label from spec name, removing common suffixes */
function tabLabel(name: string): string {
  return name
    .replace(/\s*(Configuration|Config|Spec|Specification|Flow)\s*$/i, "")
    .trim() || name;
}

/** Known slug for the pipeline spec */
const PIPELINE_SLUG = "spec-pipeline-001";

/** Prefix for demo flow IDs to distinguish them from spec IDs */
const DEMO_PREFIX = "demo:";

export default function FlowsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = searchParams.get("id");

  const [specs, setSpecs] = useState<OrchestratorSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);

  // Per-tab spec detail cache
  const [specDetails, setSpecDetails] = useState<Record<string, { spec: SpecDetail; featureSet: FeatureSet | null }>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Demo flows (static from registry)
  const demoSpecs = listAllDemos();

  // Fetch list of ORCHESTRATE specs
  useEffect(() => {
    setLoading(true);
    fetch("/api/analysis-specs?specRole=ORCHESTRATE")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.specs) {
          setSpecs(data.specs);
        } else if (data.ok && Array.isArray(data)) {
          setSpecs(data);
        }
      })
      .catch((e) => console.warn("[Flows] Failed to load orchestrate specs:", e))
      .finally(() => setLoading(false));
  }, []);

  // Auto-select tab: prefer requestedId, then first spec
  useEffect(() => {
    if (specs.length === 0 && demoSpecs.length === 0) return;
    if (requestedId) {
      // Check specs
      if (specs.some((s) => s.id === requestedId)) {
        setSelectedTabId(requestedId);
        return;
      }
      // Check demo flows
      if (demoSpecs.some((d) => DEMO_PREFIX + d.id === requestedId)) {
        setSelectedTabId(requestedId);
        return;
      }
    }
    if (!selectedTabId || (!specs.some((s) => s.id === selectedTabId) && !selectedTabId.startsWith(DEMO_PREFIX))) {
      // Default to pipeline spec if it exists, otherwise first spec, otherwise first demo
      const pipeline = specs.find((s) => s.slug === PIPELINE_SLUG);
      if (pipeline) setSelectedTabId(pipeline.id);
      else if (specs.length > 0) setSelectedTabId(specs[0].id);
      else if (demoSpecs.length > 0) setSelectedTabId(DEMO_PREFIX + demoSpecs[0].id);
    }
  }, [specs, requestedId, demoSpecs]);

  // Fetch detail for selected tab (only for orchestrate specs, not demos)
  useEffect(() => {
    if (!selectedTabId || selectedTabId.startsWith(DEMO_PREFIX)) return;
    if (specDetails[selectedTabId]) return; // cached

    setDetailLoading(true);
    fetch(`/api/analysis-specs/${selectedTabId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setSpecDetails((prev) => ({
            ...prev,
            [selectedTabId]: { spec: data.spec, featureSet: data.featureSet || null },
          }));
        }
      })
      .catch((e) => console.warn("[Flows] Failed to load spec detail:", e))
      .finally(() => setDetailLoading(false));
  }, [selectedTabId, specDetails]);

  const handleTabSelect = useCallback(
    (id: string) => {
      setSelectedTabId(id);
      router.push(`/x/flows?id=${id}`, { scroll: false });
    },
    [router],
  );

  // Save handler
  const handleSave = useCallback(
    async (updates: { config?: Record<string, unknown>; rawSpec?: Record<string, unknown>; metadata?: Partial<SpecDetail> }) => {
      if (!selectedTabId || selectedTabId.startsWith(DEMO_PREFIX)) return;
      const detail = specDetails[selectedTabId];
      if (!detail) return;

      setSaving(true);
      try {
        if (updates.config) {
          const res = await fetch(`/api/analysis-specs/${detail.spec.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: updates.config }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || "Failed to save config");
        }

        if (updates.metadata) {
          const res = await fetch(`/api/analysis-specs/${detail.spec.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates.metadata),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || "Failed to save metadata");
        }

        if (updates.rawSpec && detail.spec.compiledSetId) {
          const res = await fetch(`/api/analysis-specs/${detail.spec.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rawSpec: updates.rawSpec }),
          });
          const data = await res.json();
          if (!data.ok && data.error) console.warn("rawSpec save:", data.error);
        }

        // Refresh this spec's detail
        const res = await fetch(`/api/analysis-specs/${detail.spec.id}`);
        const data = await res.json();
        if (data.ok) {
          setSpecDetails((prev) => ({
            ...prev,
            [selectedTabId]: { spec: data.spec, featureSet: data.featureSet || null },
          }));
        }

        // Refresh list
        const listRes = await fetch("/api/analysis-specs?specRole=ORCHESTRATE");
        const listData = await listRes.json();
        if (listData.ok && listData.specs) setSpecs(listData.specs);

        setToast({ message: "Saved successfully", type: "success" });
      } catch (err: any) {
        setToast({ message: err.message || "Save failed", type: "error" });
      } finally {
        setSaving(false);
        setTimeout(() => setToast(null), 3000);
      }
    },
    [selectedTabId, specDetails],
  );

  const selectedDetail = selectedTabId && !selectedTabId.startsWith(DEMO_PREFIX) ? specDetails[selectedTabId] : null;
  const selectedSpec = specs.find((s) => s.id === selectedTabId);
  const isPipeline = selectedSpec?.slug === PIPELINE_SLUG;
  const isDemo = selectedTabId?.startsWith(DEMO_PREFIX);
  const selectedDemo = isDemo ? demoSpecs.find((d) => DEMO_PREFIX + d.id === selectedTabId) : null;

  // Build FancySelect options: orchestrate specs + demo flows
  const flowOptions = [
    ...specs.map((s) => ({
      value: s.id,
      label: tabLabel(s.name),
      subtitle: s.slug,
      badge: s.isActive ? "Active" : "Inactive",
    })),
    ...demoSpecs.map((d) => ({
      value: DEMO_PREFIX + d.id,
      label: `${d.icon} ${d.title}`,
      subtitle: `${d.steps.length} steps · Demo Flow`,
      badge: "Demo",
    })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      <AdvancedBanner />
      {/* Top bar with FancySelect picker */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-default, #e5e7eb)",
          background: "var(--surface-primary, #fff)",
          flexShrink: 0,
        }}
      >
        {/* Page title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary, #3b82f6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary, #111827)" }}>
            Flows
          </span>
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: "var(--border-default, #e5e7eb)", flexShrink: 0 }} />

        {/* Flow picker */}
        <div style={{ width: 340 }}>
          {loading ? (
            <span style={{ fontSize: 12, color: "var(--text-tertiary, #9ca3af)", padding: "6px 0" }}>Loading...</span>
          ) : (
            <FancySelect
              value={selectedTabId || ""}
              onChange={handleTabSelect}
              options={flowOptions}
              placeholder="Select a flow..."
              searchable
            />
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Context badge */}
        {selectedDemo && (
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "color-mix(in srgb, var(--accent-primary, #7c3aed) 12%, transparent)", color: "var(--accent-primary, #7c3aed)", fontWeight: 600 }}>
            Demo Flow · {selectedDemo.steps.length} steps
          </span>
        )}
        {selectedSpec && (
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "color-mix(in srgb, var(--accent-primary, #3b82f6) 12%, transparent)", color: "var(--accent-primary, #3b82f6)", fontWeight: 600 }}>
            {selectedSpec.isActive ? "Active" : "Inactive"} · {selectedSpec.slug}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {isDemo && selectedDemo ? (
          /* Demo flow visualization */
          <DemoFlowView spec={selectedDemo} onStepClick={(stepIndex) => {
            router.push(`/x/demos/${selectedDemo.id}`);
          }} />
        ) : detailLoading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-tertiary, #9ca3af)",
              fontSize: 13,
            }}
          >
            Loading spec...
          </div>
        ) : selectedDetail ? (
          <OrchestratorShell
            key={selectedTabId}
            spec={selectedDetail.spec}
            featureSet={selectedDetail.featureSet}
            onSave={handleSave}
            saving={saving}
            extraTabs={isPipeline ? [{ id: "live-view", label: "Live View" }] : undefined}
            renderExtraTab={isPipeline ? (tabId) => {
              if (tabId === "live-view") return <PipelineLiveView />;
              return null;
            } : undefined}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-tertiary, #9ca3af)",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Flows</div>
            <div style={{ fontSize: 12 }}>Select a flow to view and edit</div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            padding: "10px 16px",
            borderRadius: 8,
            background: toast.type === "success" ? "var(--status-success-text)" : "var(--status-error-text)",
            color: "white",
            fontSize: 12,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
