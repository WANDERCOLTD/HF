"use client";

import "./metering.css";
import { useState, useMemo } from "react";
import { useApiParallel } from "@/hooks/useApi";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";

// Category colors
const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  AI: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", border: "var(--badge-blue-border)" },
  DATABASE: { bg: "var(--badge-amber-bg, #fef3c7)", text: "var(--badge-amber-text, #b45309)", border: "var(--badge-amber-border, #fcd34d)" },
  COMPUTE: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text, #047857)", border: "var(--badge-green-border, #6ee7b7)" },
  STORAGE: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)", border: "var(--badge-indigo-border, #a5b4fc)" },
  EXTERNAL: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)", border: "var(--badge-pink-border)" },
};

// AI Provider colors - distinct dots for each provider
const PROVIDER_COLORS: Record<string, { dot: string; bg: string; text: string; border: string; label: string }> = {
  anthropic: { dot: "var(--badge-purple-text)", bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)", border: "var(--badge-purple-border)", label: "Claude" },
  openai: { dot: "var(--badge-green-text)", bg: "var(--badge-green-bg)", text: "var(--badge-green-text)", border: "var(--badge-green-border)", label: "OpenAI" },
  mock: { dot: "var(--badge-gray-text)", bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", border: "var(--badge-gray-border)", label: "Mock" },
  unknown: { dot: "var(--badge-blue-text)", bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", border: "var(--badge-blue-border)", label: "Other" },
};

// Helper: Derive provider from model name or engine
function getProvider(model?: string | null, engine?: string | null): string {
  const m = (model || "").toLowerCase();
  const e = (engine || "").toLowerCase();

  if (e === "mock" || m.includes("mock")) return "mock";
  if (m.startsWith("claude") || m.includes("anthropic") || e === "anthropic") return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.includes("openai") || e === "openai") return "openai";
  return "unknown";
}

// Provider dot component
function ProviderDot({ provider, size = 8 }: { provider: string; size?: number }) {
  const colors = PROVIDER_COLORS[provider] || PROVIDER_COLORS.unknown;
  return (
    <span
      className="metering-dot"
      title={colors.label}
      style={{ width: size, height: size, backgroundColor: colors.dot }}
    />
  );
}

interface SummaryData {
  period: { days: number; startDate: string; endDate: string };
  totals: { eventCount: number; totalCostCents: number; totalCostDollars: string };
  today: { eventCount: number; costCents: number; costDollars: string };
  monthToDate: { eventCount: number; costCents: number; costDollars: string };
  byCategory: Array<{
    category: string;
    eventCount: number;
    totalQty: number;
    costCents: number;
    costDollars: string;
  }>;
  topOperations: Array<{
    category: string;
    operation: string;
    eventCount: number;
    totalQty: number;
    costCents: number;
    costDollars: string;
  }>;
  dailyTrend: Array<{
    date: string;
    category: string;
    eventCount: number;
    totalQty: number;
    costCents: number;
  }>;
  aiByCallPoint?: Array<{
    callPoint: string;
    model: string;
    eventCount: number;
    totalTokens: number;
    costCents: number;
    costDollars: string;
  }>;
  uncategorizedAI?: {
    eventCount: number;
    totalTokens: number;
    costCents: number;
    costDollars: string;
  };
  aiByEngine?: Array<{
    engine: string;
    eventCount: number;
    totalQty: number;
    costCents: number;
    costDollars: string;
    isMock: boolean;
  }>;
  aiSummary?: {
    mock: { eventCount: number; costCents: number; costDollars: string };
    real: { eventCount: number; totalTokens: number; costCents: number; costDollars: string };
    mockPercentage: number;
  };
}

interface RecentEvent {
  id: string;
  category: string;
  operation: string;
  quantity: number;
  unitType: string;
  costCents: number;
  createdAt: string;
  userId: string | null;
  callerId: string | null;
  model?: string | null;
  engine?: string | null;
}

interface BreakdownsData {
  byCaller: Array<{
    callerId: string;
    callerName: string | null;
    callerEmail: string | null;
    callerPhone: string | null;
    domainSlug: string | null;
    domainName: string | null;
    eventCount: number;
    totalCostCents: number;
    costDollars: string;
  }>;
  byDomain: Array<{
    domainId: string | null;
    domainSlug: string | null;
    domainName: string | null;
    callerCount: number;
    eventCount: number;
    totalCostCents: number;
    costDollars: string;
  }>;
  mostExpensive: Array<{
    category: string;
    operation: string;
    eventCount: number;
    totalQty: number;
    avgCostCents: number;
    totalCostCents: number;
    costDollars: string;
  }>;
  mostUsed: Array<{
    category: string;
    operation: string;
    eventCount: number;
    totalQty: number;
    totalCostCents: number;
    costDollars: string;
  }>;
  attribution: {
    totalEvents: number;
    attributedEvents: number;
    unattributedEvents: number;
    attributionRate: number;
  };
}

type TabId = "overview" | "expensive" | "used" | "caller" | "domain";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "expensive", label: "Most Expensive" },
  { id: "used", label: "Most Used" },
  { id: "caller", label: "By Caller" },
  { id: "domain", label: "By Domain" },
];

