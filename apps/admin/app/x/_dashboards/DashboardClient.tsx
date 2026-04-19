"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { useTerminology } from "@/contexts/TerminologyContext";
import type { TermKey } from "@/lib/terminology/types";
import { ICON_MAP } from "@/lib/sidebar/icons";
import AskAISearchBar from "@/components/shared/AskAISearchBar";
import {
  getConfigForRole,
  isAdminRole,
  ENTITY_CONFIGS,
  TASK_LABELS,
  RESUME_PATHS,
  FOOTER_LINKS,
  WIZARD_ACTIONS,
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

// ── Main Component ──────────────────────────────────────────

interface Props {
  role: string;
}

export default function DashboardClient({ role }: Props) {
  const { terms, plural, lower, lowerPlural } = useTerminology();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const config = getConfigForRole(role);
  const isDemo = role === "DEMO";

  const loadData = useCallback(async () => {
    if (isDemo) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/dashboard");
      const body = await res.json();
      if (body?.ok) {
        setData(body);
      } else {
        setError(body?.error || "Failed to load dashboard");
      }
    } catch {
      setError("Failed to load dashboard. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

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
    return <DemoView config={config} />;
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

      {/* Wizard CTAs */}
      {config.showWizards && (
        <WizardSection terms={terms} lower={lower} />
      )}

      {/* Explore Demos */}
      {config.showWizards && (
        <Link href="/x/demos" className="dash-demos-banner">
          <div className="dash-demos-banner-icon">
            {ICON_MAP.Presentation && <ICON_MAP.Presentation size={18} />}
          </div>
          <div className="dash-demos-banner-text">
            <span className="dash-demos-banner-title">Explore Demos</span>
            <span className="dash-demos-banner-desc">Interactive walkthroughs of key features</span>
          </div>
          <ChevronRight size={16} className="dash-demos-banner-arrow" />
        </Link>
      )}

      {/* Active Jobs */}
      {config.showJobs && data && data.activeTasks.length > 0 && (
        <ActiveJobsSection tasks={data.activeTasks} />
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

      {/* Recent Activity */}
      {data && data.recentCalls.length > 0 && (
        <RecentActivitySection calls={data.recentCalls} plural={plural} />
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

function DemoView({ config }: { config: ReturnType<typeof getConfigForRole> }) {
  const SimIcon = ICON_MAP.MessageCircle;
  const BrainIcon = ICON_MAP.Brain;
  const BarChartIcon = ICON_MAP.BarChart3;
  const TargetIcon = ICON_MAP.Target;

  return (
    <div data-tour="welcome" className="dash-page">
      <div className="dash-demo-hero">
        <div className="dash-demo-icon">👋</div>
        <h1 className="dash-demo-title">{config.title}</h1>
        <p className="dash-demo-desc">{config.subtitle}</p>
        <Link href="/x/sim" className="dash-demo-cta">
          <SimIcon size={24} />
          Start a Conversation
        </Link>
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
    </div>
  );
}

// ── Wizard Section ──────────────────────────────────────────

function WizardSection({
  terms,
  lower,
}: {
  terms: Record<string, string>;
  lower: (key: TermKey) => string;
}) {
  return (
    <div className="dash-wizards-grid">
      {WIZARD_ACTIONS.map((action) => {
        const Icon = ICON_MAP[action.icon];
        const label = action.termKey ? terms[action.termKey as TermKey] || action.label : action.label;
        const desc = action.termKey
          ? `Set up a new ${lower(action.termKey as TermKey)}`
          : action.description;

        return (
          <Link
            key={action.href}
            href={action.href}
            className={`dash-wizard-card${action.primary ? " dash-wizard-card-primary" : ""}`}
          >
            <div className="dash-wizard-icon">
              {Icon && <Icon size={20} />}
            </div>
            <div>
              <div className="dash-wizard-title">{label}</div>
              <div className="dash-wizard-desc">{desc}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Active Jobs Section ─────────────────────────────────────

function ActiveJobsSection({ tasks }: { tasks: ActiveTask[] }) {
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
            <Link key={task.id} href={resumeUrl} className="dash-job-row">
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
}) {
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
}) {
  const config = ENTITY_CONFIGS[entityKey];
  const Icon = ICON_MAP[config.icon];
  const title = plural(config.termKey);
  const canCreate = isAdminRole(role);

  // Build href for each item
  const getItemHref = (item: EntityItem) => {
    switch (entityKey) {
      case "domains": return `/x/domains?id=${item.id}`;
      case "playbooks": return `/x/playbooks/${item.id}`;
      case "callers": return `/x/callers/${item.id}`;
      case "specs": return `/x/specs?id=${item.id}`;
      case "communities": return `/x/communities/${item.id}`;
      default: return config.href;
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
            <Link href={config.createHref} className="dash-entity-new-btn">
              <Plus size={12} />
              New
            </Link>
          )}
          <Link href={config.href} className="dash-entity-view-all">
            View all <ChevronRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
          </Link>
        </div>
      </div>

      {/* Body */}
      {items.length === 0 ? (
        <div className="dash-entity-empty">
          <span className="dash-entity-empty-text">
            No {lowerPlural(config.termKey)} yet.{" "}
            {canCreate && (
              <Link href={config.createHref} className="dash-entity-empty-link">
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
              className="dash-entity-row"
            >
              <span className="dash-entity-name">
                {item.name || "Unnamed"}
              </span>
              <div className="dash-entity-meta">
                {/* Column values based on entity config */}
                {config.columns.map((col) => {
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

// ── Recent Activity Section ─────────────────────────────────

function RecentActivitySection({
  calls,
  plural,
}: {
  calls: RecentCall[];
  plural: (key: TermKey) => string;
}) {
  return (
    <div className="dash-activity-section">
      <div className="dash-activity-header">
        <h2 className="hf-section-title">Recent Activity</h2>
        <p className="hf-section-desc">Latest {plural("session").toLowerCase()}</p>
      </div>
      <div className="dash-activity-list">
        {calls.map((call) => (
          <Link
            key={call.id}
            href={call.callerId ? `/x/callers/${call.callerId}?tab=journey` : "#"}
            className="dash-activity-row"
          >
            <div className="dash-activity-left">
              <div className="dash-activity-dot" />
              <span className="dash-activity-name">
                {call.callerName || "Unknown"}
              </span>
            </div>
            <span className="dash-activity-date">
              {new Date(call.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Quick Links Section ─────────────────────────────────────

function QuickLinksSection({ links }: { links: Array<{ label: string; icon: string; href: string; description?: string }> }) {
  return (
    <div className="dash-links-section">
      <div className="dash-links-header">
        <h2 className="hf-section-title">Quick Links</h2>
      </div>
      <div className="dash-links-grid">
        {links.map((link) => {
          const Icon = ICON_MAP[link.icon];
          return (
            <Link key={link.href} href={link.href} className="dash-link-card">
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

function FooterSection() {
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
