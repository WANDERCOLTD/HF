"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTerminology } from "@/contexts/TerminologyContext";
import EducatorReadiness from "@/components/educator/EducatorReadiness";
import { getTeachingProfile } from "@/lib/content-trust/teaching-profiles";
import type { TeachingProfile } from "@/lib/content-trust/teaching-profiles";
import "./educator.css";

interface DashboardData {
  institution: {
    name: string;
    logoUrl: string | null;
    welcomeMessage: string | null;
    primaryColor: string | null;
  } | null;
  classrooms: {
    id: string;
    name: string;
    domain: { id: string; name: string; slug: string };
    memberCount: number;
    createdAt: string;
  }[];
  stats: {
    departmentCount: number;
    courseCount: number;
    classroomCount: number;
    totalStudents: number;
    activeThisWeek: number;
  };
  courses: {
    id: string;
    name: string;
    status: string;
    subjects: string[];
    groupName: string | null;
    groupId: string | null;
    cohortCount: number;
    studentCount: number;
  }[];
  recentCalls: {
    id: string;
    createdAt: string;
    studentName: string;
    studentId: string;
  }[];
  needsAttention: {
    id: string;
    name: string;
    classroom: string;
  }[];
  assessmentSummary: {
    totalWithTargets: number;
    readyCount: number;
    distribution: { low: number; mid: number; high: number; ready: number };
  } | null;
}

interface InstitutionOption {
  id: string;
  name: string;
  slug: string;
}

