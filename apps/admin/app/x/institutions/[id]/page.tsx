"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2, BookOpen, Users2, School, Users, Settings,
  CheckCircle2, Circle, ChevronRight, Plus, Rocket,
} from "lucide-react";
import {
  type TerminologyPresetId,
  type TerminologyConfig,
  type TerminologyOverrides,
  TERMINOLOGY_PRESETS,
  PRESET_OPTIONS,
  resolveTerminology,
} from "@/lib/terminology/types";
import { DraggableTabs, type TabDefinition } from "@/components/shared/DraggableTabs";
import "./institution-detail.css";

// ── Types ──────────────────────────────────────────

type TabId = "overview" | "courses" | "communities" | "classrooms" | "team" | "settings";

interface InstitutionDetail {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  welcomeMessage: string | null;
  terminology: TerminologyConfig | null;
  isActive: boolean;
  userCount: number;
  cohortCount: number;
  type: { id: string; slug: string; name: string } | null;
}

interface Course {
  id: string;
  name: string;
  status: string;
  subjectCount: number;
  studentCount: number;
  domainName: string;
  groupName: string | null;
}

interface Community {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  communityKind: string | null;
  memberCount: number;
}

interface Classroom {
  id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  maxMembers: number;
  domainName: string;
  primaryCourse: { id: string; name: string } | null;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: "Draft",     cls: "hf-badge hf-badge-muted" },
  PUBLISHED: { label: "Published", cls: "hf-badge hf-badge-success" },
  ARCHIVED:  { label: "Archived",  cls: "hf-badge hf-badge-muted" },
};

const ROLE_BADGE: Record<string, string> = {
  SUPERADMIN: "hf-badge hf-badge-error",
  ADMIN:      "hf-badge hf-badge-warning",
  OPERATOR:   "hf-badge hf-badge-muted",
  EDUCATOR:   "hf-badge hf-badge-muted",
  STUDENT:    "hf-badge hf-badge-muted",
};

// ── Tab skeleton ──────────────────────────────────

