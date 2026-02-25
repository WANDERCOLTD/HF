"use client";

/**
 * CurriculumEditor — inline CRUD for curriculum modules.
 * Loads from GET /api/curricula/{id}/modules (DB-first).
 * Supports: expand/collapse, inline edit title/description/LOs, reorder, add, delete.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, GripVertical, Plus, Trash2, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LearningObjective {
  id: string;
  ref: string;
  description: string;
  sortOrder: number;
}

interface ModuleRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  estimatedDurationMinutes: number | null;
  keyTerms: string[];
  assessmentCriteria: string[];
  learningObjectives: LearningObjective[];
  _count?: { callerProgress: number; calls: number };
}

interface CurriculumEditorProps {
  curriculumId: string;
  curriculumName?: string;
  curriculumDescription?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CurriculumEditor({
  curriculumId,
  curriculumName,
  curriculumDescription,
}: CurriculumEditorProps) {
  const [modules, setModules] = useState<ModuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // moduleId being saved
  const [addingModule, setAddingModule] = useState(false);

  // ── Load modules from API ──────────────────────────────

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/curricula/${curriculumId}/modules`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      setModules(data.modules || []);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Failed to load modules");
      }
    } finally {
      setLoading(false);
    }
  }, [curriculumId]);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  // ── PATCH a single module ──────────────────────────────

  const patchModule = async (moduleId: string, patch: Record<string, any>) => {
    setSaving(moduleId);
    try {
      const res = await fetch(
        `/api/curricula/${curriculumId}/modules/${moduleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      const data = await res.json();
      setModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, ...data.module } : m)),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  // ── DELETE a module ────────────────────────────────────

  const deleteModule = async (moduleId: string) => {
    if (!confirm("Delete this module? This cannot be undone.")) return;
    setSaving(moduleId);
    try {
      const res = await fetch(
        `/api/curricula/${curriculumId}/modules/${moduleId}`,
        { method: "DELETE", signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      setModules((prev) => prev.filter((m) => m.id !== moduleId));
      if (expandedId === moduleId) setExpandedId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  // ── ADD a new module ───────────────────────────────────

  const addModule = async (title: string, description: string) => {
    setSaving("new");
    try {
      const slug = `MOD-${modules.length + 1}`;
      const res = await fetch(`/api/curricula/${curriculumId}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modules: [
            {
              slug,
              title,
              description,
              sortOrder: modules.length,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Add failed");
      const data = await res.json();
      setModules(data.modules || []);
      setAddingModule(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  // ── Reorder (swap) ─────────────────────────────────────

  const moveModule = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;

    const reordered = [...modules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const items = reordered.map((m, i) => ({ id: m.id, sortOrder: i }));

    // Optimistic update
    setModules(reordered.map((m, i) => ({ ...m, sortOrder: i })));

    try {
      const res = await fetch(`/api/curricula/${curriculumId}/modules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        // Revert on failure
        setModules(modules);
        throw new Error("Reorder failed");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="hf-text-center" style={{ padding: 24 }}>
        <div className="hf-spinner" />
        <p className="hf-text-sm hf-text-muted" style={{ marginTop: 8 }}>Loading modules...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-banner hf-banner-error hf-mb-md">
        {error}
        <button onClick={loadModules} className="hf-btn hf-btn-secondary hf-text-xs" style={{ marginLeft: 8 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {curriculumName && (
        <h4 className="hf-heading-md hf-mb-xs" style={{ marginTop: 0 }}>
          {curriculumName}
        </h4>
      )}
      {curriculumDescription && (
        <p className="hf-text-sm hf-text-muted" style={{ margin: "0 0 12px" }}>
          {curriculumDescription}
        </p>
      )}

      {modules.length === 0 && !addingModule ? (
        <div className="hf-text-center hf-text-muted" style={{ padding: 24 }}>
          <p className="hf-text-sm">No modules yet.</p>
          <button onClick={() => setAddingModule(true)} className="hf-btn hf-btn-primary hf-text-sm" style={{ marginTop: 8 }}>
            <Plus size={14} style={{ marginRight: 4 }} />
            Add Module
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {modules.map((mod, idx) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              index={idx}
              totalCount={modules.length}
              isExpanded={expandedId === mod.id}
              isSaving={saving === mod.id}
              onToggle={() => setExpandedId(expandedId === mod.id ? null : mod.id)}
              onPatch={(patch) => patchModule(mod.id, patch)}
              onDelete={() => deleteModule(mod.id)}
              onMoveUp={() => moveModule(idx, -1)}
              onMoveDown={() => moveModule(idx, 1)}
            />
          ))}
        </div>
      )}

      {addingModule ? (
        <AddModuleForm
          onSave={addModule}
          onCancel={() => setAddingModule(false)}
          saving={saving === "new"}
        />
      ) : (
        modules.length > 0 && (
          <button
            onClick={() => setAddingModule(true)}
            className="hf-btn hf-btn-secondary hf-text-sm hf-mt-md"
          >
            <Plus size={14} style={{ marginRight: 4 }} />
            Add Module
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModuleCard — expandable card with inline editing
// ---------------------------------------------------------------------------

function ModuleCard({
  mod,
  index,
  totalCount,
  isExpanded,
  isSaving,
  onToggle,
  onPatch,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  mod: ModuleRecord;
  index: number;
  totalCount: number;
  isExpanded: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onPatch: (patch: Record<string, any>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(mod.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(mod.description || "");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleRef.current) titleRef.current.focus();
  }, [editingTitle]);

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft !== mod.title) {
      onPatch({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft !== (mod.description || "")) {
      onPatch({ description: descDraft.trim() || null });
    }
    setEditingDesc(false);
  };

  const saveLOs = (los: { ref: string; description: string }[]) => {
    onPatch({ learningObjectives: los });
  };

  return (
    <div className="hf-card-compact" style={{ opacity: isSaving ? 0.7 : 1, transition: "opacity 0.15s" }}>
      {/* Header row */}
      <div
        className="hf-flex hf-gap-sm hf-items-center"
        style={{ cursor: "pointer" }}
        onClick={onToggle}
      >
        {/* Reorder buttons */}
        <div className="hf-flex-col" style={{ gap: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            className="hf-btn-icon"
            style={{ padding: 0, opacity: index === 0 ? 0.2 : 0.6, fontSize: 10, lineHeight: 1 }}
            title="Move up"
          >
            ▲
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === totalCount - 1}
            className="hf-btn-icon"
            style={{ padding: 0, opacity: index === totalCount - 1 ? 0.2 : 0.6, fontSize: 10, lineHeight: 1 }}
            title="Move down"
          >
            ▼
          </button>
        </div>

        <ChevronRight
          size={14}
          style={{
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            color: "var(--text-muted)",
          }}
        />
        <span
          className="hf-text-xs hf-mono"
          style={{ fontWeight: 700, color: "var(--accent-primary)" }}
        >
          {mod.slug}
        </span>

        {/* Title (click-to-edit) */}
        {editingTitle ? (
          <input
            ref={titleRef}
            className="hf-input hf-text-md"
            style={{ padding: "2px 6px", flex: 1 }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") { setTitleDraft(mod.title); setEditingTitle(false); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="hf-text-md hf-text-bold hf-flex-1"
            style={{ cursor: "text" }}
            onClick={(e) => { e.stopPropagation(); setEditingTitle(true); setTitleDraft(mod.title); }}
          >
            {mod.title}
          </span>
        )}

        {/* Pills */}
        <span className="hf-text-xs hf-text-muted">
          {mod.learningObjectives.length} LO{mod.learningObjectives.length !== 1 ? "s" : ""}
        </span>
        {mod.estimatedDurationMinutes && (
          <span className="hf-text-xs hf-text-muted">{mod.estimatedDurationMinutes}min</span>
        )}
        {isSaving && <span className="hf-text-xs hf-text-muted">Saving...</span>}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ marginTop: 12, paddingLeft: 32 }}>
          {/* Description */}
          <div className="hf-mb-md">
            <span className="hf-category-label">Description</span>
            {editingDesc ? (
              <textarea
                className="hf-input hf-text-sm"
                style={{ width: "100%", minHeight: 60, marginTop: 4 }}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={saveDesc}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setDescDraft(mod.description || ""); setEditingDesc(false); }
                }}
                autoFocus
              />
            ) : (
              <p
                className="hf-text-sm hf-text-muted"
                style={{ margin: "4px 0 0", cursor: "text", minHeight: 20 }}
                onClick={() => { setEditingDesc(true); setDescDraft(mod.description || ""); }}
              >
                {mod.description || "Click to add description..."}
              </p>
            )}
          </div>

          {/* Learning Objectives */}
          <div className="hf-mb-md">
            <span className="hf-category-label">Learning Objectives</span>
            <LOEditor
              objectives={mod.learningObjectives}
              onSave={saveLOs}
            />
          </div>

          {/* Key Terms */}
          {mod.keyTerms.length > 0 && (
            <div className="hf-mb-md">
              <span className="hf-category-label">Key Terms</span>
              <div className="hf-flex hf-flex-wrap hf-gap-xs" style={{ marginTop: 4 }}>
                {mod.keyTerms.map((t, i) => (
                  <span key={i} className="hf-micro-pill hf-text-muted" style={{ background: "var(--surface-secondary)" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="hf-flex hf-gap-sm" style={{ marginTop: 12 }}>
            <button onClick={onDelete} className="hf-btn hf-btn-destructive hf-text-xs">
              <Trash2 size={12} style={{ marginRight: 4 }} />
              Delete Module
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOEditor — inline learning objective editing
// ---------------------------------------------------------------------------

function LOEditor({
  objectives,
  onSave,
}: {
  objectives: LearningObjective[];
  onSave: (los: { ref: string; description: string }[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ ref: string; description: string }[]>([]);

  const startEditing = () => {
    setDraft(objectives.map((lo) => ({ ref: lo.ref, description: lo.description })));
    setEditing(true);
  };

  const save = () => {
    onSave(draft.filter((lo) => lo.description.trim()));
    setEditing(false);
  };

  if (!editing) {
    return (
      <div style={{ marginTop: 4 }}>
        {objectives.length === 0 ? (
          <p className="hf-text-xs hf-text-muted" style={{ margin: 0, cursor: "pointer" }} onClick={startEditing}>
            No learning objectives. Click to add.
          </p>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, cursor: "pointer" }} onClick={startEditing}>
            {objectives.map((lo) => (
              <li key={lo.id} className="hf-text-sm hf-text-primary" style={{ marginBottom: 2 }}>
                <span className="hf-text-xs hf-mono hf-text-muted" style={{ marginRight: 4 }}>{lo.ref}:</span>
                {lo.description}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {draft.map((lo, i) => (
        <div key={i} className="hf-flex hf-gap-xs hf-items-center hf-mb-xs">
          <input
            className="hf-input hf-text-xs hf-mono"
            style={{ width: 60, padding: "2px 4px" }}
            value={lo.ref}
            onChange={(e) => {
              const next = [...draft];
              next[i] = { ...next[i], ref: e.target.value };
              setDraft(next);
            }}
            placeholder="Ref"
          />
          <input
            className="hf-input hf-text-sm hf-flex-1"
            style={{ padding: "2px 6px" }}
            value={lo.description}
            onChange={(e) => {
              const next = [...draft];
              next[i] = { ...next[i], description: e.target.value };
              setDraft(next);
            }}
            placeholder="Description"
          />
          <button
            className="hf-btn-icon"
            onClick={() => setDraft(draft.filter((_, j) => j !== i))}
            style={{ padding: 2 }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="hf-flex hf-gap-sm" style={{ marginTop: 4 }}>
        <button
          className="hf-btn hf-btn-secondary hf-text-xs"
          onClick={() => setDraft([...draft, { ref: `LO${draft.length + 1}`, description: "" }])}
        >
          <Plus size={12} style={{ marginRight: 2 }} /> Add LO
        </button>
        <button className="hf-btn hf-btn-primary hf-text-xs" onClick={save}>Save</button>
        <button className="hf-btn hf-btn-secondary hf-text-xs" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddModuleForm
// ---------------------------------------------------------------------------

function AddModuleForm({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (title: string, description: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="hf-card-compact hf-mt-md" style={{ border: "2px dashed var(--border-default)" }}>
      <span className="hf-category-label hf-mb-sm">New Module</span>
      <input
        className="hf-input hf-text-sm hf-mb-sm"
        placeholder="Module title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className="hf-input hf-text-sm hf-mb-sm"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ minHeight: 40 }}
      />
      <div className="hf-flex hf-gap-sm">
        <button
          className="hf-btn hf-btn-primary hf-text-sm"
          onClick={() => onSave(title, description)}
          disabled={!title.trim() || saving}
        >
          {saving ? "Adding..." : "Add"}
        </button>
        <button className="hf-btn hf-btn-secondary hf-text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
