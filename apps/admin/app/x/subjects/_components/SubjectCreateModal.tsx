"use client";

import { useState } from "react";
import { TRUST_LEVELS } from "@/app/x/content-sources/_components/shared/badges";
import {
  TEACHING_PROFILE_KEYS,
  TEACHING_PROFILES,
  suggestTeachingProfile,
} from "@/lib/content-trust/teaching-profiles";

interface SubjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (subjectId: string) => void;
}

function autoSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function SubjectCreateModal({ isOpen, onClose, onCreated }: SubjectCreateModalProps) {
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTrustLevel, setNewTrustLevel] = useState("UNVERIFIED");
  const [newQualBody, setNewQualBody] = useState("");
  const [newQualRef, setNewQualRef] = useState("");
  const [newQualLevel, setNewQualLevel] = useState("");
  const [newTeachingProfile, setNewTeachingProfile] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setNewName("");
    setNewSlug("");
    setNewDescription("");
    setNewTrustLevel("UNVERIFIED");
    setNewQualBody("");
    setNewQualRef("");
    setNewQualLevel("");
    setNewTeachingProfile("");
    setError(null);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: newSlug || autoSlug(newName),
          name: newName.trim(),
          description: newDescription.trim() || null,
          defaultTrustLevel: newTrustLevel,
          teachingProfile: newTeachingProfile || null,
          qualificationBody: newQualBody.trim() || null,
          qualificationRef: newQualRef.trim() || null,
          qualificationLevel: newQualLevel.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      onCreated(data.subject.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="hf-modal-overlay"
      onClick={() => !creating && onClose()}
    >
      <div
        className="hf-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 500, maxWidth: "90vw", padding: 24 }}
      >
        <h3 className="hf-heading-lg" style={{ margin: "0 0 4px" }}>New Subject</h3>
        <p className="hf-text-sm hf-text-muted" style={{ margin: "0 0 20px" }}>
          Create a new teaching subject
        </p>

        {error && (
          <div className="hf-banner hf-banner-error hf-mb-md hf-text-sm">{error}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="hf-label">Name *</label>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!newSlug || newSlug === autoSlug(newName)) setNewSlug(autoSlug(e.target.value));
                const suggested = suggestTeachingProfile(e.target.value);
                if (suggested) setNewTeachingProfile(suggested);
              }}
              placeholder="Food Safety Level 2"
              className="hf-input"
            />
          </div>
          <div>
            <label className="hf-label">Slug</label>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="food-safety-l2"
              className="hf-input"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="hf-label">Description</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this subject covers..."
              rows={2}
              className="hf-input"
              style={{ resize: "vertical" }}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="hf-label">Teaching Profile</label>
            <select
              value={newTeachingProfile}
              onChange={(e) => setNewTeachingProfile(e.target.value)}
              className="hf-input"
            >
              <option value="">None</option>
              {TEACHING_PROFILE_KEYS.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            {newTeachingProfile && TEACHING_PROFILES[newTeachingProfile as keyof typeof TEACHING_PROFILES] && (
              <p className="hf-text-sm hf-text-muted" style={{ margin: "6px 0 0" }}>
                {TEACHING_PROFILES[newTeachingProfile as keyof typeof TEACHING_PROFILES].description}
                {" "}Best for: {TEACHING_PROFILES[newTeachingProfile as keyof typeof TEACHING_PROFILES].bestFor}.
              </p>
            )}
          </div>
          <div>
            <label className="hf-label">Default Trust Level</label>
            <select
              value={newTrustLevel}
              onChange={(e) => setNewTrustLevel(e.target.value)}
              className="hf-input"
            >
              {TRUST_LEVELS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="hf-label">Qualification Level</label>
            <input
              value={newQualLevel}
              onChange={(e) => setNewQualLevel(e.target.value)}
              placeholder="Level 2"
              className="hf-input"
            />
          </div>
          <div>
            <label className="hf-label">Qualification Body</label>
            <input
              value={newQualBody}
              onChange={(e) => setNewQualBody(e.target.value)}
              placeholder="Highfield, CII"
              className="hf-input"
            />
          </div>
          <div>
            <label className="hf-label">Qualification Ref</label>
            <input
              value={newQualRef}
              onChange={(e) => setNewQualRef(e.target.value)}
              placeholder="Highfield L2 Food Safety"
              className="hf-input"
            />
          </div>
        </div>

        <div className="hf-flex hf-gap-sm" style={{ marginTop: 20, justifyContent: "flex-end" }}>
          <button
            onClick={() => { onClose(); resetForm(); }}
            disabled={creating}
            className="hf-btn hf-btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="hf-btn hf-btn-primary"
            style={{ opacity: creating || !newName.trim() ? 0.5 : 1 }}
          >
            {creating ? "Creating..." : "Create & Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