export default function EducatorDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { terms, plural, lower, lowerPlural } = useTerminology();

  // School picker for ADMIN users without an educator profile
  const [needsSchoolPicker, setNeedsSchoolPicker] = useState(false);
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null);

  // Department data
  const [departments, setDepartments] = useState<{ id: string; name: string; courseCount: number; classCount: number }[]>([]);

  // Subject teaching profiles
  const [subjectProfiles, setSubjectProfiles] = useState<{ name: string; profile: TeachingProfile }[]>([]);

  // Invite teacher state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);

  const handleInviteTeacher = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/educator/invite-teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const body = await res.json();
      if (body.ok) {
        setInviteResult({ ok: true, message: "Invite sent!", url: body.inviteUrl });
        setInviteEmail("");
      } else {
        setInviteResult({ ok: false, message: body.error || "Failed to send invite" });
      }
    } catch {
      setInviteResult({ ok: false, message: "Network error" });
    } finally {
      setInviting(false);
    }
  }, [inviteEmail]);

  const loadDashboard = useCallback(async (institutionId?: string) => {
    setLoading(true);
    try {
      const url = institutionId
        ? `/api/educator/dashboard?institutionId=${institutionId}`
        : "/api/educator/dashboard";
      const res = await fetch(url);

      if (res.status === 403 && !institutionId) {
        // Check if user has ADMIN+ access — try institutions endpoint
        const instRes = await fetch("/api/institutions");
        if (instRes.ok) {
          // ADMIN user without educator profile — show institution picker
          const instData = await instRes.json();
          if (instData?.institutions) {
            setInstitutions(instData.institutions.map((i: { id: string; name: string; slug: string }) => ({
              id: i.id, name: i.name, slug: i.slug,
            })));
          }
          setNeedsSchoolPicker(true);
        } else {
          // EDUCATOR without a TEACHER profile — redirect to setup wizard
          window.location.href = "/x/get-started-v5";
        }
        return;
      }

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        setLoadError(errorBody?.error || "Failed to load dashboard. Please try again.");
        return;
      }

      const body = await res.json();
      if (body?.ok) {
        setData(body);
        setNeedsSchoolPicker(false);
      }
    } catch {
      setLoadError("Failed to load dashboard. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Load departments and subject profiles when dashboard data is available
  useEffect(() => {
    if (!data?.classrooms?.length) return;
    const domainId = data.classrooms[0]?.domain?.id;
    if (!domainId) return;

    (async () => {
      try {
        const [groupsRes, subjectsRes] = await Promise.all([
          fetch(`/api/playbook-groups?domainId=${domainId}`),
          fetch(`/api/subjects?domainId=${domainId}`),
        ]);
        const groupsBody = await groupsRes.json();
        if (groupsBody.ok && groupsBody.groups?.length > 0) {
          setDepartments(groupsBody.groups.map((g: any) => ({
            id: g.id,
            name: g.name,
            courseCount: g._count?.playbooks ?? 0,
            classCount: g._count?.cohortGroups ?? 0,
          })));
        }
        const subjectsBody = await subjectsRes.json();
        if (subjectsBody.subjects?.length > 0) {
          const subjects = subjectsBody.subjects as { name: string; teachingProfile?: string | null }[];
          // Deduplicate by name — same subject can appear across multiple courses
          const seen = new Set<string>();
          const withProfiles = subjects
            .filter((s) => s.teachingProfile)
            .filter((s) => { if (seen.has(s.name)) return false; seen.add(s.name); return true; })
            .map((s) => ({
              name: s.name,
              profile: getTeachingProfile(s.teachingProfile)!,
            }))
            .filter((sp: { name: string; profile: TeachingProfile | null }) => sp.profile !== null);
          setSubjectProfiles(withProfiles);
        }
      } catch {
        // Non-critical — department cards and profiles just won't show
      }
    })();
  }, [data]);

  const handleSelectSchool = useCallback((institutionId: string) => {
    setSelectedInstitutionId(institutionId);
    loadDashboard(institutionId);
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="edu-loading">
        <div className="edu-loading-text">Loading your {lower("domain")}...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="edu-error">
        <div className="edu-error-banner">
          {loadError}
        </div>
      </div>
    );
  }

  // Picker for ADMIN users
  if (needsSchoolPicker && !loading) {
    return (
      <div data-tour="welcome" className="edu-page">
        <div className="edu-header">
          <h1 className="hf-page-title edu-header-title">
            Select a {terms.domain}
          </h1>
          <p className="hf-page-subtitle">
            As an admin, choose which {lower("domain")} dashboard to view.
          </p>
        </div>
        <div className="edu-picker-grid">
          {institutions.map((inst) => (
            <button
              key={inst.id}
              onClick={() => handleSelectSchool(inst.id)}
              className={`edu-picker-card${selectedInstitutionId === inst.id ? " edu-picker-card-selected" : ""}`}
            >
              <div className="edu-picker-name">
                {inst.name}
              </div>
              <div className="edu-picker-slug">
                {inst.slug}
              </div>
            </button>
          ))}
        </div>
        {institutions.length === 0 && (
          <p className="edu-picker-empty">
            No {lowerPlural("domain")} found.{" "}
            <Link href="/x/institutions/new" className="edu-picker-empty-link">
              Create one
            </Link>{" "}
            to get started.
          </p>
        )}
      </div>
    );
  }

  const stats = data?.stats ?? { departmentCount: 0, courseCount: 0, classroomCount: 0, totalStudents: 0, activeThisWeek: 0 };
  const hasClassrooms = stats.classroomCount > 0;
  const viewingSchoolName = selectedInstitutionId
    ? institutions.find((i) => i.id === selectedInstitutionId)?.name
    : null;
  const instQuery = selectedInstitutionId ? `?institutionId=${selectedInstitutionId}` : "";

  return (
    <div data-tour="welcome" className="edu-page">
      {/* Hero Section */}
      <div className="hf-card edu-hero" style={{
        padding: "24px",
        marginBottom: 24,
        ...(data?.institution?.primaryColor ? { borderTop: `3px solid ${data.institution.primaryColor}` } : {}),
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {data?.institution?.logoUrl && (
              <img src={data.institution.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
            )}
            <div>
              {viewingSchoolName && (
                <button
                  onClick={() => { setNeedsSchoolPicker(true); setData(null); }}
                  className="hf-text-xs hf-text-muted hf-link"
                  style={{ marginBottom: 2, display: "block", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  &larr; Change {terms.domain}
                </button>
              )}
              <h1 className="hf-page-title" style={{ margin: 0, fontSize: "1.5rem" }}>
                {data?.institution?.name ?? viewingSchoolName ?? `My ${terms.domain}`}
              </h1>
              {data?.institution?.welcomeMessage && (
                <p className="hf-text-sm hf-text-muted" style={{ margin: "4px 0 0" }}>{data.institution.welcomeMessage}</p>
              )}
            </div>
          </div>
          <Link href={`/x/educator/settings${instQuery}`} className="hf-text-muted" style={{ padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </Link>
        </div>

        {/* Clickable counter row — follows entity hierarchy, hidden when 0 */}
        <div className="edu-stats-grid">
          {[
            { label: plural("group"), value: stats.departmentCount, href: `/x/educator/departments${instQuery}`, color: "var(--accent-secondary, var(--accent-primary))" },
            { label: plural("playbook"), value: stats.courseCount, href: `/x/courses${instQuery}`, color: "var(--button-primary-bg)" },
            { label: plural("cohort"), value: stats.classroomCount, href: `/x/educator/classrooms${instQuery}`, color: "var(--accent-primary)" },
            { label: plural("caller"), value: stats.totalStudents, href: `/x/educator/students${instQuery}`, color: "var(--status-info-text, var(--button-primary-bg))" },
            { label: "Active This Week", value: stats.activeThisWeek, href: "", color: "var(--status-success-text)" },
          ]
            .filter((s) => s.value > 0 || s.label === "Active This Week")
            .map((stat) => (
              stat.href ? (
                <Link
                  key={stat.label}
                  href={stat.href}
                  className="hf-card-compact flex flex-col items-center justify-center edu-stat-card"
                  style={{ textDecoration: "none", color: "inherit", cursor: "pointer" }}
                >
                  <div className="hf-stat-value" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="hf-stat-label">{stat.label}</div>
                </Link>
              ) : (
                <div key={stat.label} className="hf-card-compact flex flex-col items-center justify-center edu-stat-card">
                  <div className="hf-stat-value" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="hf-stat-label">{stat.label}</div>
                </div>
              )
            ))}
        </div>
      </div>

      {/* My Courses */}
      {(data?.courses?.length ?? 0) > 0 && (
        <div className="edu-courses-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 className="hf-section-title" style={{ margin: 0 }}>My {plural("playbook")}</h2>
            <Link href={`/x/courses${instQuery}`} className="hf-text-xs hf-link">View All &rarr;</Link>
          </div>
          <div className="edu-courses-grid">
            {data!.courses.map((course) => (
              <Link
                key={course.id}
                href={`/x/courses/${course.id}`}
                className="hf-card-compact edu-course-card"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="edu-course-name">{course.name}</div>
                {course.subjects.length > 0 && (
                  <div className="edu-course-subject">
                    <span className="edu-course-dot" />
                    {course.subjects.join(", ")}
                  </div>
                )}
                <div className="hf-flex hf-gap-sm" style={{ flexWrap: "wrap", marginTop: 4 }}>
                  {course.groupName && (
                    <span className="hf-badge hf-badge-neutral" style={{ fontSize: "0.65rem" }}>{course.groupName}</span>
                  )}
                  <span className="hf-text-xs hf-text-muted">
                    {course.studentCount} {course.studentCount === 1 ? lower("caller") : lowerPlural("caller")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Teaching Approach */}
      {subjectProfiles.length > 0 && (
        <div className="edu-teaching-approach">
          <h2 className="hf-section-title">Teaching Approach</h2>
          <div className="hf-card edu-teaching-card">
            {subjectProfiles.map((sp) => (
              <div key={sp.name} className="edu-profile-row">
                <div className="edu-profile-subject">{sp.name}</div>
                <div className="edu-profile-detail">
                  <span className="edu-profile-pill">{sp.profile.key}</span>
                  <span className="hf-text-sm hf-text-muted">{sp.profile.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Departments */}
      {departments.length > 0 && (
        <div className="edu-departments-section">
          <h2 className="hf-section-title">{plural("group")}</h2>
          <div className="edu-stats-grid">
            {departments.map((dept) => (
              <Link
                key={dept.id}
                href={`/x/educator/departments/${dept.id}`}
                className="hf-card-compact edu-dept-card"
              >
                <div className="edu-dept-name">{dept.name}</div>
                <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted">
                  <span>{dept.courseCount} {dept.courseCount === 1 ? lower("playbook") : lowerPlural("playbook")}</span>
                  <span>{dept.classCount} {dept.classCount === 1 ? lower("cohort") : lowerPlural("cohort")}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Readiness Card */}
      {hasClassrooms && (
        <EducatorReadiness institutionId={selectedInstitutionId ?? undefined} />
      )}

      {/* Quick Actions */}
      <div className="edu-actions-section">
        <h2 className="hf-section-title edu-actions-title">
          Quick Actions
        </h2>
        <div className="edu-actions-grid">
          {[
            {
              title: `Create ${terms.cohort}`,
              description: `Set up a new ${lower("cohort")}`,
              href: `/x/educator/classrooms/new${instQuery}`,
              accent: "var(--accent-primary)",
            },
            {
              title: `View ${plural("caller")}`,
              description: `Track progress across all ${lowerPlural("cohort")}`,
              href: `/x/educator/students${instQuery}`,
              accent: "var(--button-primary-bg)",
            },
            {
              title: "Try a Call",
              description: `Experience what your ${lowerPlural("caller")} will`,
              href: `/x/educator/try${instQuery}`,
              accent: "var(--badge-purple-text)",
            },
            {
              title: "View Reports",
              description: "Analytics and engagement data",
              href: `/x/educator/reports${instQuery}`,
              accent: "var(--status-success-text)",
            },
          ].map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="hf-card-compact home-stat-card flex flex-col edu-action-card"
              style={{ borderLeft: `3px solid ${action.accent}` }}
            >
              <div className="edu-action-title">
                {action.title}
              </div>
              <div className="edu-action-desc">
                {action.description}
              </div>
            </Link>
          ))}

          {/* Invite Teacher Button */}
          <button
            onClick={() => { setShowInviteForm(!showInviteForm); setInviteResult(null); }}
            className="hf-card-compact home-stat-card flex flex-col text-left cursor-pointer edu-action-card edu-action-invite"
          >
            <div className="edu-action-title">
              Invite a {terms.instructor}
            </div>
            <div className="edu-action-desc">
              Bring a colleague onto the platform
            </div>
          </button>
        </div>

        {/* Inline Invite Form */}
        {showInviteForm && (
          <div className="hf-card-compact flex flex-wrap items-start gap-2 edu-invite-form">
            <input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInviteTeacher()}
              className="hf-input edu-invite-input"
            />
            <button
              onClick={handleInviteTeacher}
              disabled={inviting || !inviteEmail.trim()}
              className="hf-btn hf-btn-primary edu-invite-btn"
            >
              {inviting ? "Sending..." : "Send Invite"}
            </button>
            {inviteResult && (
              <div className={`edu-invite-result ${inviteResult.ok ? "edu-invite-result-success" : "edu-invite-result-error"}`}>
                {inviteResult.message}
                {inviteResult.url && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(inviteResult.url!);
                      setInviteResult({ ...inviteResult, message: "Link copied!" });
                    }}
                    className="hf-btn hf-btn-secondary edu-copy-btn"
                  >
                    Copy Link
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two Column: Recent Activity + Needs Attention */}
      <div className={`edu-two-col ${hasClassrooms ? "edu-two-col-half" : "edu-two-col-full"}`}>
        {/* Recent Activity */}
        <div className="hf-card edu-panel">
          <h3 className="hf-category-label edu-panel-title">
            Recent Activity
          </h3>
          {(!data?.recentCalls || data.recentCalls.length === 0) ? (
            <p className="edu-empty-text">
              No calls yet. Invite {lowerPlural("caller")} to get started.
            </p>
          ) : (
            <div className="edu-list">
              {data.recentCalls.map((call) => (
                <div key={call.id} className="edu-list-row">
                  <div>
                    <Link
                      href={`/x/educator/students/${call.studentId}`}
                      className="edu-row-link"
                    >
                      {call.studentName}
                    </Link>
                  </div>
                  <span className="edu-row-date">
                    {new Date(call.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Needs Attention */}
        {hasClassrooms && (
          <div className="hf-card edu-panel">
            <h3 className="hf-category-label edu-panel-title">
              Needs Attention
            </h3>
            {(!data?.needsAttention || data.needsAttention.length === 0) ? (
              <p className="edu-empty-text">
                All {lowerPlural("caller")} are active. Great work!
              </p>
            ) : (
              <div className="edu-list">
                {data.needsAttention.map((student) => (
                  <div key={student.id} className="edu-list-row">
                    <Link
                      href={`/x/educator/students/${student.id}`}
                      className="edu-row-link"
                    >
                      {student.name}
                    </Link>
                    <span className="edu-classroom-badge">
                      {student.classroom}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Assessment Progress */}
        {data?.assessmentSummary && (
          <div className="hf-card edu-panel">
            <h3 className="hf-category-label edu-panel-title">
              Assessment Progress
            </h3>
            <div className="edu-assess-summary">
              <div className="edu-assess-headline">
                <span className="edu-assess-ready">{data.assessmentSummary.readyCount}</span>
                <span className="edu-assess-total">
                  of {data.assessmentSummary.totalWithTargets} {lowerPlural("caller")} ready
                </span>
              </div>
              <div className="edu-assess-bar">
                {data.assessmentSummary.distribution.ready > 0 && (
                  <div
                    className="edu-assess-seg edu-assess-seg-green"
                    style={{ flex: data.assessmentSummary.distribution.ready }}
                    title={`${data.assessmentSummary.distribution.ready} ready`}
                  />
                )}
                {data.assessmentSummary.distribution.high > 0 && (
                  <div
                    className="edu-assess-seg edu-assess-seg-blue"
                    style={{ flex: data.assessmentSummary.distribution.high }}
                    title={`${data.assessmentSummary.distribution.high} near ready (60-80%)`}
                  />
                )}
                {data.assessmentSummary.distribution.mid > 0 && (
                  <div
                    className="edu-assess-seg edu-assess-seg-orange"
                    style={{ flex: data.assessmentSummary.distribution.mid }}
                    title={`${data.assessmentSummary.distribution.mid} in progress (30-60%)`}
                  />
                )}
                {data.assessmentSummary.distribution.low > 0 && (
                  <div
                    className="edu-assess-seg edu-assess-seg-red"
                    style={{ flex: data.assessmentSummary.distribution.low }}
                    title={`${data.assessmentSummary.distribution.low} early stage (<30%)`}
                  />
                )}
              </div>
              <div className="edu-assess-legend">
                <span className="edu-assess-legend-item"><span className="edu-assess-dot edu-assess-dot-green" /> Ready</span>
                <span className="edu-assess-legend-item"><span className="edu-assess-dot edu-assess-dot-blue" /> Near</span>
                <span className="edu-assess-legend-item"><span className="edu-assess-dot edu-assess-dot-orange" /> In progress</span>
                <span className="edu-assess-legend-item"><span className="edu-assess-dot edu-assess-dot-red" /> Early</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Empty State CTA */}
      {!hasClassrooms && (
        <div className="hf-card text-center edu-empty-cta">
          <div className="edu-empty-icon">
            <span role="img" aria-label="welcome">👋</span>
          </div>
          <h3 className="edu-empty-title">
            Welcome to your {lower("domain")}
          </h3>
          <p className="edu-empty-desc">
            Create your first {lower("cohort")}, invite {lowerPlural("caller")}, and start tracking
            their learning journey.
          </p>
          <Link
            href="/x/educator/classrooms/new"
            className="hf-btn hf-btn-primary edu-empty-cta-link"
          >
            Create {terms.cohort}
          </Link>
        </div>
      )}
    </div>
  );
}
