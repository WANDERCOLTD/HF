"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plus, ChevronDown } from "lucide-react";
import Link from "next/link";
import {
  getTeachingProfile,
  TEACHING_PROFILE_KEYS,
  TEACHING_PROFILES,
} from "@/lib/content-trust/teaching-profiles";

interface SubjectItem {
  id: string;
  name: string;
  slug: string;
  teachingProfile?: string | null;
  _count?: { sources: number; domains: number };
}

interface Props {
  domainId: string | null;
  canEdit: boolean;
}

export function SubjectsSection({ domainId, canEdit }: Props) {
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [allSubjects, setAllSubjects] = useState<SubjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickingProfileFor, setPickingProfileFor] = useState<string | null>(null);
  const [savingProfileFor, setSavingProfileFor] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    if (!domainId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/subjects?domainId=${domainId}`);
      const data = await res.json();
      if (data.subjects) setSubjects(data.subjects);
    } catch { /* ignore */ }
    setLoading(false);
  }, [domainId]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const loadAllSubjects = useCallback(async () => {
    try {
      const res = await fetch("/api/subjects");
      const data = await res.json();
      if (data.subjects) setAllSubjects(data.subjects);
    } catch { /* ignore */ }
  }, []);

  const handleAdd = async (subjectId: string) => {
    if (!domainId) return;
    setSaving(true);
    try {
      await fetch(`/api/domains/${domainId}/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId }),
      });
      await loadSubjects();
      setShowAdd(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleRemove = async (subjectId: string) => {
    if (!domainId) return;
    setSaving(true);
    try {
      await fetch(`/api/domains/${domainId}/subjects/${subjectId}`, {
        method: "DELETE",
      });
      await loadSubjects();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleSetProfile = async (subjectId: string, profileKey: string | null) => {
    setSavingProfileFor(subjectId);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teachingProfile: profileKey }),
      });
      if (res.ok) {
        // Update local state to reflect the change
        setSubjects((prev) =>
          prev.map((s) =>
            s.id === subjectId ? { ...s, teachingProfile: profileKey } : s
          )
        );
      }
    } catch { /* ignore */ }
    setSavingProfileFor(null);
    setPickingProfileFor(null);
  };

  if (!domainId) {
    return (
      <div className="hf-no-domain-hint">
        Select a domain above to manage subjects.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-gap-sm">
        <div className="hf-spinner hf-spinner-sm" />
        <span className="hf-text-sm hf-text-muted">Loading subjects...</span>
      </div>
    );
  }

  const linkedIds = new Set(subjects.map((s) => s.id));
  const available = allSubjects.filter((s) => !linkedIds.has(s.id));

  return (
    <div>
      {subjects.length === 0 ? (
        <p className="hf-text-sm hf-text-muted">
          No subjects linked yet. Add subjects to help the AI understand what you teach.
        </p>
      ) : (
        <div className="hf-subject-profile-list hf-mb-12">
          {subjects.map((s) => {
            const profile = getTeachingProfile(s.teachingProfile);
            const isPicking = pickingProfileFor === s.id;
            const isSavingProfile = savingProfileFor === s.id;

            return (
              <div key={s.id} className="hf-subject-profile-row">
                <div className="hf-flex hf-items-center hf-gap-sm hf-flex-wrap">
                  <span className="hf-text-sm hf-text-bold">{s.name}</span>
                  <span className={`hf-badge hf-badge-sm${profile ? " hf-badge-accent" : " hf-badge-muted"}`}>
                    {profile ? profile.key : "no profile"}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost hf-btn-xs"
                      onClick={() => setPickingProfileFor(isPicking ? null : s.id)}
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? (
                        <span className="hf-spinner hf-spinner-xs" />
                      ) : (
                        <>
                          {profile ? "Change" : "Set"}
                          <ChevronDown size={12} />
                        </>
                      )}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="hf-chip-remove-btn"
                      onClick={() => handleRemove(s.id)}
                      disabled={saving}
                      title={`Remove ${s.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {profile && (
                  <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">
                    {profile.description}
                  </p>
                )}

                {/* Profile picker dropdown */}
                {isPicking && (
                  <div className="hf-profile-picker hf-mt-sm">
                    {TEACHING_PROFILE_KEYS.map((key) => {
                      const p = TEACHING_PROFILES[key];
                      const isSelected = s.teachingProfile === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`hf-profile-picker-option${isSelected ? " hf-profile-picker-option--selected" : ""}`}
                          onClick={() => handleSetProfile(s.id, key)}
                          disabled={isSavingProfile}
                        >
                          <span className="hf-text-sm hf-text-bold">{key}</span>
                          <span className="hf-text-xs hf-text-muted">{p.description}</span>
                          <span className="hf-text-xs hf-text-muted">Best for: {p.bestFor}</span>
                        </button>
                      );
                    })}
                    {s.teachingProfile && (
                      <button
                        type="button"
                        className="hf-profile-picker-option hf-profile-picker-option--clear"
                        onClick={() => handleSetProfile(s.id, null)}
                        disabled={isSavingProfile}
                      >
                        <span className="hf-text-sm hf-text-muted">Clear profile</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && !showAdd && (
        <button
          type="button"
          className="hf-btn hf-btn-ghost hf-btn-sm"
          onClick={() => { setShowAdd(true); loadAllSubjects(); }}
        >
          <Plus size={14} /> Add subject
        </button>
      )}

      {showAdd && (
        <div className="hf-mt-sm">
          {available.length === 0 ? (
            <p className="hf-text-sm hf-text-muted">
              All subjects are already linked.{" "}
              <Link href="/x/subjects" className="hf-link">Create new subjects</Link>
            </p>
          ) : (
            <div className="hf-chip-row">
              {available.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="hf-chip"
                  onClick={() => handleAdd(s.id)}
                  disabled={saving}
                >
                  <Plus size={12} /> {s.name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="hf-btn hf-btn-ghost hf-btn-xs hf-mt-sm"
            onClick={() => setShowAdd(false)}
          >
            Cancel
          </button>
        </div>
      )}

      <p className="hf-text-xs hf-text-muted hf-mt-md">
        <Link href="/x/subjects" className="hf-link">Manage subject details</Link>
      </p>
    </div>
  );
}
