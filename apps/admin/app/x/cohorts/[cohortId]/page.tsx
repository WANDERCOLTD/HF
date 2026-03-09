"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DraggableTabs } from "@/components/shared/DraggableTabs";
import { DomainPill } from "@/src/components/shared/EntityPill";
import {
  ArrowLeft,
  Users,
  Activity,
  Settings,
  Phone,
  Target,
  Brain,
  Clock,
  TrendingUp,
  User,
  Mail,
  Link2,
  Copy,
  RefreshCw,
  X,
  BookOpen,
  Plus,
  Trash2,
  RefreshCcw,
} from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

// ==============================
// Types
// ==============================

type Personality = {
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
  confidenceScore: number | null;
};

type Pupil = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string;
  archivedAt: string | null;
  personality: Personality | null;
  callCount: number;
  goalCount: number;
  memoryCount: number;
  lastCallAt: string | null;
  goals: { total: number; completed: number; active: number };
};

type DashboardSummary = {
  memberCount: number;
  activePupils: number;
  recentlyActive: number;
  totalCalls: number;
  totalGoals: number;
  completedGoals: number;
  goalCompletionRate: number;
};

type Cohort = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  maxMembers: number;
  owner: { id: string; name: string; email: string | null };
  domain: { id: string; slug: string; name: string };
  _count: { members: number };
};

type ActivityItem = {
  type: "call";
  id: string;
  callerId: string;
  callerName: string;
  timestamp: string;
  source: string;
  scoreCount: number;
  memoryCount: number;
};

// ==============================
// Main Component
// ==============================

type TabId = "roster" | "playbooks" | "activity" | "invite" | "settings";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "roster", label: "Roster", icon: <Users size={14} /> },
  { id: "playbooks", label: "Courses", icon: <BookOpen size={14} /> },
  { id: "activity", label: "Activity", icon: <Activity size={14} /> },
  { id: "invite", label: "Invite", icon: <Mail size={14} /> },
  { id: "settings", label: "Settings", icon: <Settings size={14} /> },
];

