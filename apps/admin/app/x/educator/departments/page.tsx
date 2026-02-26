"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Building, Plus, Pencil, Trash2, GripVertical, Sparkles, LayoutTemplate, X, Check, ChevronLeft } from "lucide-react";
import { useTerminology } from "@/contexts/TerminologyContext";
import "./departments.css";

// ── Types ──────────────────────────────────────────────

interface PlaybookGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  groupType: string;
  identityOverride: any;
  sortOrder: number;
  isActive: boolean;
  playbookCount: number;
  cohortCount: number;
}

interface TemplateGroup {
  name: string;
  groupType: string;
  styleNotes: string | null;
}

interface Template {
  id: string;
  label: string;
  description: string;
  forTypes: string[];
  isDefault: boolean;
  groupCount: number;
  groups: TemplateGroup[];
}

interface GeneratedGroup {
  name: string;
  groupType: string;
  styleNotes?: string;
}

interface ClarifyingQuestion {
  id: string;
  text: string;
  type: "choice" | "multiselect" | "text";
  options?: string[];
}

type SetupPhase = "suggest" | "template" | "describe" | "questions" | "review" | "done";

// ── Main Page ──────────────────────────────────────────

export default function DepartmentsPage() {
  const { terms, plural } = useTerminology();
  const searchParams = useSearchParams();
  const domainIdParam = searchParams.get("domainId");

  const [domainId, setDomainId] = useState<string | null>(domainIdParam);
  const [institutionTypeSlug, setInstitutionTypeSlug] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(!domainIdParam);
  const [groups, setGroups] = useState<PlaybookGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup state
  const [setupPhase, setSetupPhase] = useState<SetupPhase | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [defaultTemplate, setDefaultTemplate] = useState<Template | null>(null);
  const [reviewGroups, setReviewGroups] = useState<GeneratedGroup[]>([]);

  // AI describe state
  const [description, setDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Create/edit modal
  const [editingGroup, setEditingGroup] = useState<PlaybookGroup | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Bulk create loading
  const [creating, setCreating] = useState(false);

  const groupTerm = terms.group || "Department";
  const groupTermPlural = plural("group");

  // ── Resolve domainId from educator classrooms if not provided ──

  useEffect(() => {
    if (domainId) {
      setAuthLoading(false);
      return;
    }
    // Fetch classrooms to find the educator's domain
    (async () => {
      try {
        const res = await fetch("/api/educator/classrooms");
        const data = await res.json();
        if (data.ok && data.classrooms?.length > 0) {
          const firstDomain = data.classrooms[0].domain;
          setDomainId(firstDomain.id);
          // Try to get institution type slug
          const instRes = await fetch(`/api/domains/${firstDomain.id}`);
          const instData = await instRes.json();
          if (instData.ok && instData.domain?.institution?.type?.slug) {
            setInstitutionTypeSlug(instData.domain.institution.type.slug);
          }
        }
      } catch {
        // Fallback: no domain found
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [domainId]);

  // ── Load groups ──────────────────────────────────

  const loadGroups = useCallback(async () => {
    if (!domainId) return;
    try {
      const res = await fetch(`/api/playbook-groups?domainId=${domainId}`);
      const data = await res.json();
      if (data.ok) {
        setGroups(data.groups);
        // First run detection
        if (data.groups.length === 0) {
          setSetupPhase("suggest");
          loadTemplates();
        } else {
          setSetupPhase("done");
        }
      }
    } catch {
      setError("Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  const loadTemplates = useCallback(async () => {
    const url = institutionTypeSlug
      ? `/api/playbook-groups/templates?typeSlug=${institutionTypeSlug}`
      : `/api/playbook-groups/templates`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) {
        setTemplates(data.templates);
        const def = data.templates.find((t: Template) => t.id === data.defaultId) || null;
        setDefaultTemplate(def);
      }
    } catch {
      // Non-critical — templates just won't show
    }
  }, [institutionTypeSlug]);

  useEffect(() => {
    if (!authLoading && domainId) {
      loadGroups();
    }
  }, [authLoading, domainId, loadGroups]);

  // ── Bulk create ──────────────────────────────────

  const bulkCreate = useCallback(async (groupsToCreate: GeneratedGroup[]) => {
    if (!domainId || groupsToCreate.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/playbook-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainId,
          bulk: groupsToCreate.map((g, i) => ({
            name: g.name,
            groupType: g.groupType,
            identityOverride: g.styleNotes
              ? { styleNotes: g.styleNotes }
              : undefined,
            sortOrder: i,
          })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSetupPhase("done");
        await loadGroups();
      } else {
        setError(data.error || "Failed to create groups");
      }
    } catch {
      setError("Failed to create groups");
    } finally {
      setCreating(false);
    }
  }, [domainId, loadGroups]);

  // ── AI generate ──────────────────────────────────

  const generateFromDescription = useCallback(async (followUps?: Record<string, string>) => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/playbook-groups/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainId,
          description,
          institutionType: institutionTypeSlug,
          followUpAnswers: followUps,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.questions.length > 0 && data.confidence < 0.8 && !followUps) {
          setQuestions(data.questions);
          setReviewGroups(data.groups);
          setSetupPhase("questions");
        } else if (data.confidence >= 0.9 && data.groups.length > 0) {
          // High confidence — offer instant create
          setReviewGroups(data.groups);
          setSetupPhase("review");
        } else {
          setReviewGroups(data.groups);
          setSetupPhase("review");
        }
      } else {
        setError(data.error || "AI generation failed. Try a template instead.");
      }
    } catch {
      setError("AI generation failed. Try a template instead.");
    } finally {
      setAiLoading(false);
    }
  }, [domainId, description, institutionTypeSlug]);

  // ── Delete group ─────────────────────────────────

  const deleteGroup = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/playbook-groups/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setGroups((prev) => prev.filter((g) => g.id !== id));
      }
    } catch {
      setError("Failed to delete group");
    }
  }, []);

  // ── Create single ────────────────────────────────

  const createSingle = useCallback(async (name: string, groupType: string) => {
    if (!domainId) return;
    try {
      const res = await fetch("/api/playbook-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId, name, groupType }),
      });
      const data = await res.json();
      if (data.ok) {
        await loadGroups();
        setShowCreateModal(false);
      } else {
        setError(data.error);
      }
    } catch {
      setError("Failed to create group");
    }
  }, [domainId, loadGroups]);

  // ── Group by type for display ────────────────────

  const groupedByType = useMemo(() => {
    const map: Record<string, PlaybookGroup[]> = {};
    for (const g of groups) {
      const key = g.groupType;
      if (!map[key]) map[key] = [];
      map[key].push(g);
    }
    return map;
  }, [groups]);

  // ── Render ───────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="hf-page-container">
        <h1 className="hf-page-title">{groupTermPlural}</h1>
        <div className="hf-empty">Loading...</div>
      </div>
    );
  }

  if (!domainId) {
    return (
      <div className="hf-page-container">
        <h1 className="hf-page-title">{groupTermPlural}</h1>
        <div className="hf-empty">No institution linked to your account.</div>
      </div>
    );
  }

  // ─── Setup Flow ──────────────────────────────────

  if (setupPhase && setupPhase !== "done") {
    return (
      <div className="hf-page-container">
        {/* Suggest phase — auto-suggest default template */}
        {setupPhase === "suggest" && (
          <SuggestPhase
            groupTerm={groupTermPlural}
            defaultTemplate={defaultTemplate}
            onAccept={() => {
              if (defaultTemplate) {
                bulkCreate(defaultTemplate.groups);
              }
            }}
            onCustomize={() => {
              if (defaultTemplate) {
                setReviewGroups(defaultTemplate.groups);
                setSetupPhase("review");
              }
            }}
            onChooseTemplate={() => {
              if (templates.length === 0) loadTemplates();
              setSetupPhase("template");
            }}
            onDescribe={() => setSetupPhase("describe")}
            onSkip={() => setSetupPhase("done")}
            creating={creating}
          />
        )}

        {/* Template picker */}
        {setupPhase === "template" && (
          <TemplatePhase
            groupTerm={groupTermPlural}
            templates={templates}
            onSelect={(tmpl) => {
              setReviewGroups(tmpl.groups);
              setSetupPhase("review");
            }}
            onBack={() => setSetupPhase("suggest")}
          />
        )}

        {/* AI describe */}
        {setupPhase === "describe" && (
          <DescribePhase
            groupTerm={groupTermPlural}
            description={description}
            onChangeDescription={setDescription}
            onGenerate={() => generateFromDescription()}
            loading={aiLoading}
            onBack={() => setSetupPhase("suggest")}
          />
        )}

        {/* Follow-up questions */}
        {setupPhase === "questions" && (
          <QuestionsPhase
            groupTerm={groupTermPlural}
            questions={questions}
            answers={answers}
            onChangeAnswer={(id, val) => setAnswers((prev) => ({ ...prev, [id]: val }))}
            onSubmit={() => generateFromDescription(answers)}
            loading={aiLoading}
            onBack={() => setSetupPhase("describe")}
          />
        )}

        {/* Review & customize */}
        {setupPhase === "review" && (
          <ReviewPhase
            groupTerm={groupTermPlural}
            groups={reviewGroups}
            onUpdateGroups={setReviewGroups}
            onCreate={() => bulkCreate(reviewGroups)}
            onBack={() => setSetupPhase("suggest")}
            creating={creating}
          />
        )}

        {error && (
          <div className="hf-banner hf-banner-error dept-banner-mt">
            {error}
            <button onClick={() => setError(null)} className="hf-btn dept-dismiss-btn">
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Management View ─────────────────────────────

  return (
    <div className="hf-page-container">
      <div className="dept-header-row">
        <h1 className="hf-page-title dept-title-flush">{groupTermPlural}</h1>
        <button
          className="hf-btn hf-btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus size={16} />
          New {groupTerm}
        </button>
      </div>

      {error && (
        <div className="hf-banner hf-banner-error dept-banner-mb">
          {error}
          <button onClick={() => setError(null)} className="hf-btn dept-dismiss-btn">
            Dismiss
          </button>
        </div>
      )}

      {Object.entries(groupedByType).map(([type, typeGroups]) => (
        <div key={type} className="dept-section-gap">
          <h2 className="hf-section-title">{formatGroupType(type)}s</h2>
          <div className="hf-card-grid-lg">
            {typeGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                groupTerm={groupTerm}
                onEdit={() => setEditingGroup(group)}
                onDelete={() => {
                  if (confirm(`Archive "${group.name}"? Courses and classes will be ungrouped.`)) {
                    deleteGroup(group.id);
                  }
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div className="hf-empty">
          <Building size={48} className="dept-empty-icon" />
          <p>No {groupTermPlural.toLowerCase()} yet</p>
          <button
            className="hf-btn hf-btn-primary"
            onClick={() => {
              setSetupPhase("suggest");
              loadTemplates();
            }}
          >
            Set up {groupTermPlural.toLowerCase()}
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateGroupModal
          groupTerm={groupTerm}
          onClose={() => setShowCreateModal(false)}
          onCreate={createSingle}
        />
      )}

      {/* Edit Modal */}
      {editingGroup && (
        <EditGroupModal
          group={editingGroup}
          groupTerm={groupTerm}
          onClose={() => setEditingGroup(null)}
          onSave={async (updates) => {
            const res = await fetch(`/api/playbook-groups/${editingGroup.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updates),
            });
            const data = await res.json();
            if (data.ok) {
              setEditingGroup(null);
              await loadGroups();
            }
          }}
        />
      )}
    </div>
  );
}

// ── Setup Phase Components ─────────────────────────────

function SuggestPhase({
  groupTerm,
  defaultTemplate,
  onAccept,
  onCustomize,
  onChooseTemplate,
  onDescribe,
  onSkip,
  creating,
}: {
  groupTerm: string;
  defaultTemplate: Template | null;
  onAccept: () => void;
  onCustomize: () => void;
  onChooseTemplate: () => void;
  onDescribe: () => void;
  onSkip: () => void;
  creating: boolean;
}) {
  return (
    <>
      <h1 className="hf-page-title">{groupTerm}</h1>

      {defaultTemplate ? (
        <>
          <p className="hf-page-subtitle">Suggested for your institution:</p>
          <div className="hf-card dept-suggest-card">
            <h3 className="hf-section-title">{defaultTemplate.label}</h3>
            <p className="hf-section-desc dept-suggest-desc">
              {defaultTemplate.groupCount} groups
            </p>
            <div className="dept-tag-row">
              {defaultTemplate.groups.map((g) => (
                <span
                  key={g.name}
                  className="hf-category-label"
                >
                  {g.name}
                </span>
              ))}
            </div>
            <p className="hf-section-desc">
              Each {groupTerm.toLowerCase()} includes suggested teaching tone.
            </p>
            <div className="dept-action-row">
              <button
                className="hf-btn hf-btn-primary"
                onClick={onAccept}
                disabled={creating}
              >
                {creating ? "Creating..." : "Set up now"}
              </button>
              <button className="hf-btn hf-btn-secondary" onClick={onCustomize}>
                Customize first
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="hf-page-subtitle">
          Set up your {groupTerm.toLowerCase()}s to organize courses and classes.
        </p>
      )}

      <div className="dept-btn-row">
        <button className="hf-btn hf-btn-secondary" onClick={onChooseTemplate}>
          <LayoutTemplate size={16} />
          {defaultTemplate ? "Choose a different template" : "Start from template"}
        </button>
        <button className="hf-btn hf-btn-secondary" onClick={onDescribe}>
          <Sparkles size={16} />
          Describe your structure (AI)
        </button>
        <button
          className="hf-btn dept-skip-btn"
          onClick={onSkip}
        >
          Skip — add manually later
        </button>
      </div>
    </>
  );
}

function TemplatePhase({
  groupTerm,
  templates,
  onSelect,
  onBack,
}: {
  groupTerm: string;
  templates: Template[];
  onSelect: (tmpl: Template) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="dept-back-header">
        <button className="hf-btn" onClick={onBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <h1 className="hf-page-title dept-title-flush">Choose a Template</h1>
      </div>

      <div className="dept-tmpl-list">
        {templates.map((tmpl) => (
          <div key={tmpl.id} className="hf-card hf-card-compact dept-tmpl-card" onClick={() => onSelect(tmpl)}>
            <div className="dept-tmpl-inner">
              <div>
                <h3 className="hf-section-title dept-title-flush">{tmpl.label}</h3>
                <p className="hf-section-desc dept-desc-gap">
                  {tmpl.description}
                </p>
              </div>
              <button className="hf-btn hf-btn-primary">Use</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DescribePhase({
  groupTerm,
  description,
  onChangeDescription,
  onGenerate,
  loading,
  onBack,
}: {
  groupTerm: string;
  description: string;
  onChangeDescription: (v: string) => void;
  onGenerate: () => void;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <>
      <div className="dept-back-header">
        <button className="hf-btn" onClick={onBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <h1 className="hf-page-title dept-title-flush">Describe Your Structure</h1>
      </div>

      <div className="hf-card">
        <label className="hf-label">How is your institution organized?</label>
        <textarea
          className="hf-input"
          rows={4}
          placeholder={`E.g. "We're a UK secondary with Years 7-11 plus Sixth Form. Main departments: Science, Maths, English, History, Geography, MFL, Computing, PE."`}
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
        />
        <p className="hf-section-desc dept-desc-hint">
          Mention departments, year groups, divisions — anything that helps organize your courses and classes.
        </p>
        <div className="dept-gen-row">
          <button
            className="hf-btn hf-btn-primary"
            onClick={onGenerate}
            disabled={loading || description.trim().length < 10}
          >
            {loading ? "Generating..." : "Generate Structure"}
          </button>
        </div>
      </div>
    </>
  );
}

function QuestionsPhase({
  groupTerm,
  questions,
  answers,
  onChangeAnswer,
  onSubmit,
  loading,
  onBack,
}: {
  groupTerm: string;
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  onChangeAnswer: (id: string, val: string) => void;
  onSubmit: () => void;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <>
      <div className="dept-back-header">
        <button className="hf-btn" onClick={onBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <h1 className="hf-page-title dept-title-flush">A couple of questions</h1>
      </div>

      <div className="hf-card">
        {questions.map((q, i) => (
          <div key={q.id} className={i < questions.length - 1 ? "dept-q-spacer" : ""}>
            <label className="hf-label">{q.text}</label>
            {q.type === "choice" && q.options ? (
              <div className="dept-radio-group">
                {q.options.map((opt) => (
                  <label key={opt} className="dept-radio-label">
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === opt}
                      onChange={() => onChangeAnswer(q.id, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : (
              <input
                className="hf-input dept-q-input"
                type="text"
                value={answers[q.id] || ""}
                onChange={(e) => onChangeAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
        <div className="dept-gen-row">
          <button
            className="hf-btn hf-btn-primary"
            onClick={onSubmit}
            disabled={loading}
          >
            {loading ? "Refining..." : "Refine Structure"}
          </button>
        </div>
      </div>
    </>
  );
}

function ReviewPhase({
  groupTerm,
  groups,
  onUpdateGroups,
  onCreate,
  onBack,
  creating,
}: {
  groupTerm: string;
  groups: GeneratedGroup[];
  onUpdateGroups: (groups: GeneratedGroup[]) => void;
  onCreate: () => void;
  onBack: () => void;
  creating: boolean;
}) {
  const grouped = useMemo(() => {
    const map: Record<string, GeneratedGroup[]> = {};
    for (const g of groups) {
      const key = g.groupType;
      if (!map[key]) map[key] = [];
      map[key].push(g);
    }
    return map;
  }, [groups]);

  const removeGroup = (name: string) => {
    onUpdateGroups(groups.filter((g) => g.name !== name));
  };

  const [addingName, setAddingName] = useState("");

  return (
    <>
      <div className="dept-review-header">
        <div className="dept-review-header-inner">
          <button className="hf-btn" onClick={onBack}>
            <ChevronLeft size={16} />
            Back
          </button>
          <h1 className="hf-page-title dept-title-flush">Review & Customize</h1>
        </div>
      </div>

      {Object.entries(grouped).map(([type, typeGroups]) => (
        <div key={type} className="dept-section-gap-sm">
          <h3 className="hf-section-title">
            {formatGroupType(type)}s ({typeGroups.length})
          </h3>
          <div className="dept-group-list">
            {typeGroups.map((g) => (
              <div
                key={g.name}
                className="hf-list-row dept-list-item"
              >
                <GripVertical size={16} className="dept-grip-icon" />
                <div className="dept-item-body">
                  <span className="dept-item-name">{g.name}</span>
                  {g.styleNotes && (
                    <span className="dept-item-notes">
                      {g.styleNotes}
                    </span>
                  )}
                </div>
                <button
                  className="hf-btn"
                  onClick={() => removeGroup(g.name)}
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add group inline */}
      <div className="dept-add-row">
        <input
          className="hf-input dept-add-input"
          placeholder={`Add a ${groupTerm.toLowerCase()}...`}
          value={addingName}
          onChange={(e) => setAddingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && addingName.trim()) {
              onUpdateGroups([...groups, { name: addingName.trim(), groupType: "DEPARTMENT" }]);
              setAddingName("");
            }
          }}
        />
        <button
          className="hf-btn hf-btn-secondary"
          disabled={!addingName.trim()}
          onClick={() => {
            if (addingName.trim()) {
              onUpdateGroups([...groups, { name: addingName.trim(), groupType: "DEPARTMENT" }]);
              setAddingName("");
            }
          }}
        >
          <Plus size={16} />
          Add
        </button>
      </div>

      <div className="dept-footer-row">
        <button className="hf-btn" onClick={onBack}>Back</button>
        <button
          className="hf-btn hf-btn-primary"
          onClick={onCreate}
          disabled={creating || groups.length === 0}
        >
          {creating ? "Creating..." : `Create ${groups.length} Groups`}
        </button>
      </div>
    </>
  );
}

// ── Management Components ──────────────────────────────

function GroupCard({
  group,
  groupTerm,
  onEdit,
  onDelete,
}: {
  group: PlaybookGroup;
  groupTerm: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const override = group.identityOverride as { styleNotes?: string } | null;

  return (
    <div className="hf-card hf-card-compact">
      <div className="dept-card-header">
        <div>
          <h3 className="hf-section-title dept-title-flush">{group.name}</h3>
          <p className="hf-section-desc dept-desc-gap">
            {group.playbookCount} course{group.playbookCount !== 1 ? "s" : ""} · {group.cohortCount} class{group.cohortCount !== 1 ? "es" : ""}
          </p>
          {override?.styleNotes && (
            <p className="dept-card-notes">
              {override.styleNotes}
            </p>
          )}
        </div>
        <span className="hf-category-label">{formatGroupType(group.groupType)}</span>
      </div>
      <div className="dept-card-actions">
        <button className="hf-btn" onClick={onEdit}>
          <Pencil size={14} />
          Edit
        </button>
        <button className="hf-btn" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function CreateGroupModal({
  groupTerm,
  onClose,
  onCreate,
}: {
  groupTerm: string;
  onClose: () => void;
  onCreate: (name: string, groupType: string) => void;
}) {
  const [name, setName] = useState("");
  const [groupType, setGroupType] = useState("DEPARTMENT");

  return (
    <div className="hf-modal-overlay" onClick={onClose}>
      <div className="hf-card dept-modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="hf-section-title">New {groupTerm}</h2>
        <div className="dept-field-group">
          <label className="hf-label">Name</label>
          <input
            className="hf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`E.g. "Science Department"`}
            autoFocus
          />
        </div>
        <div className="dept-field-group">
          <label className="hf-label">Type</label>
          <div className="dept-type-btns">
            {["DEPARTMENT", "YEAR_GROUP", "DIVISION", "TRACK", "CUSTOM"].map((t) => (
              <button
                key={t}
                className={`hf-btn ${groupType === t ? "hf-btn-primary" : "hf-btn-secondary"}`}
                onClick={() => setGroupType(t)}
              >
                {formatGroupType(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="dept-modal-footer">
          <button className="hf-btn" onClick={onClose}>Cancel</button>
          <button
            className="hf-btn hf-btn-primary"
            onClick={() => name.trim() && onCreate(name.trim(), groupType)}
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function EditGroupModal({
  group,
  groupTerm,
  onClose,
  onSave,
}: {
  group: PlaybookGroup;
  groupTerm: string;
  onClose: () => void;
  onSave: (updates: Record<string, any>) => void;
}) {
  const override = (group.identityOverride || {}) as Record<string, any>;
  const [name, setName] = useState(group.name);
  const [styleNotes, setStyleNotes] = useState(override.styleNotes || "");
  const [sliders, setSliders] = useState<Record<string, number>>({
    formality: override.toneSliders?.formality ?? 0.5,
    warmth: override.toneSliders?.warmth ?? 0.5,
    pace: override.toneSliders?.pace ?? 0.5,
    encourage: override.toneSliders?.encourage ?? 0.5,
    precision: override.toneSliders?.precision ?? 0.5,
  });

  const handleSave = () => {
    const hasNonNeutral = Object.values(sliders).some((v) => v !== 0.5);
    onSave({
      name,
      identityOverride: {
        styleNotes: styleNotes || undefined,
        toneSliders: hasNonNeutral ? sliders : undefined,
      },
    });
  };

  return (
    <div className="hf-modal-overlay" onClick={onClose}>
      <div className="hf-card dept-modal-card-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="hf-section-title">Edit {groupTerm}</h2>

        <div className="dept-field-group">
          <label className="hf-label">Name</label>
          <input className="hf-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="dept-field-group">
          <label className="hf-label">Teaching Tone (optional)</label>
          {Object.entries(sliders).map(([key, value]) => (
            <div key={key} className="dept-slider-row">
              <span className="dept-slider-label">
                {key}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={value}
                onChange={(e) =>
                  setSliders((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                }
                className="dept-slider-input"
              />
              <span className="dept-slider-value">
                {value.toFixed(1)}
              </span>
            </div>
          ))}
        </div>

        <div className="dept-field-group">
          <label className="hf-label">Style Notes</label>
          <textarea
            className="hf-input"
            rows={2}
            value={styleNotes}
            onChange={(e) => setStyleNotes(e.target.value)}
            placeholder="E.g. Use precise scientific terminology, encourage hypothesis formation."
          />
        </div>

        <div className="dept-modal-footer">
          <button className="hf-btn" onClick={onClose}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSave}>
            <Check size={16} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────

function formatGroupType(type: string): string {
  const map: Record<string, string> = {
    DEPARTMENT: "Department",
    YEAR_GROUP: "Year Group",
    DIVISION: "Division",
    TRACK: "Track",
    CUSTOM: "Group",
  };
  return map[type] || type;
}