// Attribution info banner
function AttributionBanner({ attribution }: { attribution: BreakdownsData["attribution"] }) {
  if (!attribution || attribution.totalEvents === 0) return null;
  return (
    <div className="hf-banner hf-banner-info hf-mb-md">
      {attribution.attributedEvents.toLocaleString()} of {attribution.totalEvents.toLocaleString()} events
      ({attribution.attributionRate}%) are attributed to a caller.
      {attribution.unattributedEvents > 0 && (
        <span style={{ opacity: 0.8 }}>
          {" "}{attribution.unattributedEvents.toLocaleString()} events have no caller attribution
          (system operations, admin actions, etc.)
        </span>
      )}
    </div>
  );
}

export default function MeteringPage() {
  const [days, setDays] = useState(30);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Fetch summary, events, and breakdowns in parallel
  const { data, loading, error } = useApiParallel<{
    summary: SummaryData;
    events: RecentEvent[];
    breakdowns: BreakdownsData;
  }>(
    {
      summary: {
        url: `/api/metering/summary?days=${days}`,
        transform: (res) => res as unknown as SummaryData,
      },
      events: {
        url: "/api/metering/events?limit=50",
        transform: (res) => (res.events as RecentEvent[]) || [],
      },
      breakdowns: {
        url: `/api/metering/summary/breakdowns?days=${days}`,
        transform: (res) => res as unknown as BreakdownsData,
      },
    },
    [days]
  );

  const summary = data.summary;
  const recentEvents = data.events || [];
  const breakdowns = data.breakdowns;

  // Compute provider breakdown from aiByCallPoint
  const providerBreakdown = useMemo(() => {
    if (!summary?.aiByCallPoint) return [];

    const byProvider: Record<string, { eventCount: number; costCents: number; tokens: number }> = {};

    for (const cp of summary.aiByCallPoint) {
      const provider = getProvider(cp.model);
      if (!byProvider[provider]) {
        byProvider[provider] = { eventCount: 0, costCents: 0, tokens: 0 };
      }
      byProvider[provider].eventCount += cp.eventCount;
      byProvider[provider].costCents += cp.costCents;
      byProvider[provider].tokens += cp.totalTokens;
    }

    // Also include mock from aiByEngine if not in callPoints
    if (summary.aiByEngine) {
      for (const eng of summary.aiByEngine) {
        const provider = eng.engine === "mock" ? "mock" : getProvider(null, eng.engine);
        if (!byProvider[provider]) {
          byProvider[provider] = { eventCount: 0, costCents: 0, tokens: 0 };
        }
        // Only add if not already counted (engine-level might overlap)
      }
    }

    return Object.entries(byProvider)
      .map(([provider, data]) => ({
        provider,
        ...data,
        costDollars: (data.costCents / 100).toFixed(2),
      }))
      .sort((a, b) => b.costCents - a.costCents);
  }, [summary]);

  // Total AI cost for percentage calculation
  const totalAICost = useMemo(() => {
    return providerBreakdown.reduce((sum, p) => sum + p.costCents, 0);
  }, [providerBreakdown]);

  if (loading) {
    return (
      <div className="hf-page-container metering-page">
        <div className="hf-text-center hf-p-lg">
          <div className="hf-stat-value hf-mb-md">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-page-container metering-page">
        <div className="hf-banner hf-banner-error">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="hf-page-container metering-page">
      <AdvancedBanner />
      {/* Header */}
      <div className="hf-mb-lg">
        <h1 className="hf-page-title">Resource Metering</h1>
        <p className="hf-page-subtitle">
          Track usage and costs across AI, database, compute, storage, and external services
        </p>
      </div>

      {/* Period Selector */}
      <div className="hf-flex hf-gap-sm hf-mb-md">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`metering-period-btn${days === d ? " metering-period-btn-active" : ""}`}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="metering-tab-bar hf-mb-lg">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`metering-tab${activeTab === tab.id ? " metering-tab-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===================== OVERVIEW TAB ===================== */}
      {activeTab === "overview" && (
        <>
          {/* Summary Cards Row */}
          <div className="metering-summary-grid hf-mb-lg">
            {/* Total Cost Card */}
            <div className="metering-stat-card">
              <div className="hf-text-sm hf-text-secondary hf-mb-sm">
                Total Cost ({days}d)
              </div>
              <div className="metering-stat-value">
                ${summary?.totals.totalCostDollars || "0.00"}
              </div>
              <div className="metering-stat-sublabel">
                {summary?.totals.eventCount.toLocaleString() || 0} events
              </div>
            </div>

            {/* Today Card */}
            <div className="metering-stat-card">
              <div className="hf-text-sm hf-text-secondary hf-mb-sm">Today</div>
              <div className="metering-stat-value">
                ${summary?.today.costDollars || "0.00"}
              </div>
              <div className="metering-stat-sublabel">
                {summary?.today.eventCount.toLocaleString() || 0} events
              </div>
            </div>

            {/* MTD Card */}
            <div className="metering-stat-card">
              <div className="hf-text-sm hf-text-secondary hf-mb-sm">
                Month to Date
              </div>
              <div className="metering-stat-value">
                ${summary?.monthToDate.costDollars || "0.00"}
              </div>
              <div className="metering-stat-sublabel">
                {summary?.monthToDate.eventCount.toLocaleString() || 0} events
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="metering-category-grid hf-mb-lg">
            {(summary?.byCategory || []).map((cat) => {
              const colors = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.AI;
              return (
                <div
                  key={cat.category}
                  className="metering-category-card"
                  style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
                >
                  <div className="hf-mb-sm" style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
                    {cat.category}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>
                    ${cat.costDollars}
                  </div>
                  <div className="hf-text-xs" style={{ color: colors.text, opacity: 0.8 }}>
                    {cat.eventCount.toLocaleString()} events
                  </div>
                </div>
              );
            })}

            {/* Show placeholder if no data */}
            {(!summary?.byCategory || summary.byCategory.length === 0) && (
              <div className="metering-full-span metering-empty">
                No usage data yet. Start using AI, running pipelines, or processing
                transcripts to see metering data.
              </div>
            )}
          </div>

          {/* AI Usage Section */}
          {((summary?.aiByCallPoint?.length ?? 0) > 0 || providerBreakdown.length > 0) && (
            <div className="metering-ai-section hf-mb-lg">
              <div className="hf-flex-between hf-mb-md">
                <h2 className="metering-h2-accent">
                  AI Usage
                </h2>
                <a href="/x/ai-config" className="metering-link">
                  Configure Models &rarr;
                </a>
              </div>

              {/* Mock vs Real Summary */}
              {summary?.aiSummary && (summary.aiSummary.mock.eventCount > 0 || summary.aiSummary.real.eventCount > 0) && (
                <div
                  className="hf-mb-md hf-p-md"
                  style={{
                    background: summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-bg)" : "var(--status-success-bg)",
                    border: `1px solid ${summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-border)" : "var(--status-success-border)"}`,
                    borderRadius: 10,
                  }}
                >
                  <div className="hf-flex-between">
                    <div>
                      <div className="hf-text-sm hf-text-bold hf-mb-sm" style={{ color: summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-text)" : "var(--status-success-text)" }}>
                        {summary.aiSummary.mockPercentage > 50 ? "⚠️ Mostly Mock Calls" : "✓ Real AI Calls"}
                      </div>
                      <div style={{ fontSize: 12, color: summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-text)" : "var(--status-success-text)" }}>
                        {summary.aiSummary.real.eventCount.toLocaleString()} real calls (${summary.aiSummary.real.costDollars})
                        {summary.aiSummary.mock.eventCount > 0 && (
                          <span> &middot; {summary.aiSummary.mock.eventCount.toLocaleString()} mock calls ($0.00)</span>
                        )}
                      </div>
                    </div>
                    <div className="hf-text-center">
                      <div style={{ fontSize: 24, fontWeight: 700, color: summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-text)" : "var(--status-success-text)" }}>
                        {100 - summary.aiSummary.mockPercentage}%
                      </div>
                      <div className="hf-text-xs hf-text-muted">real calls</div>
                    </div>
                  </div>
                  {summary.aiSummary.mockPercentage > 0 && (
                    <div className="metering-progress-track hf-mt-sm">
                      <div
                        className="metering-progress-fill"
                        style={{
                          width: `${100 - summary.aiSummary.mockPercentage}%`,
                          background: summary.aiSummary.mockPercentage > 50 ? "var(--status-warning-border)" : "var(--status-success-text)",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Provider Summary Cards */}
              {providerBreakdown.length > 0 && (
                <div className="hf-mb-md">
                  <div className="metering-sub-label">By Provider</div>
                  <div className="hf-flex-wrap hf-gap-md">
                    {providerBreakdown.map((p) => {
                      const colors = PROVIDER_COLORS[p.provider] || PROVIDER_COLORS.unknown;
                      const pct = totalAICost > 0 ? Math.round((p.costCents / totalAICost) * 100) : 0;
                      return (
                        <div
                          key={p.provider}
                          className="metering-provider-card"
                          style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
                        >
                          <div className="hf-flex hf-gap-xs hf-mb-sm">
                            <ProviderDot provider={p.provider} size={10} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
                              {colors.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>
                            ${p.costDollars}
                          </div>
                          <div className="hf-text-xs" style={{ color: colors.text, opacity: 0.8 }}>
                            {pct}% &middot; {p.eventCount.toLocaleString()} calls
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By Call Point */}
              {(summary?.aiByCallPoint?.length ?? 0) > 0 && (
                <>
                  <div className="metering-sub-label">By Call Point</div>
                  <div className="metering-callpoint-grid">
                    {summary?.aiByCallPoint?.map((cp, i) => {
                      const provider = getProvider(cp.model);
                      const colors = PROVIDER_COLORS[provider] || PROVIDER_COLORS.unknown;
                      return (
                        <div
                          key={`${cp.callPoint}-${cp.model}-${i}`}
                          className="metering-callpoint-card"
                        >
                          <div className="hf-flex" style={{ alignItems: "flex-start", gap: 10, flex: 1 }}>
                            <ProviderDot provider={provider} size={8} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="hf-text-sm" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                                {cp.callPoint}
                              </div>
                              <div className="hf-text-xs hf-text-muted hf-mt-sm">
                                <span style={{ color: colors.text, fontWeight: 500 }}>{colors.label}</span>
                                {" · "}
                                {cp.model}
                                {" · "}
                                {cp.eventCount.toLocaleString()} calls
                                {" · "}
                                {Math.round(cp.totalTokens).toLocaleString()} tokens
                              </div>
                            </div>
                          </div>
                          <div className="hf-text-md hf-text-bold" style={{ color: "var(--text-primary)", marginLeft: 12 }}>
                            ${cp.costDollars}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Uncategorized AI Warning */}
              {(summary?.uncategorizedAI?.eventCount ?? 0) > 0 && (
                <div className="hf-banner hf-banner-warning hf-mt-md">
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <div className="hf-text-sm hf-text-bold hf-text-warning">
                      Uncategorized AI Usage
                    </div>
                    <div style={{ fontSize: 12, color: "var(--status-warning-text)", marginTop: 2 }}>
                      {summary?.uncategorizedAI?.eventCount.toLocaleString()} AI calls (${summary?.uncategorizedAI?.costDollars})
                      are not tagged with a call point. These won&apos;t appear in the breakdown above.
                    </div>
                  </div>
                  <div className="hf-text-md hf-text-bold hf-text-warning">
                    ${summary?.uncategorizedAI?.costDollars}
                  </div>
                </div>
              )}

              {/* Provider Legend */}
              <div className="metering-legend hf-flex-wrap hf-gap-lg hf-mt-md">
                <span className="hf-text-xs hf-text-muted">Providers:</span>
                {Object.entries(PROVIDER_COLORS).map(([key, val]) => (
                  <div key={key} className="hf-flex hf-gap-xs">
                    <ProviderDot provider={key} size={6} />
                    <span className="hf-text-xs hf-text-muted">{val.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two Column Layout: Top Operations + Recent Events */}
          <div className="metering-two-col">
            {/* Top Operations */}
            <div className="metering-section-card">
              <h2 className="metering-h2 hf-mb-md">
                Top Operations by Cost
              </h2>
              {(summary?.topOperations || []).length > 0 ? (
                <div className="hf-flex-col hf-gap-sm">
                  {summary?.topOperations.map((op, i) => {
                    const colors = CATEGORY_COLORS[op.category] || CATEGORY_COLORS.AI;
                    return (
                      <div
                        key={`${op.category}-${op.operation}-${i}`}
                        className="metering-op-row"
                      >
                        <div className="hf-flex hf-gap-sm">
                          <span
                            className="metering-dot"
                            style={{ width: 8, height: 8, backgroundColor: colors.text }}
                          />
                          <span
                            className="metering-category-tag"
                            style={{ fontSize: 10, color: colors.text, background: colors.bg }}
                          >
                            {op.category}
                          </span>
                          <span className="hf-text-sm" style={{ color: "var(--text-primary)" }}>{op.operation}</span>
                        </div>
                        <div className="hf-text-sm hf-text-bold" style={{ color: "var(--text-primary)" }}>${op.costDollars}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="hf-text-muted hf-text-center hf-p-md">
                  No operations recorded yet
                </div>
              )}
            </div>

            {/* Recent Events */}
            <div className="metering-section-card">
              <h2 className="metering-h2 hf-mb-md">
                Recent Events
              </h2>
              {recentEvents.length > 0 ? (
                <div className="metering-events-scroll hf-flex-col" style={{ gap: 6 }}>
                  {recentEvents.map((event) => {
                    const colors = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.AI;
                    const isAI = event.category === "AI";
                    const provider = isAI ? getProvider(event.model, event.engine) : null;

                    return (
                      <div key={event.id} className="metering-event-row">
                        <div className="hf-flex hf-gap-sm">
                          {/* Category/Provider dot */}
                          {isAI && provider ? (
                            <ProviderDot provider={provider} size={6} />
                          ) : (
                            <span
                              className="metering-dot"
                              style={{ width: 6, height: 6, backgroundColor: colors.text }}
                            />
                          )}
                          <span
                            className="metering-event-tag"
                            style={{ color: colors.text, background: colors.bg }}
                          >
                            {event.category}
                          </span>
                          <span style={{ color: "var(--text-primary)" }}>{event.operation}</span>
                        </div>
                        <div className="hf-flex hf-gap-md">
                          <span className="hf-text-secondary">
                            {event.quantity.toLocaleString()} {event.unitType}
                          </span>
                          <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                            ${(event.costCents / 100).toFixed(4)}
                          </span>
                          <span className="hf-text-muted" style={{ fontSize: 10 }}>
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="hf-text-muted hf-text-center hf-p-md">
                  No events recorded yet
                </div>
              )}
            </div>
          </div>

          {/* Info Box */}
          <div className="hf-banner hf-banner-info hf-mt-md">
            <strong>Note:</strong> Usage is tracked automatically when you use AI features,
            run pipeline operations, or execute queries. Run{" "}
            <code className="metering-code">
              metering:rollup
            </code>{" "}
            via Ops to aggregate data into period summaries. Events are retained for 30 days.
          </div>
        </>
      )}

      {/* ===================== MOST EXPENSIVE TAB ===================== */}
      {activeTab === "expensive" && (
        <div className="metering-section-card">
          <h2 className="metering-h2-lg hf-mb-sm">
            Most Expensive Operations
          </h2>
          <p className="hf-text-sm hf-text-secondary hf-mb-md">
            Top operations ranked by total cost over the last {days} days
          </p>

          {(breakdowns?.mostExpensive || []).length > 0 ? (
            <div className="hf-flex-col">
              {/* Header */}
              <div className="metering-table-header metering-cols-expensive">
                <div>#</div>
                <div>Category</div>
                <div>Operation</div>
                <div className="metering-cell-right">Events</div>
                <div className="metering-cell-right">Avg Cost</div>
                <div className="metering-cell-right">Total Cost</div>
              </div>

              {(() => {
                const maxCost = breakdowns!.mostExpensive[0]?.totalCostCents || 1;
                return breakdowns!.mostExpensive.map((op, i) => {
                  const colors = CATEGORY_COLORS[op.category] || CATEGORY_COLORS.AI;
                  const barWidth = (op.totalCostCents / maxCost) * 100;
                  return (
                    <div
                      key={`${op.category}-${op.operation}`}
                      className={`metering-table-row metering-cols-expensive${i % 2 !== 0 ? " metering-table-row-alt" : ""}`}
                    >
                      {/* Cost bar background */}
                      <div
                        className="metering-bar-bg"
                        style={{ width: `${barWidth}%`, background: colors.bg }}
                      />
                      <div className="hf-text-sm hf-text-bold hf-text-muted metering-cell-rel">
                        {i + 1}
                      </div>
                      <div className="metering-cell-rel">
                        <span
                          className="metering-category-tag"
                          style={{ fontSize: 10, color: colors.text, background: colors.bg }}
                        >
                          {op.category}
                        </span>
                      </div>
                      <div className="hf-text-sm metering-cell-rel" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                        {op.operation}
                      </div>
                      <div className="hf-text-sm hf-text-secondary metering-cell-right">
                        {op.eventCount.toLocaleString()}
                      </div>
                      <div className="hf-text-sm hf-text-secondary metering-cell-right">
                        ${(op.avgCostCents / 100).toFixed(4)}
                      </div>
                      <div className="hf-text-md hf-text-bold metering-cell-right" style={{ color: "var(--text-primary)" }}>
                        ${op.costDollars}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="metering-empty">
              No operations recorded yet
            </div>
          )}
        </div>
      )}

      {/* ===================== MOST USED TAB ===================== */}
      {activeTab === "used" && (
        <div className="metering-section-card">
          <h2 className="metering-h2-lg hf-mb-sm">
            Most Used Operations
          </h2>
          <p className="hf-text-sm hf-text-secondary hf-mb-md">
            Top operations ranked by event count over the last {days} days
          </p>

          {(breakdowns?.mostUsed || []).length > 0 ? (
            <div className="hf-flex-col">
              {/* Header */}
              <div className="metering-table-header metering-cols-used">
                <div>#</div>
                <div>Category</div>
                <div>Operation</div>
                <div className="metering-cell-right">Events</div>
                <div className="metering-cell-right">Total Cost</div>
              </div>

              {(() => {
                const maxEvents = breakdowns!.mostUsed[0]?.eventCount || 1;
                return breakdowns!.mostUsed.map((op, i) => {
                  const colors = CATEGORY_COLORS[op.category] || CATEGORY_COLORS.AI;
                  const barWidth = (op.eventCount / maxEvents) * 100;
                  return (
                    <div
                      key={`${op.category}-${op.operation}`}
                      className={`metering-table-row metering-cols-used${i % 2 !== 0 ? " metering-table-row-alt" : ""}`}
                    >
                      {/* Event count bar background */}
                      <div
                        className="metering-bar-bg"
                        style={{ width: `${barWidth}%`, background: colors.bg }}
                      />
                      <div className="hf-text-sm hf-text-bold hf-text-muted metering-cell-rel">
                        {i + 1}
                      </div>
                      <div className="metering-cell-rel">
                        <span
                          className="metering-category-tag"
                          style={{ fontSize: 10, color: colors.text, background: colors.bg }}
                        >
                          {op.category}
                        </span>
                      </div>
                      <div className="hf-text-sm metering-cell-rel" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                        {op.operation}
                      </div>
                      <div className="hf-text-md hf-text-bold metering-cell-right" style={{ color: "var(--text-primary)" }}>
                        {op.eventCount.toLocaleString()}
                      </div>
                      <div className="hf-text-sm hf-text-secondary metering-cell-right">
                        ${op.costDollars}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="metering-empty">
              No operations recorded yet
            </div>
          )}
        </div>
      )}

      {/* ===================== BY CALLER TAB ===================== */}
      {activeTab === "caller" && (
        <div>
          {breakdowns?.attribution && (
            <AttributionBanner attribution={breakdowns.attribution} />
          )}

          <div className="metering-section-card">
            <h2 className="metering-h2-lg hf-mb-sm">
              Usage by Caller
            </h2>
            <p className="hf-text-sm hf-text-secondary hf-mb-md">
              Top callers ranked by total cost over the last {days} days
            </p>

            {(breakdowns?.byCaller || []).length > 0 ? (
              <div className="hf-flex-col">
                {/* Header */}
                <div className="metering-table-header metering-cols-caller">
                  <div>#</div>
                  <div>Caller</div>
                  <div>Institution</div>
                  <div className="metering-cell-right">Events</div>
                  <div className="metering-cell-right">Total Cost</div>
                </div>

                {(() => {
                  const maxCost = breakdowns!.byCaller[0]?.totalCostCents || 1;
                  return breakdowns!.byCaller.map((caller, i) => {
                    const barWidth = (caller.totalCostCents / maxCost) * 100;
                    const displayName = caller.callerName || caller.callerEmail || caller.callerPhone || caller.callerId.slice(0, 8) + "...";
                    const subtitle = caller.callerName
                      ? (caller.callerEmail || caller.callerPhone || "")
                      : "";
                    return (
                      <div
                        key={caller.callerId}
                        className={`metering-table-row metering-cols-caller${i % 2 !== 0 ? " metering-table-row-alt" : ""}`}
                      >
                        {/* Cost bar background */}
                        <div
                          className="metering-bar-bg"
                          style={{ width: `${barWidth}%`, background: "var(--status-info-bg)", opacity: 0.25 }}
                        />
                        <div className="hf-text-sm hf-text-bold hf-text-muted metering-cell-rel">
                          {i + 1}
                        </div>
                        <div className="metering-cell-rel" style={{ minWidth: 0 }}>
                          <a
                            href={`/x/callers/${caller.callerId}`}
                            className="hf-text-sm"
                            style={{ fontWeight: 500, color: "var(--text-primary)", textDecoration: "none" }}
                          >
                            {displayName}
                          </a>
                          {subtitle && (
                            <div className="hf-text-xs hf-text-muted" style={{ marginTop: 1 }}>
                              {subtitle}
                            </div>
                          )}
                        </div>
                        <div className="metering-cell-rel">
                          {caller.domainName ? (
                            <span
                              className="hf-badge hf-badge-info"
                              style={{
                                color: "var(--badge-indigo-text)",
                                background: "var(--badge-indigo-bg)",
                                borderRadius: 10,
                              }}
                            >
                              {caller.domainSlug || caller.domainName}
                            </span>
                          ) : (
                            <span className="hf-text-xs hf-text-muted">--</span>
                          )}
                        </div>
                        <div className="hf-text-sm hf-text-secondary metering-cell-right">
                          {caller.eventCount.toLocaleString()}
                        </div>
                        <div className="hf-text-md hf-text-bold metering-cell-right" style={{ color: "var(--text-primary)" }}>
                          ${caller.costDollars}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="metering-empty">
                No caller-attributed events yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== BY DOMAIN TAB ===================== */}
      {activeTab === "domain" && (
        <div>
          {breakdowns?.attribution && (
            <AttributionBanner attribution={breakdowns.attribution} />
          )}

          <div className="metering-section-card">
            <h2 className="metering-h2-lg hf-mb-sm">
              Usage by Domain
            </h2>
            <p className="hf-text-sm hf-text-secondary hf-mb-md">
              Domains ranked by total cost over the last {days} days
            </p>

            {(breakdowns?.byDomain || []).length > 0 ? (
              <div className="hf-flex-col">
                {/* Header */}
                <div className="metering-table-header metering-cols-domain">
                  <div>#</div>
                  <div>Institution</div>
                  <div className="metering-cell-right">Callers</div>
                  <div className="metering-cell-right">Events</div>
                  <div className="metering-cell-right">Total Cost</div>
                </div>

                {(() => {
                  const maxCost = breakdowns!.byDomain[0]?.totalCostCents || 1;
                  return breakdowns!.byDomain.map((domain, i) => {
                    const barWidth = (domain.totalCostCents / maxCost) * 100;
                    const domainDisplay = domain.domainName || domain.domainSlug || "No Domain";
                    const isNoDomain = !domain.domainId;
                    return (
                      <div
                        key={domain.domainId || "none"}
                        className={`metering-table-row metering-cols-domain${i % 2 !== 0 ? " metering-table-row-alt" : ""}`}
                        style={{ opacity: isNoDomain ? 0.6 : 1 }}
                      >
                        {/* Cost bar background */}
                        <div
                          className="metering-bar-bg"
                          style={{
                            width: `${barWidth}%`,
                            background: isNoDomain ? "var(--surface-tertiary)" : "var(--badge-indigo-bg)",
                          }}
                        />
                        <div className="hf-text-sm hf-text-bold hf-text-muted metering-cell-rel">
                          {i + 1}
                        </div>
                        <div className="metering-cell-rel">
                          <div className="hf-text-sm" style={{ fontWeight: 500, color: isNoDomain ? "var(--text-muted)" : "var(--text-primary)" }}>
                            {domainDisplay}
                          </div>
                          {domain.domainSlug && domain.domainName && (
                            <div className="hf-text-xs hf-text-muted" style={{ marginTop: 1 }}>
                              {domain.domainSlug}
                            </div>
                          )}
                        </div>
                        <div className="hf-text-sm hf-text-secondary metering-cell-right">
                          {domain.callerCount.toLocaleString()}
                        </div>
                        <div className="hf-text-sm hf-text-secondary metering-cell-right">
                          {domain.eventCount.toLocaleString()}
                        </div>
                        <div className="hf-text-md hf-text-bold metering-cell-right" style={{ color: "var(--text-primary)" }}>
                          ${domain.costDollars}
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Unattributed row */}
                {breakdowns?.attribution && breakdowns.attribution.unattributedEvents > 0 && (
                  <div className="metering-unattr-row metering-cols-domain">
                    <div />
                    <div className="hf-text-sm hf-text-muted" style={{ fontWeight: 500, fontStyle: "italic" }}>
                      Unattributed (no caller)
                    </div>
                    <div className="hf-text-sm hf-text-muted metering-cell-right">--</div>
                    <div className="hf-text-sm hf-text-muted metering-cell-right">
                      {breakdowns.attribution.unattributedEvents.toLocaleString()}
                    </div>
                    <div className="hf-text-sm hf-text-muted metering-cell-right">--</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="metering-empty">
                No domain-attributed events yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
