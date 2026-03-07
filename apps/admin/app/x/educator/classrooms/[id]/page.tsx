"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SendArtifactModal } from "@/components/educator/SendArtifactModal";
import { DifferentiationTab } from "@/components/educator/differentiation/DifferentiationTab";
import { LessonPlanTab } from "./LessonPlanTab";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { getTeachingProfile } from "@/lib/content-trust/teaching-profiles";
import type { TeachingProfile } from "@/lib/content-trust/teaching-profiles";
import "./classroom-detail.css";

async function fetchApi(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res.json();
}

interface Member {
  id: string;
  name: string;
  email: string | null;
  totalCalls: number;
  lastCallAt: string | null;
  joinedAt: string;
}

interface ClassroomDetail {
  id: string;
  name: string;
  description: string | null;
  domain: { id: string; name: string; slug: string };
  memberCount: number;
  maxMembers: number;
  isActive: boolean;
  joinToken: string | null;
  createdAt: string;
}

type Tab = "roster" | "lesson-plan" | "differentiation" | "settings";

export default function ClassroomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { terms, plural, lower, lowerPlural } = useTerminology();

  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("roster");

  // Editing state
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Invite state
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  // Active calls for "In Call" badges
  const [activeCalls, setActiveCalls] = useState<Map<string, string>>(new Map());

  // Max members editing
  const [editMaxMembers, setEditMaxMembers] = useState(50);

  // Token regeneration
  const [regeneratingToken, setRegeneratingToken] = useState(false);

  // Send to class modal
  const [showSendModal, setShowSendModal] = useState(false);

  // Teaching profile for the classroom's subject
  const [teachingProfile, setTeachingProfile] = useState<{ subjectName: string; profile: TeachingProfile } | null>(null);

  const loadClassroom = useCallback(async () => {
    const [classroomRes, callsRes] = await Promise.all([
      fetchApi(`/api/educator/classrooms/${id}`),
      fetchApi("/api/educator/active-calls"),
    ]);
    if (classroomRes?.ok) {
      setClassroom(classroomRes.classroom);
      setMembers(classroomRes.members);
      setEditName(classroomRes.classroom.name);
      setEditDesc(classroomRes.classroom.description ?? "");
      setEditMaxMembers(classroomRes.classroom.maxMembers ?? 50);
    }
    if (callsRes?.ok) {
      const map = new Map<string, string>();
      for (const c of callsRes.activeCalls) {
        if (c.callerId) map.set(c.callerId, c.callId);
      }
      setActiveCalls(map);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadClassroom();
  }, [loadClassroom]);

  // Fetch teaching profile for this classroom's domain subjects
  useEffect(() => {
    if (!classroom?.domain?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/subjects?domainId=${classroom.domain.id}`);
        const body = await res.json();
        if (cancelled) return;
        if (body.subjects?.length > 0) {
          // Find first subject with a teaching profile
          const subjects = body.subjects as { name: string; teachingProfile?: string | null }[];
          const withProfile = subjects.find((s) => s.teachingProfile);
          if (withProfile) {
            const profile = getTeachingProfile(withProfile.teachingProfile);
            if (profile) {
              setTeachingProfile({ subjectName: withProfile.name, profile });
            }
          }
        }
      } catch {
        // Non-critical — banner just won't show
      }
    })();
    return () => { cancelled = true; };
  }, [classroom?.domain?.id]);

  const { copied, copy: copyText } = useCopyToClipboard();
  const joinUrl = classroom?.joinToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${classroom.joinToken}`
    : "";

  const copyLink = () => {
    copyText(joinUrl);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await fetchApi(`/api/educator/classrooms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: editName, description: editDesc, maxMembers: editMaxMembers }),
    });
    if (res?.ok) {
      setClassroom((prev) => prev ? { ...prev, name: editName, description: editDesc || null, maxMembers: editMaxMembers } : prev);
    }
    setSaving(false);
  };

  const handleRegenerateToken = async () => {
    if (!confirm("Regenerate the invite link? The current link will stop working immediately.")) return;
    setRegeneratingToken(true);
    const res = await fetchApi(`/api/educator/classrooms/${id}/invite-link`, {
      method: "POST",
    });
    if (res?.ok) {
      setClassroom((prev) => prev ? { ...prev, joinToken: res.joinToken } : prev);
    }
    setRegeneratingToken(false);
  };

  const handleArchive = async () => {
    if (!confirm(`Archive this ${lower("cohort")}? ${plural("caller")} will no longer be tracked.`)) return;
    const res = await fetchApi(`/api/educator/classrooms/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });
    if (res?.ok) router.push("/x/educator/classrooms");
  };

  const handleInvite = async () => {
    const emails = inviteEmails
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

    if (emails.length === 0) return;

    setInviting(true);
    setInviteResult(null);

    const res = await fetchApi(`/api/educator/classrooms/${id}/invite`, {
      method: "POST",
      body: JSON.stringify({ emails }),
    });

    if (res?.ok) {
      setInviteResult(`${res.created} invite${res.created !== 1 ? "s" : ""} sent`);
      setInviteEmails("");
    } else {
      setInviteResult(res?.error ?? "Failed to send invites");
    }

    setInviting(false);
  };

  const handleRemoveMember = async (callerId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from this classroom?`)) return;
    const res = await fetchApi(`/api/educator/classrooms/${id}/members/${callerId}`, {
      method: "DELETE",
    });
    if (res?.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== callerId));
      setClassroom((prev) => prev ? { ...prev, memberCount: prev.memberCount - 1 } : prev);
    }
  };

  if (loading) {
    return (
      <div className="cls-loading">
        <div className="cls-loading-text">Loading {lower("cohort")}...</div>
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="cls-loading">
        <div className="cls-loading-text">{terms.cohort} not found.</div>
      </div>
    );
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return (
    <div>
      {/* Header */}
      <div className="cls-header">
        <Link href="/x/educator/classrooms" className="cls-back-link">
          &larr; {plural("cohort")}
        </Link>
        <div className="cls-header-row">
          <div>
            <h1 className="hf-page-title cls-title">
              {classroom.name}
            </h1>
            <div className="cls-header-meta">
              <span>{classroom.memberCount} {classroom.memberCount !== 1 ? lowerPlural("caller") : lower("caller")}</span>
              <span className="cls-domain-badge">
                {classroom.domain.name}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowSendModal(true)}
            className="hf-btn hf-btn-primary cls-send-btn"
          >
            Send to Class
          </button>
        </div>
      </div>

      {/* Join Link Banner */}
      {classroom.joinToken && (
        <div className="hf-banner hf-banner-info cls-banner">
          <span className="cls-banner-text">
            Invite link: <span className="cls-banner-url">{joinUrl}</span>
          </span>
          <div className="cls-banner-actions">
            <button
              onClick={copyLink}
              className={`hf-btn hf-btn-primary cls-copy-btn${copied ? " cls-copy-btn--copied" : ""}`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleRegenerateToken}
              disabled={regeneratingToken}
              className="hf-btn hf-btn-secondary cls-regen-btn"
              title="Generate a new link (invalidates the current one)"
            >
              {regeneratingToken ? "Regenerating..." : "Regenerate"}
            </button>
          </div>
        </div>
      )}

      {/* Teaching Profile Banner */}
      {teachingProfile && (
        <div className="hf-banner hf-banner-info cls-profile-banner">
          <div className="cls-profile-banner-content">
            <span className="cls-profile-banner-key">{teachingProfile.profile.key}</span>
            <span className="cls-profile-banner-desc">{teachingProfile.profile.description}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="cls-tab-bar">
        {(["roster", "lesson-plan", "differentiation", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`hf-tab${tab === t ? " hf-tab-active" : ""}`}
          >
            {t === "lesson-plan" ? "Lesson Plan" : t}
          </button>
        ))}
      </div>

      {/* Roster Tab */}
      {tab === "roster" && (
        <div>
          {/* Invite section */}
          <div className="hf-card-compact cls-invite-card">
            <div className="cls-invite-title">
              Invite {plural("caller")}
            </div>
            <div className="cls-invite-row">
              <input
                type="text"
                value={inviteEmails}
                onChange={(e) => setInviteEmails(e.target.value)}
                placeholder="Enter email addresses (comma-separated)"
                className="hf-input cls-invite-input"
              />
              <button
                disabled={inviting || !inviteEmails.trim()}
                onClick={handleInvite}
                className="hf-btn hf-btn-primary cls-invite-btn"
              >
                {inviting ? "Sending..." : "Send Invites"}
              </button>
            </div>
            {inviteResult && (
              <div className="cls-invite-result">
                {inviteResult}
              </div>
            )}
          </div>

          {/* Student List */}
          {members.length === 0 ? (
            <div className="cls-empty">
              No {lowerPlural("caller")} yet. Share the invite link or send email invites above.
            </div>
          ) : (
            <div className="hf-card-compact cls-table-card">

              <table className="cls-table">
                <thead>
                  <tr className="cls-table-head-row">
                    <th className="cls-th">Name</th>
                    <th className="cls-th-center">Calls</th>
                    <th className="cls-th">Last Call</th>
                    <th className="cls-th">Status</th>
                    <th className="cls-th-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const lastCall = m.lastCallAt ? new Date(m.lastCallAt).getTime() : 0;
                    const isActive = lastCall > sevenDaysAgo;
                    const neverCalled = !m.lastCallAt;
                    const statusClass = neverCalled ? "cls-status--not-started" : isActive ? "cls-status--active" : "cls-status--inactive";
                    const statusLabel = neverCalled ? "Not started" : isActive ? "Active" : "Inactive";

                    return (
                      <tr key={m.id} className="cls-table-row">
                        <td className="cls-td">
                          <Link
                            href={`/x/educator/students/${m.id}`}
                            className="cls-student-link"
                          >
                            {m.name}
                          </Link>
                        </td>
                        <td className="cls-td-center">
                          {m.totalCalls}
                        </td>
                        <td className="cls-td cls-last-call">
                          {m.lastCallAt
                            ? new Date(m.lastCallAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                            : "—"}
                        </td>
                        <td className="cls-td">
                          {activeCalls.has(m.id) ? (
                            <Link
                              href={`/x/educator/observe/${activeCalls.get(m.id)}`}
                              className="cls-in-call-badge"
                            >
                              <span className="cls-status-dot-active" />
                              In Call
                            </Link>
                          ) : (
                            <span className={`cls-status-indicator ${statusClass}`}>
                              <span className="cls-status-dot" />
                              {statusLabel}
                            </span>
                          )}
                        </td>
                        <td className="cls-td-right">
                          <button
                            onClick={() => handleRemoveMember(m.id, m.name)}
                            className="cls-remove-btn"
                            title={`Remove ${lower("caller")}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lesson Plan Tab */}
      {tab === "lesson-plan" && <LessonPlanTab classroomId={id} />}

      {/* Differentiation Tab */}
      {tab === "differentiation" && <DifferentiationTab classroomId={id} />}

      {/* Settings Tab */}
      {tab === "settings" && (
        <div className="hf-card">
          <div className="cls-settings-field">
            <label className="hf-label">{terms.cohort} Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="hf-input cls-settings-input"
            />
          </div>
          <div className="cls-settings-field-lg">
            <label className="hf-label">Description</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="hf-input cls-settings-textarea"
            />
          </div>
          <div className="cls-settings-field">
            <label className="hf-label">Max {plural("caller")}</label>
            <div className="cls-max-members-row">
              <input
                type="number"
                min={1}
                max={500}
                value={editMaxMembers}
                onChange={(e) => setEditMaxMembers(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                className="hf-input cls-max-members-input"
              />
              <span className="cls-max-members-hint">
                {classroom.memberCount}/{editMaxMembers} seats used
              </span>
            </div>
          </div>
          <div className="cls-settings-actions">
            <button
              disabled={saving}
              onClick={handleSave}
              className="hf-btn hf-btn-primary"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={handleArchive}
              className="hf-btn hf-btn-destructive"
            >
              Archive {terms.cohort}
            </button>
          </div>
        </div>
      )}

      {showSendModal && classroom && (
        <SendArtifactModal
          target={{ type: "classroom", id, name: classroom.name }}
          onClose={() => setShowSendModal(false)}
          onSuccess={() => setShowSendModal(false)}
        />
      )}
    </div>
  );
}