export default function CohortDashboardPage() {
  const { cohortId } = useParams<{ cohortId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>("roster");
  const [dashboard, setDashboard] = useState<{
    cohort: Cohort;
    summary: DashboardSummary;
    pupils: Pupil[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(() => {
    setLoading(true);
    fetch(`/api/cohorts/${cohortId}/dashboard`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setDashboard(data);
        } else {
          setError(data.error || "Failed to load dashboard");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [cohortId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="hf-text-center hf-text-muted hf-p-xl">
        Loading cohort dashboard...
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="hf-p-lg">
        <div className="hf-banner hf-banner-error hf-mt-md">
          {error || "Cohort not found"}
        </div>
      </div>
    );
  }

  const { cohort, summary, pupils } = dashboard;

  return (
    <div className="hf-page-container hf-page-scroll">
      {/* Header */}
      <div style={{ padding: "16px 24px 0 24px" }}>
        <div className="hf-flex-between hf-items-start hf-mb-md">
          <div>
            <div className="hf-flex hf-gap-sm hf-items-center hf-mb-xs">
              <h1 className="hf-page-title">
                {cohort.name}
              </h1>
              <span className={`hf-badge ${cohort.isActive ? "hf-badge-success" : "hf-badge-muted"}`}>
                {cohort.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="hf-flex hf-gap-sm hf-items-center hf-text-sm">
              <DomainPill label={cohort.domain.name} size="compact" />
              <span className="hf-text-muted">
                Owner: {cohort.owner.name}
              </span>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="hf-gap-md hf-mb-md" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <SummaryCard
            icon={<Users size={16} />}
            label="Members"
            value={summary.memberCount}
            sub={`of ${cohort.maxMembers}`}
          />
          <SummaryCard
            icon={<TrendingUp size={16} />}
            label="Active (7d)"
            value={summary.recentlyActive}
            sub={`of ${summary.memberCount}`}
          />
          <SummaryCard
            icon={<Phone size={16} />}
            label="Total Calls"
            value={summary.totalCalls}
          />
          <SummaryCard
            icon={<Target size={16} />}
            label="Goals"
            value={summary.totalGoals}
            sub={`${summary.goalCompletionRate}% done`}
          />
        </div>

        {/* Tabs */}
        <DraggableTabs
          storageKey="cohort-detail-tabs"
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
        />
      </div>

      {/* Tab Content */}
      <div className="hf-p-lg">
        {activeTab === "roster" && (
          <RosterTab pupils={pupils} cohortId={cohortId} />
        )}
        {activeTab === "playbooks" && <PlaybooksTab cohortId={cohortId} />}
        {activeTab === "activity" && <ActivityTab cohortId={cohortId} />}
        {activeTab === "invite" && <InviteTab cohortId={cohortId} />}
        {activeTab === "settings" && (
          <SettingsTab cohort={cohort} onUpdated={fetchDashboard} />
        )}
      </div>
    </div>
  );
}

// ==============================
// Summary Card
// ==============================

function SummaryCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="hf-summary-card">
      <div className="hf-summary-card-label">
        {icon}
        {label}
      </div>
      <div className="hf-summary-card-value">
        {value}
        {sub && <span className="hf-summary-card-sub">{sub}</span>}
      </div>
    </div>
  );
}

// ==============================
// Roster Tab
// ==============================

function RosterTab({
  pupils,
  cohortId,
}: {
  pupils: Pupil[];
  cohortId: string;
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "calls" | "lastCall">("name");

  const sorted = [...pupils]
    .filter((p) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        p.name?.toLowerCase().includes(s) ||
        p.email?.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "calls":
          return b.callCount - a.callCount;
        case "lastCall":
          if (!a.lastCallAt && !b.lastCallAt) return 0;
          if (!a.lastCallAt) return 1;
          if (!b.lastCallAt) return -1;
          return (
            new Date(b.lastCallAt).getTime() -
            new Date(a.lastCallAt).getTime()
          );
        default:
          return (a.name || "").localeCompare(b.name || "");
      }
    });

  const gridCols = "2fr 1fr 1fr 1fr 1.5fr";

  return (
    <div>
      {/* Filters */}
      <div className="hf-flex hf-gap-md hf-items-center hf-mb-md">
        <input
          type="text"
          placeholder="Search pupils..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="hf-form-input"
          style={{ width: 200 }}
        />
        <div className="hf-flex hf-gap-xs">
          {(["name", "calls", "lastCall"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`hf-sort-btn ${sortBy === s ? "hf-sort-btn-active" : ""}`}
            >
              {s === "name"
                ? "Name"
                : s === "calls"
                  ? "Calls"
                  : "Last Active"}
            </button>
          ))}
        </div>
        <span className="hf-text-xs hf-text-muted hf-ml-auto">
          {sorted.length} pupil{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Pupil Table */}
      {sorted.length === 0 ? (
        <div className="hf-empty-dashed">
          <User size={36} className="hf-icon-placeholder hf-mb-md" />
          <div className="hf-text-md hf-text-bold hf-text-secondary">
            No pupils in this cohort
          </div>
          <div className="hf-text-sm hf-text-muted hf-mt-xs">
            Add members from the Callers page
          </div>
        </div>
      ) : (
        <div className="hf-table-container">
          {/* Header Row */}
          <div
            className="hf-table-header"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div>Pupil</div>
            <div>Calls</div>
            <div>Goals</div>
            <div>Memories</div>
            <div>Last Active</div>
          </div>

          {/* Rows */}
          {sorted.map((pupil, idx) => (
            <Link
              key={pupil.id}
              href={`/x/callers/${pupil.id}`}
              className="hf-link-unstyled"
            >
              <div
                className="hf-table-row"
                style={{
                  gridTemplateColumns: gridCols,
                  borderTop: idx > 0 ? "1px solid var(--border-default)" : "none",
                }}
              >
                <div>
                  <div className="hf-text-md hf-text-500 hf-text-primary">
                    {pupil.name || "Unnamed"}
                  </div>
                  {pupil.email && (
                    <div className="hf-text-xs hf-text-muted hf-mt-xs">
                      {pupil.email}
                    </div>
                  )}
                </div>
                <div className="hf-flex hf-gap-xs hf-items-center">
                  <Phone size={12} className="hf-icon-placeholder" />
                  <span className="hf-text-md hf-text-primary">{pupil.callCount}</span>
                </div>
                <div className="hf-flex hf-gap-xs hf-items-center">
                  <Target size={12} className="hf-icon-placeholder" />
                  <span className="hf-text-md hf-text-primary">
                    {pupil.goals.completed}/{pupil.goals.total}
                  </span>
                </div>
                <div className="hf-flex hf-gap-xs hf-items-center">
                  <Brain size={12} className="hf-icon-placeholder" />
                  <span className="hf-text-md hf-text-primary">{pupil.memoryCount}</span>
                </div>
                <div>
                  {pupil.lastCallAt ? (
                    <span className="hf-text-sm hf-text-secondary">
                      {formatRelativeTime(new Date(pupil.lastCallAt))}
                    </span>
                  ) : (
                    <span className="hf-text-sm hf-icon-placeholder hf-text-italic">
                      No calls yet
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ==============================
// Playbooks (Courses) Tab
// ==============================

type CohortPlaybookItem = {
  id: string;
  name: string;
  status: string;
  version: number | null;
  assignedAt: string;
  assignedBy: string | null;
  enrolledCount: number;
};

type AvailablePlaybook = {
  id: string;
  name: string;
  status: string;
  version: number | null;
};

function PlaybooksTab({ cohortId }: { cohortId: string }) {
  const [playbooks, setPlaybooks] = useState<CohortPlaybookItem[]>([]);
  const [available, setAvailable] = useState<AvailablePlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const fetchPlaybooks = useCallback(() => {
    setLoading(true);
    fetch(`/api/cohorts/${cohortId}/playbooks`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setPlaybooks(data.playbooks || []);
          setAvailable(data.available || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cohortId]);

  useEffect(() => {
    fetchPlaybooks();
  }, [fetchPlaybooks]);

  const handleAssign = async (playbookId: string) => {
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/playbooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playbookIds: [playbookId], autoEnrollMembers: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(`Assigned. ${data.enrolled} student${data.enrolled !== 1 ? "s" : ""} enrolled.`);
        setShowPicker(false);
        fetchPlaybooks();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(data.error || "Failed to assign");
      }
    } catch (err: any) {
      setMessage(err.message || "Failed to assign");
    }
  };

  const handleRemove = async (playbookId: string, playbookName: string) => {
    if (!confirm(`Remove "${playbookName}" from this cohort? Member enrollments will be kept.`)) return;

    try {
      const res = await fetch(`/api/cohorts/${cohortId}/playbooks/${playbookId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        setMessage("Removed");
        fetchPlaybooks();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(data.error || "Failed to remove");
      }
    } catch (err: any) {
      setMessage(err.message || "Failed to remove");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/playbooks/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(`Synced ${data.synced} enrollment${data.synced !== 1 ? "s" : ""}${data.errors.length > 0 ? ` (${data.errors.length} errors)` : ""}`);
        fetchPlaybooks();
        setTimeout(() => setMessage(""), 3000);
      }
    } catch (err: any) {
      setMessage(err.message || "Sync failed");
    }
    setSyncing(false);
  };

  if (loading) {
    return (
      <div className="hf-p-lg hf-text-center hf-text-muted">
        Loading courses...
      </div>
    );
  }

  return (
    <div>
      {/* Actions Bar */}
      <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="hf-btn hf-btn-primary hf-btn-sm"
        >
          <Plus size={14} />
          Assign Course
        </button>
        {playbooks.length > 0 && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="hf-btn hf-btn-secondary hf-btn-sm"
          >
            <RefreshCcw size={14} />
            {syncing ? "Syncing..." : "Sync Members"}
          </button>
        )}
        {message && (
          <span
            className={`hf-text-sm hf-ml-auto ${
              message.includes("Failed") || message.includes("error")
                ? "hf-text-error"
                : "hf-text-success"
            }`}
          >
            {message}
          </span>
        )}
      </div>

      {/* Picker */}
      {showPicker && available.length > 0 && (
        <div className="hf-card-compact hf-mb-md">
          <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-sm">
            Available Courses
          </div>
          <div className="hf-flex-col hf-gap-sm" style={{ gap: 6 }}>
            {available.map((pb) => (
              <div key={pb.id} className="hf-picker-item">
                <div>
                  <span className="hf-text-md hf-text-500 hf-text-primary">
                    {pb.name}
                  </span>
                  <span className="hf-badge hf-badge-success" style={{ marginLeft: 8 }}>
                    {pb.status}
                  </span>
                </div>
                <button
                  onClick={() => handleAssign(pb.id)}
                  className="hf-sort-btn hf-sort-btn-active"
                >
                  Assign
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {showPicker && available.length === 0 && (
        <div className="hf-p-md hf-mb-md hf-text-sm hf-text-muted hf-text-center" style={{ background: "var(--surface-secondary)", border: "1px solid var(--border-default)", borderRadius: 8 }}>
          All domain courses are already assigned to this cohort
        </div>
      )}

      {/* Assigned Playbooks */}
      {playbooks.length === 0 ? (
        <div className="hf-empty-dashed">
          <BookOpen size={36} className="hf-icon-placeholder hf-mb-md" />
          <div className="hf-text-md hf-text-bold hf-text-secondary">
            No courses assigned
          </div>
          <div className="hf-text-sm hf-text-muted hf-mt-xs">
            Students joining this cohort will receive all domain courses as a fallback.
            Assign specific courses to control what students are enrolled in.
          </div>
        </div>
      ) : (
        <div className="hf-flex-col hf-gap-sm">
          {playbooks.map((pb) => (
            <div
              key={pb.id}
              className="hf-picker-item"
              style={{ padding: "14px 16px", borderRadius: 8 }}
            >
              <div>
                <div className="hf-flex hf-gap-sm hf-items-center">
                  <BookOpen size={14} style={{ color: "var(--accent-primary)" }} />
                  <span className="hf-text-md hf-text-500 hf-text-primary">
                    {pb.name}
                  </span>
                  <span
                    className={`hf-badge ${
                      pb.status === "PUBLISHED" ? "hf-badge-success" : "hf-badge-muted"
                    }`}
                  >
                    {pb.status}
                  </span>
                </div>
                <div className="hf-text-xs hf-text-muted hf-flex hf-gap-md hf-mt-xs">
                  <span>{pb.enrolledCount} enrolled</span>
                  <span>Assigned {new Date(pb.assignedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                onClick={() => handleRemove(pb.id, pb.name)}
                className="hf-btn hf-btn-secondary hf-btn-xs"
              >
                <Trash2 size={12} />
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==============================
// Activity Tab
// ==============================

function ActivityTab({ cohortId }: { cohortId: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch(`/api/cohorts/${cohortId}/activity?limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setActivity(data.activity || []);
          setTotal(data.total || 0);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cohortId]);

  if (loading) {
    return (
      <div className="hf-p-lg hf-text-center hf-text-muted">
        Loading activity...
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="hf-empty-dashed">
        <Activity size={36} className="hf-icon-placeholder hf-mb-md" />
        <div className="hf-text-md hf-text-bold hf-text-secondary">
          No activity yet
        </div>
        <div className="hf-text-sm hf-text-muted hf-mt-xs">
          Activity appears as cohort members make calls
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        Showing {activity.length} of {total} calls
      </div>
      <div className="hf-flex-col hf-gap-sm">
        {activity.map((item) => (
          <Link
            key={item.id}
            href={`/x/callers/${item.callerId}?tab=journey`}
            className="hf-link-unstyled"
          >
            <div className="hf-activity-row">
              <Phone size={16} className="hf-icon-placeholder hf-flex-shrink-0" />
              <div className="hf-flex-1">
                <div className="hf-text-md hf-text-primary">
                  <strong>{item.callerName}</strong> had a call
                </div>
                <div className="hf-text-xs hf-text-muted hf-flex hf-gap-sm hf-mt-xs">
                  <span>Source: {item.source}</span>
                  {item.scoreCount > 0 && (
                    <span>{item.scoreCount} scores</span>
                  )}
                  {item.memoryCount > 0 && (
                    <span>{item.memoryCount} memories</span>
                  )}
                </div>
              </div>
              <div className="hf-text-xs hf-text-muted hf-nowrap">
                {formatRelativeTime(new Date(item.timestamp))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ==============================
// Settings Tab
// ==============================

function SettingsTab({
  cohort,
  onUpdated,
}: {
  cohort: Cohort;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(cohort.name);
  const [description, setDescription] = useState(cohort.description || "");
  const [maxMembers, setMaxMembers] = useState(cohort.maxMembers);
  const [isActive, setIsActive] = useState(cohort.isActive);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const hasChanges =
    name !== cohort.name ||
    description !== (cohort.description || "") ||
    maxMembers !== cohort.maxMembers ||
    isActive !== cohort.isActive;

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch(`/api/cohorts/${cohort.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          maxMembers,
          isActive,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage("Saved");
        onUpdated();
        setTimeout(() => setMessage(""), 2000);
      } else {
        setMessage(data.error || "Failed to save");
      }
    } catch (err: any) {
      setMessage(err.message || "Failed to save");
    }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <h3 className="hf-heading-md hf-mb-md" style={{ fontSize: 16 }}>
        Cohort Settings
      </h3>

      <label className="hf-form-label">Name</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="hf-form-input hf-mb-md"
      />

      <label className="hf-form-label">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="hf-form-input hf-mb-md"
        style={{ resize: "vertical" }}
      />

      <label className="hf-form-label">Max Members</label>
      <input
        type="number"
        value={maxMembers}
        onChange={(e) => setMaxMembers(parseInt(e.target.value) || 1)}
        min={1}
        max={500}
        className="hf-form-input hf-mb-md"
        style={{ width: 120 }}
      />

      <div className="hf-mb-md">
        <label className="hf-flex hf-gap-sm hf-items-center hf-text-md hf-text-primary" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Cohort is active
        </label>
      </div>

      <div className="hf-flex hf-gap-md hf-items-center">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`hf-btn hf-btn-sm ${hasChanges ? "hf-btn-primary" : ""}`}
          style={{
            padding: "8px 20px",
            ...(!hasChanges
              ? {
                  background: "var(--surface-tertiary)",
                  color: "var(--text-muted)",
                }
              : {}),
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {message && (
          <span
            className={`hf-text-sm ${
              message === "Saved" ? "hf-text-success" : "hf-text-error"
            }`}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

// ==============================
// Invite Tab
// ==============================

type PendingInvite = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  expiresAt: string;
  sentAt: string | null;
};

function InviteTab({ cohortId }: { cohortId: string }) {
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [loadingLink, setLoadingLink] = useState(true);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const { copied, copy: copyText } = useCopyToClipboard();

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  // Fetch join link
  useEffect(() => {
    fetch(`/api/cohorts/${cohortId}/join-link`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setJoinToken(data.joinToken);
        setLoadingLink(false);
      })
      .catch(() => setLoadingLink(false));
  }, [cohortId]);

  // Fetch pending invites
  const fetchInvites = useCallback(() => {
    setLoadingInvites(true);
    fetch(`/api/cohorts/${cohortId}/invite`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setInvites(data.invites || []);
        setLoadingInvites(false);
      })
      .catch(() => setLoadingInvites(false));
  }, [cohortId]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleCopyLink = () => {
    if (!joinToken) return;
    copyText(`${baseUrl}/join/${joinToken}`);
  };

  const handleRegenerateLink = async () => {
    const res = await fetch(`/api/cohorts/${cohortId}/join-link`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.ok) setJoinToken(data.joinToken);
  };

  const handleRevokeLink = async () => {
    const res = await fetch(`/api/cohorts/${cohortId}/join-link`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (data.ok) setJoinToken(null);
  };

  const handleSendInvites = async () => {
    const emails = emailInput
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

    if (emails.length === 0) {
      setMessage("Enter at least one valid email");
      return;
    }

    setSending(true);
    setMessage("");

    try {
      const res = await fetch(`/api/cohorts/${cohortId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(
          `Created ${data.created} invite${data.created !== 1 ? "s" : ""}` +
            (data.skipped > 0 ? `, ${data.skipped} skipped` : "") +
            (data.sent > 0 ? `, ${data.sent} email${data.sent !== 1 ? "s" : ""} sent` : "")
        );
        setEmailInput("");
        fetchInvites();
      } else {
        setMessage(data.error || "Failed to send invites");
      }
    } catch (err: any) {
      setMessage(err.message || "Failed to send invites");
    }
    setSending(false);
    setTimeout(() => setMessage(""), 5000);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Join Link Section */}
      <h3 className="hf-heading-md hf-flex hf-gap-sm hf-items-center hf-mb-md" style={{ fontSize: 16 }}>
        <Link2 size={16} />
        Join Link
      </h3>
      <p className="hf-section-desc">
        Share this link with pupils so they can self-enrol in this cohort.
      </p>

      {loadingLink ? (
        <div className="hf-text-sm hf-text-muted">Loading...</div>
      ) : joinToken ? (
        <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm" style={{ padding: "10px 14px", background: "var(--surface-secondary)", borderRadius: 8, border: "1px solid var(--border-default)" }}>
          <code className="hf-text-sm hf-truncate hf-flex-1 hf-text-primary">
            {baseUrl}/join/{joinToken}
          </code>
          <button
            onClick={handleCopyLink}
            className="hf-btn hf-btn-secondary hf-btn-xs hf-nowrap"
            style={copied ? { color: "var(--status-success-text)" } : undefined}
          >
            <Copy size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <div className="hf-text-sm hf-text-muted hf-text-italic hf-mb-sm">
          No join link active
        </div>
      )}

      <div className="hf-flex hf-gap-sm" style={{ marginBottom: 32 }}>
        <button
          onClick={handleRegenerateLink}
          className="hf-btn hf-btn-secondary hf-btn-xs"
        >
          <RefreshCw size={12} />
          {joinToken ? "Regenerate" : "Generate"}
        </button>
        {joinToken && (
          <button
            onClick={handleRevokeLink}
            className="hf-btn hf-btn-secondary hf-btn-xs hf-text-error"
          >
            <X size={12} />
            Revoke
          </button>
        )}
      </div>

      {/* Email Invite Section */}
      <h3 className="hf-heading-md hf-flex hf-gap-sm hf-items-center hf-mb-md" style={{ fontSize: 16 }}>
        <Mail size={16} />
        Email Invites
      </h3>
      <p className="hf-section-desc">
        Enter email addresses (one per line, or comma-separated) to send invite
        links.
      </p>

      <textarea
        value={emailInput}
        onChange={(e) => setEmailInput(e.target.value)}
        placeholder="student1@example.com&#10;student2@example.com"
        rows={4}
        className="hf-form-input"
        style={{ resize: "vertical", fontFamily: "inherit" }}
      />

      <div className="hf-flex hf-gap-md hf-items-center hf-mt-sm hf-mb-lg">
        <button
          onClick={handleSendInvites}
          disabled={sending || !emailInput.trim()}
          className={`hf-btn hf-btn-sm ${emailInput.trim() ? "hf-btn-primary" : ""}`}
          style={
            !emailInput.trim()
              ? { background: "var(--surface-tertiary)", color: "var(--text-muted)" }
              : undefined
          }
        >
          {sending ? "Sending..." : "Send Invites"}
        </button>
        {message && (
          <span
            className={`hf-text-sm ${
              message.startsWith("Created") ? "hf-text-success" : "hf-text-error"
            }`}
          >
            {message}
          </span>
        )}
      </div>

      {/* Pending Invites List */}
      {loadingInvites ? (
        <div className="hf-text-sm hf-text-muted">Loading invites...</div>
      ) : invites.length > 0 ? (
        <div>
          <h4 className="hf-heading-sm hf-text-secondary" style={{ fontSize: 13 }}>
            Pending Invites ({invites.length})
          </h4>
          <div className="hf-table-container">
            {invites.map((invite, idx) => (
              <div
                key={invite.id}
                className="hf-flex-between hf-items-center hf-text-sm"
                style={{
                  padding: "10px 14px",
                  borderTop: idx > 0 ? "1px solid var(--border-default)" : "none",
                }}
              >
                <div>
                  <div className="hf-text-primary">{invite.email}</div>
                  <div className="hf-text-xs hf-text-muted hf-mt-xs">
                    Sent {invite.sentAt
                      ? formatRelativeTime(new Date(invite.sentAt))
                      : "not yet"}{" "}
                    &middot; Expires{" "}
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="hf-badge hf-badge-warning">Pending</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ==============================
// Utility
// ==============================

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
