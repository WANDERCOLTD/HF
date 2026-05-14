"use client";

import { useEffect, useState, useCallback, type JSX } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { useTerminology } from "@/contexts/TerminologyContext";
import type { TermKey } from "@/lib/terminology/types";
import { ICON_MAP } from "@/lib/sidebar/icons";
import { CategoryTreemap } from "@/components/shared/CategoryTreemap";
import "@/components/shared/category-treemap.css";
import { FancySelect, type FancySelectOption } from "@/components/shared/FancySelect";
import AskAISearchBar from "@/components/shared/AskAISearchBar";
import {
  getConfigForRole,
  isAdminRole,
  ENTITY_CONFIGS,
  TASK_LABELS,
  RESUME_PATHS,
  FOOTER_LINKS,
  WIZARD_ACTIONS,
  QUICK_ACTIONS,
  type EntityKey,
} from "./dashboard-config";
import "./dashboard.css";

// ── Types ───────────────────────────────────────────────────

interface DashboardData {
  role: string;
  entities: Record<string, EntityItem[]>;
  counts: Record<string, number>;
  recentCalls: RecentCall[];
  activeTasks: ActiveTask[];
}

interface EntityItem {
  id: string;
  name: string | null;
  slug?: string;
  kind?: string;
  status?: string;
  role?: string;
  version?: string | null;
  domainName?: string | null;
  callerCount?: number;
  playbookCount?: number;
  lastCallAt?: string | null;
}

interface RecentCall {
  id: string;
  createdAt: string;
  callerName: string | null;
  callerId: string | null;
}

interface ActiveTask {
  id: string;
  taskType: string;
  currentStep: number;
  totalSteps: number;
  context: Record<string, unknown>;
  updatedAt: string;
}

interface ProofSummary {
  totalStudents: number;
  totalCalls: number;
  avgMastery: number | null;
  memoriesLearned: number;
  modulesCompleted: number;
  activeThisWeek: number;
  contentMix: Record<string, number>;
  contentMixItems?: Record<string, string[]>;
  spotlights: Array<{
    id: string;
    name: string;
    mastery: number;
    callCount: number;
    memoryCount: number;
  }>;
  recentActivity: Array<{
    type: "call" | "course" | "enrollment";
    entityName: string;
    entityId: string;
    action: string;
    timestamp: string;
    href: string;
  }>;
}

// ── Main Component ──────────────────────────────────────────

interface Props {
  role: string;
}

// Suppress unused-var lint — WIZARD_ACTIONS is kept for external consumers
void WIZARD_ACTIONS;