function TabSkeleton() {
  return (
    <div className="inst-tab-list">
      {[1, 2, 3].map((i) => (
        <div key={i} className="inst-tab-row" style={{ pointerEvents: "none" }}>
          <div className="inst-tab-row-icon">
            <div className="hf-skeleton" style={{ width: 20, height: 20, borderRadius: 4 }} />
          </div>
          <div className="inst-tab-row-body">
            <div className="hf-skeleton hf-skeleton-text" style={{ width: "40%" }} />
            <div className="hf-skeleton hf-skeleton-text" style={{ width: "25%", marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────

export default function InstitutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // Institution core
  const [institution, setInstitution] = useState<InstitutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<"forbidden" | "not-found" | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Settings form state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#4f46e5");
  const [secondaryColor, setSecondaryColor] = useState("#3b82f6");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [termPreset, setTermPreset] = useState<TerminologyPresetId>("corporate");
  const [termOverrides, setTermOverrides] = useState<TerminologyOverrides>({});
  const [showTermCustomize, setShowTermCustomize] = useState(false);
  const resolvedTerms = resolveTerminology({ preset: termPreset, overrides: termOverrides });

  // Lazy tab data
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [classroomsLoading, setClassroomsLoading] = useState(false);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);

  // ── Load institution ─────────────────────────

  useEffect(() => {
    fetch(`/api/institutions/${id}`)
      .then((r) => {
        if (r.status === 403) { setFetchError("forbidden"); return null; }
        if (r.status === 404) { setFetchError("not-found"); return null; }
        return r.json();
      })
      .then((res) => {
        if (res?.ok) {
          const inst = res.institution;
          setInstitution(inst);
          setName(inst.name);
          setLogoUrl(inst.logoUrl || "");
          setPrimaryColor(inst.primaryColor || "#4f46e5");
          setSecondaryColor(inst.secondaryColor || "#3b82f6");
          setWelcomeMessage(inst.welcomeMessage || "");
          if (inst.terminology) {
            setTermPreset(inst.terminology.preset || "corporate");
            setTermOverrides(inst.terminology.overrides || {});
          }
        } else if (res && !res.ok) {
          setFetchError("not-found");
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Lazy tab loaders ──────────────────────────

  const loadCourses = useCallback(async () => {
    if (courses !== null || coursesLoading) return;
    setCoursesLoading(true);
    try {
      const res = await fetch(`/api/institutions/${id}/courses`);
      const data = await res.json();
      setCourses(data.ok ? data.courses : []);
    } catch { setCourses([]); }
    finally { setCoursesLoading(false); }
  }, [id, courses, coursesLoading]);

  const loadCommunities = useCallback(async () => {
    if (communities !== null || communitiesLoading) return;
    setCommunitiesLoading(true);
    try {
      const res = await fetch(`/api/institutions/${id}/communities`);
      const data = await res.json();
      setCommunities(data.ok ? data.communities : []);
    } catch { setCommunities([]); }
    finally { setCommunitiesLoading(false); }
  }, [id, communities, communitiesLoading]);

  const loadClassrooms = useCallback(async () => {
    if (classrooms !== null || classroomsLoading) return;
    setClassroomsLoading(true);
    try {
      const res = await fetch(`/api/institutions/${id}/classrooms`);
      const data = await res.json();
      setClassrooms(data.ok ? data.classrooms : []);
    } catch { setClassrooms([]); }
    finally { setClassroomsLoading(false); }
  }, [id, classrooms, classroomsLoading]);

  const loadTeam = useCallback(async () => {
    if (team !== null || teamLoading) return;
    setTeamLoading(true);
    try {
      const res = await fetch(`/api/institutions/${id}/team`);
      const data = await res.json();
      setTeam(data.ok ? data.team : []);
    } catch { setTeam([]); }
    finally { setTeamLoading(false); }
  }, [id, team, teamLoading]);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
    if (tab === "courses") loadCourses();
    if (tab === "communities") loadCommunities();
    if (tab === "classrooms") loadClassrooms();
    if (tab === "team") loadTeam();
  }, [loadCourses, loadCommunities, loadClassrooms, loadTeam]);

  // ── Save ─────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage("");
    const terminologyConfig: TerminologyConfig = {
      preset: termPreset,
      ...(Object.keys(termOverrides).length > 0 ? { overrides: termOverrides } : {}),
    };
    const res = await fetch(`/api/institutions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, logoUrl: logoUrl || null, primaryColor: primaryColor || null,
        secondaryColor: secondaryColor || null, welcomeMessage: welcomeMessage || null,
        terminology: terminologyConfig,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setInstitution((prev) => prev ? { ...prev, ...data.institution } : prev);
      setSaveMessage("Saved");
      setTimeout(() => setSaveMessage(""), 2000);
    } else {
      setSaveMessage(data.error || "Save failed");
    }
    setSaving(false);
  };

  // ── Guard states ──────────────────────────────

  if (loading) {
    return (
      <div className="hf-page-container">
        <div className="hf-empty-compact"><div className="hf-spinner" /></div>
      </div>
    );
  }

  if (fetchError === "forbidden") {
    return (
      <div className="hf-page-container">
        <div className="hf-banner hf-banner-error hf-mt-md">
          You don&apos;t have permission to view this institution.
        </div>
        <button onClick={() => router.push("/x/institutions")} className="hf-btn hf-btn-secondary hf-mt-md">
          ← Go back
        </button>
      </div>
    );
  }

  if (!institution) {
    return (
      <div className="hf-page-container">
        <div className="hf-banner hf-banner-error hf-mt-md">Institution not found.</div>
      </div>
    );
  }

  // ── Tabs ──────────────────────────────────────

  const TABS: TabDefinition[] = [
    { id: "overview",    label: "Overview",    icon: <Building2 size={14} /> },
    { id: "courses",     label: "Courses",     icon: <BookOpen size={14} />,  count: courses?.length ?? null },
    { id: "communities", label: "Communities", icon: <Users2 size={14} />,    count: communities?.length ?? null },
    { id: "classrooms",  label: "Classrooms",  icon: <School size={14} />,    count: classrooms?.length ?? null },
    { id: "team",        label: "Team",        icon: <Users size={14} />,     count: team?.length ?? null },
    { id: "settings",    label: "Settings",    icon: <Settings size={14} /> },
  ];

  const hasLogo = !!institution.logoUrl;

  // ── Render ────────────────────────────────────

  return (
    <div className="hf-page-container hf-page-scroll">
      {/* ── Hero ─────────────────────────────── */}
      <div className="inst-detail-hero">
        {hasLogo ? (
          <img
            src={institution.logoUrl!}
            alt="Logo"
            className="inst-detail-avatar"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="inst-detail-initial" style={{ background: primaryColor }}>
            {institution.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="inst-detail-meta">
          <div className="inst-detail-name-row">
            <h1 className="hf-page-title">{institution.name}</h1>
            <span className={institution.isActive ? "hf-badge hf-badge-success" : "hf-badge hf-badge-muted"}>
              {institution.isActive ? "Active" : "Inactive"}
            </span>
            {institution.type && (
              <span className="hf-badge hf-badge-muted">{institution.type.name}</span>
            )}
          </div>
          <div className="inst-detail-info-row">
            <span className="hf-mono hf-text-xs hf-text-muted">{institution.slug}</span>
            <span className="inst-detail-swatch" style={{ background: primaryColor }} title="Primary color" />
            <span className="inst-detail-swatch" style={{ background: secondaryColor }} title="Secondary color" />
          </div>
        </div>
      </div>

      {/* ── Summary strip ───────────────────── */}
      <div className="hf-summary-strip hf-mb-md">
        <div className="hf-summary-card">
          <div className="hf-summary-card-label"><BookOpen size={14} />Courses</div>
          <div className="hf-summary-card-value">{courses?.length ?? "—"}</div>
        </div>
        <div className="hf-summary-card">
          <div className="hf-summary-card-label"><Users2 size={14} />Communities</div>
          <div className="hf-summary-card-value">{communities?.length ?? "—"}</div>
        </div>
        <div className="hf-summary-card">
          <div className="hf-summary-card-label"><School size={14} />Classrooms</div>
          <div className="hf-summary-card-value">{classrooms?.length ?? "—"}</div>
        </div>
        <div className="hf-summary-card">
          <div className="hf-summary-card-label"><Users size={14} />Team</div>
          <div className="hf-summary-card-value">{institution.userCount}</div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────── */}
      <DraggableTabs
        storageKey="institution-detail-tabs"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        showReset={false}
      />

      {/* ═══════════════════════════════════════ */}
      {/* OVERVIEW                               */}
      {activeTab === "overview" && (
        <div className="hf-mt-lg">
          <div className="hf-section-title hf-mb-md">Setup Status</div>
          <div className="inst-checklist">
            {[
              { label: "Institution created", done: true },
              { label: "Logo or custom brand color set", done: hasLogo || (!!primaryColor && primaryColor !== "#4f46e5") },
              { label: "Welcome message added", done: !!institution.welcomeMessage },
              { label: "Terminology configured", done: !!institution.terminology },
              { label: "At least one course", done: (courses?.length ?? 0) > 0 },
              { label: "At least one classroom", done: (classrooms?.length ?? 0) > 0 },
              { label: "Team members added", done: institution.userCount > 1 },
            ].map((item) => (
              <div key={item.label} className={`inst-checklist-item ${item.done ? "done" : "todo"}`}>
                {item.done
                  ? <CheckCircle2 size={16} style={{ color: "var(--status-success-text)", flexShrink: 0 }} />
                  : <Circle size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                }
                <span className={item.done ? "hf-text-sm" : "hf-text-sm hf-text-muted"}>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="hf-mt-lg hf-flex hf-gap-sm hf-flex-wrap">
            <Link href={`/x/courses/new?domainId=${id}`} className="hf-btn hf-btn-primary">
              <Rocket size={14} />Add Course
            </Link>
            <Link href="/x/communities/new" className="hf-btn hf-btn-secondary">
              <Users2 size={14} />Add Community
            </Link>
            <Link href="/x/users" className="hf-btn hf-btn-secondary">
              <Users size={14} />Manage Team
            </Link>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* COURSES                                */}
      {activeTab === "courses" && (
        <div className="hf-mt-lg">
          <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
            <div className="hf-section-title">Courses</div>
            <Link href={`/x/courses/new?domainId=${id}`} className="hf-btn hf-btn-primary">
              <Plus size={14} />New Course
            </Link>
          </div>
          {coursesLoading ? <TabSkeleton /> : !courses || courses.length === 0 ? (
            <div className="hf-empty-compact hf-mt-md">
              <BookOpen size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No courses yet</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">Create a course to define what students will learn.</p>
              <Link href={`/x/courses/new?domainId=${id}`} className="hf-btn hf-btn-primary"><Plus size={14} />Create Course</Link>
            </div>
          ) : (
            <div className="inst-tab-list">
              {courses.map((c) => (
                <Link key={c.id} href={`/x/courses/${c.id}`} className="inst-tab-row">
                  <div className="inst-tab-row-icon"><BookOpen size={18} /></div>
                  <div className="inst-tab-row-body">
                    <div className="inst-tab-row-title">{c.name}</div>
                    <div className="inst-tab-row-sub">
                      {c.subjectCount} subjects · {c.studentCount} students{c.groupName ? ` · ${c.groupName}` : ""}
                    </div>
                  </div>
                  <div className="inst-tab-row-right">
                    <span className={(STATUS_BADGE[c.status] ?? STATUS_BADGE.DRAFT).cls}>
                      {(STATUS_BADGE[c.status] ?? STATUS_BADGE.DRAFT).label}
                    </span>
                    <ChevronRight size={16} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* COMMUNITIES                            */}
      {activeTab === "communities" && (
        <div className="hf-mt-lg">
          <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
            <div className="hf-section-title">Communities</div>
            <Link href="/x/communities/new" className="hf-btn hf-btn-primary">
              <Plus size={14} />New Community
            </Link>
          </div>
          {communitiesLoading ? <TabSkeleton /> : !communities || communities.length === 0 ? (
            <div className="hf-empty-compact hf-mt-md">
              <Users2 size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No communities yet</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">Communities bring learners together around shared topics.</p>
              <Link href="/x/communities/new" className="hf-btn hf-btn-primary"><Plus size={14} />Create Community</Link>
            </div>
          ) : (
            <div className="inst-tab-list">
              {communities.map((c) => (
                <Link key={c.id} href={`/x/communities/${c.id}`} className="inst-tab-row">
                  <div className="inst-tab-row-icon"><Users2 size={18} /></div>
                  <div className="inst-tab-row-body">
                    <div className="inst-tab-row-title">{c.name}</div>
                    <div className="inst-tab-row-sub">
                      {c.memberCount} members{c.communityKind ? ` · ${c.communityKind.replace("_", " ").toLowerCase()}` : ""}
                    </div>
                  </div>
                  <div className="inst-tab-row-right">
                    <span className={c.isActive ? "hf-badge hf-badge-success" : "hf-badge hf-badge-muted"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                    <ChevronRight size={16} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* CLASSROOMS                             */}
      {activeTab === "classrooms" && (
        <div className="hf-mt-lg">
          <div className="hf-section-title hf-mb-md">Classrooms</div>
          {classroomsLoading ? <TabSkeleton /> : !classrooms || classrooms.length === 0 ? (
            <div className="hf-empty-compact hf-mt-md">
              <School size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No classrooms yet</div>
              <p className="hf-text-xs hf-text-muted">Classrooms are created when a course is launched for a group.</p>
            </div>
          ) : (
            <div className="inst-tab-list">
              {classrooms.map((c) => {
                const pct = c.maxMembers > 0 ? Math.round((c.memberCount / c.maxMembers) * 100) : 0;
                return (
                  <Link key={c.id} href={`/x/cohorts/${c.id}`} className="inst-tab-row">
                    <div className="inst-tab-row-icon"><School size={18} /></div>
                    <div className="inst-tab-row-body">
                      <div className="inst-tab-row-title">{c.name}</div>
                      <div className="inst-tab-row-sub">
                        {c.memberCount}/{c.maxMembers} members{c.primaryCourse ? ` · ${c.primaryCourse.name}` : ""}
                      </div>
                    </div>
                    <div className="inst-tab-row-right">
                      <div className="inst-fill-bar">
                        <div className="inst-fill-bar-inner" style={{ width: `${pct}%` }} />
                      </div>
                      <span className={c.isActive ? "hf-badge hf-badge-success" : "hf-badge hf-badge-muted"}>
                        {c.isActive ? "Active" : "Inactive"}
                      </span>
                      <ChevronRight size={16} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* TEAM                                   */}
      {activeTab === "team" && (
        <div className="hf-mt-lg">
          <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
            <div className="hf-section-title">Team Members</div>
            <Link href="/x/users" className="hf-btn hf-btn-secondary">
              <Users size={14} />Manage Team
            </Link>
          </div>
          {teamLoading ? <TabSkeleton /> : !team || team.length === 0 ? (
            <div className="hf-empty-compact hf-mt-md">
              <Users size={36} className="hf-text-tertiary hf-mb-sm" />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No team members</div>
              <p className="hf-text-xs hf-text-muted hf-mb-md">Invite admins, educators, and operators to this institution.</p>
              <Link href="/x/users" className="hf-btn hf-btn-primary"><Plus size={14} />Invite Team</Link>
            </div>
          ) : (
            <div className="inst-team-list">
              {team.map((u) => (
                <div key={u.id} className="inst-team-row">
                  <div className="inst-team-avatar">
                    {(u.name || u.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="inst-team-info">
                    <div className="inst-team-name">{u.name || "(no name)"}</div>
                    <div className="inst-team-email">{u.email}</div>
                  </div>
                  <span className={ROLE_BADGE[u.role] ?? "hf-badge hf-badge-muted"}>{u.role}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* SETTINGS                               */}
      {activeTab === "settings" && (
        <div className="hf-mt-lg">
          <div className="hf-section-title hf-mb-md">Branding</div>
          <div className="hf-card hf-mb-lg">
            {/* Live preview */}
            <div className="hf-card-compact hf-mb-lg" style={{ background: "var(--surface-secondary)" }}>
              <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">Preview</div>
              <div className="hf-flex hf-gap-md hf-items-center">
                {logoUrl ? (
                  <img src={logoUrl} alt="Preview" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 6 }} />
                ) : (
                  <div className="hf-icon-box" style={{ background: primaryColor, color: "var(--surface-primary)", fontWeight: 700 }}>
                    {name.charAt(0) || "?"}
                  </div>
                )}
                <div className="hf-text-sm hf-text-bold">{name || "Institution Name"}</div>
                <div className="hf-flex hf-gap-xs hf-ml-auto">
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: primaryColor, border: "1px solid var(--border-default)" }} />
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: secondaryColor, border: "1px solid var(--border-default)" }} />
                </div>
              </div>
            </div>
            <div className="hf-flex-col hf-gap-md">
              <div>
                <label className="hf-label">Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="hf-input" placeholder="Institution name" />
              </div>
              <div>
                <label className="hf-label">Logo URL</label>
                <input type="text" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="hf-input" placeholder="https://example.com/logo.png" />
              </div>
              <div>
                <label className="hf-label">Primary Color</label>
                <div className="inst-color-row">
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="inst-color-picker" />
                  <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="hf-input hf-flex-1" placeholder="#4f46e5" />
                </div>
              </div>
              <div>
                <label className="hf-label">Secondary Color</label>
                <div className="inst-color-row">
                  <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="inst-color-picker" />
                  <input type="text" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="hf-input hf-flex-1" placeholder="#3b82f6" />
                </div>
              </div>
              <div>
                <label className="hf-label">Welcome Message</label>
                <textarea value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} rows={3} className="hf-textarea" placeholder="Welcome to our learning platform!" />
              </div>
            </div>
          </div>

          <div className="hf-section-title hf-mb-md">Terminology</div>
          <p className="hf-section-desc hf-mb-lg">Choose how this institution labels key concepts. Affects navigation and dashboard labels for all users.</p>
          <div className="hf-card-grid-md hf-mb-lg">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { setTermPreset(opt.id); setTermOverrides({}); setShowTermCustomize(false); }}
                className="hf-card-compact hf-text-left"
                style={termPreset === opt.id ? {
                  borderColor: "var(--accent-primary)",
                  background: "color-mix(in srgb, var(--accent-primary) 8%, var(--surface-primary))",
                } : undefined}
              >
                <div className="hf-text-sm hf-text-bold hf-mb-xs">{opt.label}</div>
                <div className="hf-text-xs hf-text-muted">{opt.description}</div>
              </button>
            ))}
          </div>
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">Preview</div>
            <div className="hf-flex-col">
              {(["institution", "cohort", "learner", "instructor"] as const).map((key) => (
                <div key={key} className="hf-flex hf-flex-between hf-items-center" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="hf-text-xs hf-text-muted">{key}</span>
                  <span className="hf-text-sm">
                    {resolvedTerms[key]}
                    {termOverrides[key] && <span className="hf-tag-pill hf-ml-sm">custom</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setShowTermCustomize(!showTermCustomize)} className="hf-btn hf-btn-secondary hf-mb-md">
            {showTermCustomize ? "Hide customization" : "Customize individual terms"}
          </button>
          {showTermCustomize && (
            <div className="hf-card hf-mb-lg">
              <div className="hf-flex-col hf-gap-md">
                {(["institution", "cohort", "learner", "instructor"] as const).map((key) => (
                  <div key={key}>
                    <label className="hf-label" style={{ textTransform: "capitalize" }}>{key}</label>
                    <input
                      type="text"
                      value={termOverrides[key] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTermOverrides((prev) => {
                          if (!val.trim()) { const next = { ...prev }; delete next[key]; return next; }
                          return { ...prev, [key]: val };
                        });
                      }}
                      placeholder={TERMINOLOGY_PRESETS[termPreset][key]}
                      className="hf-input"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="hf-flex hf-gap-md hf-items-center hf-mt-lg">
            <button onClick={handleSave} disabled={saving || !name.trim()} className="hf-btn hf-btn-primary">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saveMessage && (
              <span className={`hf-text-sm ${saveMessage === "Saved" ? "hf-text-success" : "hf-text-error"}`}>
                {saveMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
