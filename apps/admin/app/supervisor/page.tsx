"use client";

import React, { useState, useEffect, Suspense, lazy } from "react";
import Link from "next/link";
import { FancySelect } from "@/components/shared/FancySelect";
import { Workflow, ClipboardList, FileSearch } from "lucide-react";

// Lazy load heavy components
const FlowVisualizer = lazy(() => import("./components/FlowVisualizer"));
const RunInspector = lazy(() => import("@/app/x/pipeline/components/RunInspector"));

type TabId = "stages" | "flow" | "traces";

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

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "flow", label: "Flow Visualizer", icon: <Workflow size={14} /> },
  { id: "stages", label: "Pipeline Stages", icon: <ClipboardList size={14} /> },
  { id: "traces", label: "Traces", icon: <FileSearch size={14} /> },
];

export default function SupervisorPage() {
  const [activeTab, setActiveTab] = useState<TabId>("flow");
  const [data, setData] = useState<SupervisorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const url = selectedDomainId
        ? `/api/supervisor?domainId=${selectedDomainId}`
        : "/api/supervisor";
      const res = await fetch(url);
      const result = await res.json();

      if (result.ok) {
        setData(result);
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: s.bg, color: s.color }}
      >
        {outputType}
      </span>
    );
  };

  const scopeBadge = (scope: string) => {
    const isSystem = scope === "SYSTEM";
    return (
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          isSystem
            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
        }`}
      >
        {scope}
      </span>
    );
  };

  const stageIcon = (stageName: string) => {
    const icons: Record<string, string> = {
      EXTRACT: "🔍",
      SCORE_AGENT: "📊",
      AGGREGATE: "🧮",
      REWARD: "⭐",
      ADAPT: "🎯",
      SUPERVISE: "👁️",
      COMPOSE: "✍️",
    };
    return icons[stageName] || "📋";
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-3">
              <span className="text-2xl">👁️</span>
              Pipeline Supervisor
            </h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              View pipeline configuration, specs by stage, and execution flow
            </p>
          </div>
          {data && (
            <div className="flex gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{data.counts.stages}</div>
                <div className="text-xs text-neutral-500">Stages</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.counts.systemSpecs}</div>
                <div className="text-xs text-neutral-500">System</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.counts.domainSpecs}</div>
                <div className="text-xs text-neutral-500">Domain</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "stages" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-red-600 dark:text-red-400">
              Error: {error}
            </div>
          ) : !data ? (
            <div className="text-neutral-500 text-center py-12">No data available</div>
          ) : (
            <>
              {/* Controls Bar */}
              <div className="flex items-center gap-4 mb-6 p-4 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
                <div style={{ width: 280 }}>
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
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
                <div className="flex-1" />

                {data.superviseSpec && (
                  <div className="text-right">
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Supervise Spec</div>
                    <Link
                      href={`/x/specs?id=${data.superviseSpec.id}`}
                      className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {data.superviseSpec.slug}
                    </Link>
                  </div>
                )}

                {data.playbook && (
                  <div className="text-right">
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Playbook</div>
                    <Link
                      href={`/playbooks/${data.playbook.id}`}
                      className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {data.playbook.name}
                    </Link>
                  </div>
                )}
              </div>

              {/* Pipeline Stages */}
              <div className="space-y-4">
                {data.stages.map((stage) => (
                  <div
                    key={stage.name}
                    className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden bg-white dark:bg-neutral-800"
                  >
                    {/* Stage Header */}
                    <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/80">
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">{stageIcon(stage.name)}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                              {stage.order}. {stage.name}
                            </span>
                            {stage.batched && (
                              <span className="text-[10px] px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded font-medium">
                                BATCHED
                              </span>
                            )}
                            {stage.requiresMode && (
                              <span className="text-[10px] px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded font-medium">
                                {stage.requiresMode.toUpperCase()} ONLY
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                            {stage.description || "No description"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {stage.outputTypes.map((type) => (
                              <span key={type}>{outputTypeBadge(type)}</span>
                            ))}
                          </div>
                          <span className="text-xs font-medium text-neutral-400 ml-2">
                            {stage.totalSpecs} spec{stage.totalSpecs !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Specs */}
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                      {/* System Specs */}
                      {stage.systemSpecs.length > 0 && (
                        <div className="p-4">
                          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-3 flex items-center gap-2">
                            <span className="text-sm">⚙️</span>
                            SYSTEM SPECS ({stage.systemSpecs.length})
                          </div>
                          <div className="grid gap-3">
                            {stage.systemSpecs.map((spec) => (
                              <Link
                                key={spec.id}
                                href={`/x/specs?id=${spec.id}`}
                                className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition-all group"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                    {spec.name}
                                  </div>
                                  <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                                    {spec.slug}
                                  </div>
                                </div>
                                <div className="flex gap-1.5 flex-shrink-0">
                                  {scopeBadge(spec.scope)}
                                  {outputTypeBadge(spec.outputType)}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Domain Specs */}
                      {stage.domainSpecs.length > 0 && (
                        <div className="p-4">
                          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-3 flex items-center gap-2">
                            <span className="text-sm">🏢</span>
                            DOMAIN SPECS ({stage.domainSpecs.length})
                          </div>
                          <div className="grid gap-3">
                            {stage.domainSpecs.map((spec) => (
                              <Link
                                key={spec.id}
                                href={`/x/specs?id=${spec.id}`}
                                className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition-all group"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                    {spec.name}
                                  </div>
                                  <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                                    {spec.slug}
                                  </div>
                                </div>
                                <div className="flex gap-1.5 flex-shrink-0">
                                  {scopeBadge(spec.scope)}
                                  {outputTypeBadge(spec.outputType)}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Empty State */}
                      {stage.systemSpecs.length === 0 && stage.domainSpecs.length === 0 && (
                        <div className="p-8 text-center text-neutral-400 text-sm">
                          No specs configured for this stage
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "flow" && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          }
        >
          <FlowVisualizer />
        </Suspense>
      )}

      {activeTab === "traces" && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
          }
        >
          <RunInspector />
        </Suspense>
      )}
    </div>
  );
}