export default function DashboardClient({ role }: Props): JSX.Element {
  const { terms, plural, lower, lowerPlural } = useTerminology();
  const [data, setData] = useState<DashboardData | null>(null);
  const [proofData, setProofData] = useState<ProofSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const config = getConfigForRole(role);
  const isDemo = role === "DEMO";

  const loadData = useCallback(async () => {
    try {
      const fetches: Promise<void>[] = [];

      // Main dashboard data (skip for DEMO)
      if (!isDemo) {
        fetches.push(
          fetch("/api/dashboard")
            .then((res) => res.json())
            .then((body) => {
              if (body?.ok) {
                setData(body);
              } else {
                setError(body?.error || "Failed to load dashboard");
              }
            }),
        );
      }

      // Proof summary (parallel fetch)
      if (config.showProofPoints) {
        fetches.push(
          fetch("/api/dashboard/proof-summary")
            .then((res) => res.json())
            .then((body) => {
              if (body?.ok) {
                setProofData(body);
              }
              // Silently ignore proof-summary failures — non-critical
            })
            .catch(() => {
              // Non-critical — proof strip just won't render
            }),
        );
      }

      await Promise.all(fetches);
    } catch {
      if (!isDemo) {
        setError("Failed to load dashboard. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, [isDemo, config.showProofPoints]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Loading ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="dash-loading">
        <div className="dash-loading-text">Loading dashboard...</div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────
  if (error) {
    return (
      <div className="dash-error">
        <div className="dash-error-banner">{error}</div>
      </div>
    );
  }

  // ── Demo ──────────────────────────────────────────────
  if (isDemo) {
    return <DemoView config={config} proofData={proofData} />;
  }

  // ── Main Dashboard ────────────────────────────────────
  return (
    <div data-tour="welcome" className="dash-page">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-header-row">
          <div>
            <h1 className="hf-page-title">{config.title}</h1>
            <p className="hf-page-subtitle">{config.subtitle}</p>
          </div>
          {config.showSearch && (
            <div className="dash-header-search">
              <AskAISearchBar placeholder="Ask AI anything..." />
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions Bar (replaces Wizard CTAs) */}
      {config.showQuickActions && <QuickActionsBar />}

      {/* Proof Points Strip */}
      {config.showProofPoints && proofData && (
        <ProofPointsStrip proof={proofData} />
      )}

      {/* Recent Activity */}
      {config.showProofPoints && proofData && proofData.recentActivity.length > 0 && (
        <ActivityFeed activities={proofData.recentActivity} />
      )}

      {/* Spotlight Learners */}
      {config.showProofPoints && proofData && proofData.spotlights.length > 0 && (
        <SpotlightLearners spotlights={proofData.spotlights} />
      )}

      {/* Content Mix — treemap with course picker */}
      {config.showProofPoints && proofData && Object.keys(proofData.contentMix).length > 0 && (
        <ContentMixSection
          contentMix={proofData.contentMix}
          contentMixItems={proofData.contentMixItems}
          courses={data?.entities?.playbooks ?? []}
        />
      )}

      {/* Entity Previews */}
      {config.entityKeys.length > 0 && data && (
        <EntityPreviewsSection
          entityKeys={config.entityKeys}
          entities={data.entities}
          counts={data.counts}
          role={role}
          plural={plural}
          lowerPlural={lowerPlural}
        />
      )}

      {/* Active Jobs */}
      {config.showJobs && data && data.activeTasks.length > 0 && (
        <ActiveJobsSection tasks={data.activeTasks} />
      )}

      {/* Quick Links */}
      {config.quickLinks.length > 0 && (
        <QuickLinksSection links={config.quickLinks} />
      )}

      {/* Footer */}
      {config.showFooter && <FooterSection />}
    </div>
  );
}

// ── Demo View ───────────────────────────────────────────────

function DemoView({
  config,
  proofData,
}: {
  config: ReturnType<typeof getConfigForRole>;
  proofData: ProofSummary | null;
}): JSX.Element {
  const SimIcon = ICON_MAP.MessageCircle;
  const BrainIcon = ICON_MAP.Brain;
  const BarChartIcon = ICON_MAP.BarChart3;
  const TargetIcon = ICON_MAP.Target;

  return (
    <div data-tour="welcome" className="dash-page">
      {/* Hero */}
      <div className="dash-demo-hero">
        <div className="dash-demo-icon">👋</div>
        <h1 className="dash-demo-title">{config.title}</h1>
        <p className="dash-demo-desc">{config.subtitle}</p>
        <Link href="/x/sim" target="_blank" className="dash-demo-cta">
          <SimIcon size={24} />
          Start a Conversation
        </Link>
      </div>

      {/* Proof Points Strip */}
      {proofData && <ProofPointsStrip proof={proofData} />}

      {/* Spotlight Learners */}
      {proofData && proofData.spotlights.length > 0 && (
        <SpotlightLearners spotlights={proofData.spotlights} />
      )}

      {/* Feature cards */}
      <div className="dash-demo-features">
        {[
          { Icon: BrainIcon, title: "Adaptive", description: "AI learns your style" },
          { Icon: BarChartIcon, title: "Measured", description: "Every interaction counts" },
          { Icon: TargetIcon, title: "Personal", description: "Tailored to you" },
        ].map((feature) => (
          <div key={feature.title} className="dash-demo-feature">
            <div className="dash-demo-feature-icon">
              <feature.Icon size={24} />
            </div>
            <div className="dash-demo-feature-title">{feature.title}</div>
            <div className="dash-demo-feature-desc">{feature.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Quick Actions Bar ──────────────────────────────────────

function QuickActionsBar(): JSX.Element {
  return (
    <div className="dash-actions-bar">
      {QUICK_ACTIONS.map((action) => {
        const Icon = ICON_MAP[action.icon];
        return (
          <Link
            key={action.href}
            href={action.href}
            target="_blank"
            className={`dash-action-btn${action.primary ? " dash-action-btn--primary" : ""}`}
          >
            {Icon && <Icon size={16} />}
            {action.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── Proof Points Strip ─────────────────────────────────────

function ProofPointsStrip({ proof }: { proof: ProofSummary }): JSX.Element {
  const tiles = [
    { label: "Students", value: String(proof.totalStudents) },
    {
      label: "Mastery",
      value: proof.avgMastery != null ? `${Math.round(proof.avgMastery * 100)}%` : "--",
    },
    { label: "Calls", value: String(proof.totalCalls) },
    { label: "Facts Learned", value: String(proof.memoriesLearned) },
  ];

  return (
    <div className="dash-proof-strip">
      {tiles.map((tile) => (
        <div key={tile.label} className="dash-proof-tile">
          <div className="dash-proof-value">{tile.value}</div>
          <div className="dash-proof-label">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Content Mix Section (treemap + course picker) ──────────

function ContentMixSection({
  contentMix,
  contentMixItems,
  courses,
}: {
  contentMix: Record<string, number>;
  contentMixItems?: Record<string, string[]>;
  courses: EntityItem[];
}): JSX.Element {
  const [selectedCourse, setSelectedCourse] = useState("all");
  const [courseContentMix, setCourseContentMix] = useState<Record<string, number> | null>(null);
  const [courseContentItems, setCourseContentItems] = useState<Record<string, string[]> | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(false);

  const courseOptions: FancySelectOption[] = [
    { value: "all", label: "All Courses" },
    ...courses.map((c) => ({ value: c.id, label: c.name || "Unnamed" })),
  ];

  // Fetch per-course content mix when a course is selected
  useEffect(() => {
    if (selectedCourse === "all") {
      setCourseContentMix(null);
      setCourseContentItems(null);
      return;
    }
    let cancelled = false;
    setLoadingCourse(true);
    fetch(`/api/courses/${selectedCourse}/content-breakdown`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok && body.categoryCounts) {
          setCourseContentMix(body.categoryCounts);
          setCourseContentItems(body.categoryItems ?? null);
        } else {
          setCourseContentMix(null);
          setCourseContentItems(null);
        }
      })
      .catch(() => { if (!cancelled) { setCourseContentMix(null); setCourseContentItems(null); } })
      .finally(() => { if (!cancelled) setLoadingCourse(false); });
    return () => { cancelled = true; };
  }, [selectedCourse]);

  const activeMix = selectedCourse === "all" ? contentMix : (courseContentMix ?? contentMix);
  const activeItems = selectedCourse === "all" ? contentMixItems : (courseContentItems ?? contentMixItems);
  const total = Object.values(activeMix).reduce((s, c) => s + c, 0);

  return (
    <div className="dash-content-section">
      <div className="dash-content-header">
        <h3 className="hf-section-title">Content Mix</h3>
        <span className="dash-content-total">{total} teaching points</span>
        {courses.length > 1 && (
          <div className="dash-content-picker">
            <FancySelect
              value={selectedCourse}
              onChange={setSelectedCourse}
              options={courseOptions}
              placeholder="Filter by course"
              searchable={courses.length > 5}
              clearable={false}
            />
          </div>
        )}
      </div>
      {loadingCourse ? (
        <div className="dash-content-loading">Loading...</div>
      ) : (
        <CategoryTreemap categoryCounts={activeMix} categoryItems={activeItems} />
      )}
    </div>
  );
}

// ── Activity Feed ──────────────────────────────────────────

const ACTIVITY_DOT_CLASS: Record<string, string> = {
  call: "dash-feed-dot--call",
  course: "dash-feed-dot--course",
  enrollment: "dash-feed-dot--enrollment",
};

function ActivityFeed({
  activities,
}: {
  activities: ProofSummary["recentActivity"];
}): JSX.Element {
  return (
    <div className="dash-feed">
      <h3 className="hf-section-title">Recent Activity</h3>
      {activities.length === 0 ? (
        <p className="dash-feed-empty">No recent activity</p>
      ) : (
        <div className="dash-feed-list">
          {activities.slice(0, 10).map((activity, i) => (
            <Link key={`${activity.entityId}-${i}`} href={activity.href} target="_blank" className="dash-feed-row">
              <div className="dash-feed-left">
                <div className={`dash-feed-dot ${ACTIVITY_DOT_CLASS[activity.type] ?? ""}`} />
                <span className="dash-feed-name">{activity.entityName}</span>
                <span className="dash-feed-action">{activity.action}</span>
              </div>
              <span className="dash-feed-time">{formatRelativeDate(activity.timestamp)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Spotlight Learners ─────────────────────────────────────

const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function SpotlightLearners({
  spotlights,
}: {
  spotlights: ProofSummary["spotlights"];
}): JSX.Element {
  const UserIcon = ICON_MAP.User;

  return (
    <div className="dash-spotlights">
      <h3 className="hf-section-title">Spotlight Learners</h3>
      <div className="dash-spotlights-grid">
        {spotlights.slice(0, 3).map((s) => {
          const pct = Math.round(s.mastery * 100);
          const strokeDashoffset = RING_CIRCUMFERENCE * (1 - s.mastery);

          return (
            <Link key={s.id} href={`/x/callers/${s.id}`} target="_blank" className="dash-spot-card hf-card">
              <div className="dash-spot-ring">
                <svg viewBox="0 0 64 64" className="dash-spot-svg">
                  <circle
                    cx="32"
                    cy="32"
                    r={RING_RADIUS}
                    className="dash-spot-ring-bg"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r={RING_RADIUS}
                    className="dash-spot-ring-fg"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={strokeDashoffset}
                  />
                </svg>
                <span className="dash-spot-pct">{pct}%</span>
              </div>
              <div className="dash-spot-name">{s.name}</div>
              <div className="dash-spot-stats">
                <span className="dash-spot-stat">
                  {UserIcon && <UserIcon size={12} />}
                  {s.callCount} calls
                </span>
                <span className="dash-spot-stat">
                  {s.memoryCount} memories
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Active Jobs Section ─────────────────────────────────────

function ActiveJobsSection({ tasks }: { tasks: ActiveTask[] }): JSX.Element {
  return (
    <div className="dash-jobs-section">
      <div className="dash-jobs-header">
        <h2 className="hf-section-title">Active Jobs</h2>
        <p className="hf-section-desc">Pick up where you left off</p>
      </div>
      <div className="dash-jobs-list">
        {tasks.map((task) => {
          const ctx = task.context || {};
          const label = TASK_LABELS[task.taskType] || task.taskType;
          const name = (ctx.subjectName || ctx.domainName || ctx.name || "") as string;
          const resumeUrl = RESUME_PATHS[task.taskType]?.(ctx) || "/x/jobs";

          return (
            <Link key={task.id} href={resumeUrl} target="_blank" className="dash-job-row">
              <div className="dash-job-left">
                <div className="dash-job-step-badge">
                  {task.currentStep}/{task.totalSteps}
                </div>
                <div>
                  <div className="dash-job-title">
                    {label}{name ? ` — ${name}` : ""}
                  </div>
                  <div className="dash-job-step">
                    Step {task.currentStep} of {task.totalSteps}
                  </div>
                </div>
              </div>
              <span className="dash-job-resume">Resume →</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Entity Previews Section ─────────────────────────────────

function EntityPreviewsSection({
  entityKeys,
  entities,
  counts,
  role,
  plural,
  lowerPlural,
}: {
  entityKeys: EntityKey[];
  entities: Record<string, EntityItem[]>;
  counts: Record<string, number>;
  role: string;
  plural: (key: TermKey) => string;
  lowerPlural: (key: TermKey) => string;
}): JSX.Element {
  // Filter communities out of domains to avoid duplication
  const filteredKeys = entityKeys.filter((key) => {
    // Only show entity sections we have config for
    return ENTITY_CONFIGS[key] != null;
  });

  return (
    <div className="dash-entities">
      {filteredKeys.map((key) => (
        <EntitySection
          key={key}
          entityKey={key}
          items={entities[key === "communities" ? "communities" : key] || []}
          count={key === "communities"
            ? (entities.communities?.length ?? 0)
            : (counts[key] ?? 0)}
          role={role}
          plural={plural}
          lowerPlural={lowerPlural}
        />
      ))}
    </div>
  );
}

function EntitySection({
  entityKey,
  items,
  count,
  role,
  plural,
  lowerPlural,
}: {
  entityKey: EntityKey;
  items: EntityItem[];
  count: number;
  role: string;
  plural: (key: TermKey) => string;
  lowerPlural: (key: TermKey) => string;
}): JSX.Element {
  const entityConfig = ENTITY_CONFIGS[entityKey];
  const Icon = ICON_MAP[entityConfig.icon];
  const title = plural(entityConfig.termKey);
  const canCreate = isAdminRole(role);

  // Build href for each item
  const getItemHref = (item: EntityItem): string => {
    switch (entityKey) {
      case "domains": return `/x/domains?id=${item.id}`;
      case "playbooks": return `/x/courses/${item.id}`;
      case "callers": return `/x/callers/${item.id}`;
      case "specs": return `/x/specs?id=${item.id}`;
      case "communities": return `/x/communities/${item.id}`;
      default: return entityConfig.href;
    }
  };

  return (
    <div className="dash-entity-section">
      {/* Header */}
      <div className="dash-entity-header">
        <div className="dash-entity-icon">
          {Icon && <Icon size={16} />}
        </div>
        <span className="dash-entity-title">{title}</span>
        <span className="dash-entity-count">{count}</span>
        <div className="dash-entity-actions">
          {canCreate && (
            <Link href={entityConfig.createHref} target="_blank" className="dash-entity-new-btn">
              <Plus size={12} />
              New
            </Link>
          )}
          <Link href={entityConfig.href} target="_blank" className="dash-entity-view-all">
            View all <ChevronRight size={12} className="dash-entity-view-all-icon" />
          </Link>
        </div>
      </div>

      {/* Body */}
      {items.length === 0 ? (
        <div className="dash-entity-empty">
          <span className="dash-entity-empty-text">
            No {lowerPlural(entityConfig.termKey)} yet.{" "}
            {canCreate && (
              <Link href={entityConfig.createHref} target="_blank" className="dash-entity-empty-link">
                Create one →
              </Link>
            )}
          </span>
        </div>
      ) : (
        <div className="dash-entity-table">
          {items.map((item) => (
            <Link
              key={item.id}
              href={getItemHref(item)}
              target="_blank"
              className="dash-entity-row"
            >
              <span className="dash-entity-name">
                {item.name || "Unnamed"}
              </span>
              <div className="dash-entity-meta">
                {/* Column values based on entity config */}
                {entityConfig.columns.map((col) => {
                  const value = (item as unknown as Record<string, unknown>)[col.key];
                  if (value == null && col.type !== "badge") return null;

                  switch (col.type) {
                    case "count":
                      return (
                        <span key={col.key} className="dash-entity-meta-item">
                          {value as number} {col.termKey ? lowerPlural(col.termKey as TermKey) : ""}
                        </span>
                      );
                    case "date":
                      return value ? (
                        <span key={col.key} className="dash-entity-meta-item">
                          {formatRelativeDate(value as string)}
                        </span>
                      ) : (
                        <span key={col.key} className="dash-entity-meta-item">
                          No calls
                        </span>
                      );
                    case "badge":
                      return value ? (
                        <span
                          key={col.key}
                          className={`dash-entity-badge ${getBadgeClass(value as string)}`}
                        >
                          {formatBadge(value as string)}
                        </span>
                      ) : null;
                    case "text":
                      return value ? (
                        <span key={col.key} className="dash-entity-meta-item">
                          {value as string}
                        </span>
                      ) : null;
                    default:
                      return null;
                  }
                })}
                <ChevronRight size={14} className="dash-entity-arrow" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick Links Section ─────────────────────────────────────

function QuickLinksSection({ links }: { links: Array<{ label: string; icon: string; href: string; description?: string }> }): JSX.Element {
  return (
    <div className="dash-links-section">
      <div className="dash-links-header">
        <h2 className="hf-section-title">Quick Links</h2>
      </div>
      <div className="dash-links-grid">
        {links.map((link) => {
          const Icon = ICON_MAP[link.icon];
          return (
            <Link key={link.href} href={link.href} target="_blank" className="dash-link-card">
              <div className="dash-link-icon">
                {Icon && <Icon size={18} />}
              </div>
              <div>
                <div className="dash-link-title">{link.label}</div>
                {link.description && (
                  <div className="dash-link-desc">{link.description}</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Footer Section ──────────────────────────────────────────

function FooterSection(): JSX.Element {
  return (
    <div className="dash-footer">
      {FOOTER_LINKS.map((link) => {
        const Icon = ICON_MAP[link.icon];
        return (
          <Link key={link.href} href={link.href} className="dash-footer-link">
            {Icon && <Icon size={14} />}
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function getBadgeClass(value: string): string {
  const v = value.toUpperCase();
  if (v === "PUBLISHED" || v === "INSTITUTION") return "dash-entity-badge-published";
  if (v === "COMMUNITY") return "dash-entity-badge-ready";
  if (v === "DRAFT") return "dash-entity-badge-draft";
  // Spec roles
  if (["ORCHESTRATE", "EXTRACT", "SYNTHESISE", "CONSTRAIN", "OBSERVE", "IDENTITY", "CONTENT", "VOICE"].includes(v)) {
    return "dash-entity-badge-setup";
  }
  return "dash-entity-badge-draft";
}

function formatBadge(value: string): string {
  // Title case
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
