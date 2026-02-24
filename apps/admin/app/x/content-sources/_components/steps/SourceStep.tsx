"use client";

import { useState, useEffect, useRef } from "react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import {
  ContentSource,
  DOCUMENT_TYPES,
  TRUST_LEVELS,
  TrustBadge,
  DocumentTypeBadge,
} from "../shared/badges";

import type { StepProps } from "../types";
import "./source-step.css";

// ── Source Card ──────────────────────────────────────

function SourceCard({
  source,
  isSelected,
  onClick,
}: {
  source: ContentSource;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className={`src-card${isSelected ? " src-card--selected" : ""}`}
    >
      {/* Selected checkmark */}
      {isSelected && (
        <div className="src-card-check">
          {"\u2713"}
        </div>
      )}

      <div
        className={`src-card-name${isSelected ? " src-card-name--selected" : ""}`}
      >
        {source.name}
      </div>

      <div className="src-card-badges">
        <TrustBadge level={source.trustLevel} />
        {source.documentType && (
          <DocumentTypeBadge
            type={source.documentType}
            source={source.documentTypeSource}
          />
        )}
      </div>

      <div className="src-card-stats">
        <span>
          {source._count.assertions} teaching point
          {source._count.assertions !== 1 ? "s" : ""}
        </span>
        {source.publisherOrg && <span>{source.publisherOrg}</span>}
      </div>

      {source.qualificationRef && (
        <div className="src-card-qualification">
          {source.qualificationRef}
        </div>
      )}
    </div>
  );
}

// ── Upload New Source Section ────────────────────────

function UploadNewSourceSection({
  setData,
  getData,
  onNext,
  subjects,
  selectedSubjectId,
  setSelectedSubjectId,
  newSubjectName,
  setNewSubjectName,
  creatingSubject,
  handleCreateSubject,
}: {
  setData: StepProps["setData"];
  getData: StepProps["getData"];
  onNext: () => void;
  subjects: FancySelectOption[];
  selectedSubjectId: string;
  setSelectedSubjectId: (v: string) => void;
  newSubjectName: string;
  setNewSubjectName: (v: string) => void;
  creatingSubject: boolean;
  handleCreateSubject: () => void;
}) {
  const [intentText, setIntentText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [aiInterpretation, setAiInterpretation] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<Record<string, any> | null>(null);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [editForm, setEditForm] = useState({
    slug: "",
    name: "",
    description: "",
    trustLevel: "UNVERIFIED",
    documentType: "",
    publisherOrg: "",
    accreditingBody: "",
    qualificationRef: "",
    authors: "",
    isbn: "",
    edition: "",
    publicationYear: "",
  });

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState<{
    type: string;
    confidence: number;
  } | null>(null);
  const [classifyTaskId, setClassifyTaskId] = useState<string | null>(null);

  const existingSourceId = getData<string>("sourceId");
  const isExistingSource = getData<boolean>("existingSource");
  const [sourceCreated, setSourceCreated] = useState(
    !!existingSourceId && !isExistingSource
  );
  const [sourceId, setSourceId] = useState<string | null>(
    existingSourceId || null
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear stale hasFile flag after refresh (File objects can't survive sessionStorage)
  useEffect(() => {
    if (getData<boolean>("hasFile") && !file && !sourceCreated) {
      setData("hasFile", false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll classification task
  useEffect(() => {
    if (!classifyTaskId) return;
    const startedAt = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        clearInterval(interval);
        setError("Classification timed out. Please try again.");
        setClassifying(false);
        setClassifyTaskId(null);
        return;
      }
      try {
        const res = await fetch(`/api/tasks?taskId=${classifyTaskId}`);
        const data = await res.json();
        const task = data.task || data.tasks?.[0];
        if (task?.status === "completed") {
          clearInterval(interval);
          const ctx = (task.context as Record<string, any>) || {};
          if (ctx.error) {
            setError(ctx.error);
          } else if (ctx.classification) {
            setClassificationResult({
              type: ctx.classification.documentType,
              confidence: Math.round(ctx.classification.confidence * 100),
            });
          }
          setClassifyTaskId(null);
        } else if (task?.status === "failed" || task?.status === "abandoned") {
          clearInterval(interval);
          const ctx = (task.context as Record<string, any>) || {};
          setError(ctx.error || "Classification failed. Please try again.");
          setClassifyTaskId(null);
        }
      } catch {
        // Silent — poll continues
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [classifyTaskId]);

  async function handleSuggest() {
    if (!intentText.trim() || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setAiInterpretation(null);
    try {
      const res = await fetch("/api/content-sources/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: intentText.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setSuggestError(data.error || "Failed to generate suggestions");
        return;
      }
      const f = data.fields || {};
      const meta = {
        slug: f.slug || "",
        name: f.name || "",
        description: f.description || "",
        trustLevel: f.trustLevel || "UNVERIFIED",
        documentType: f.documentType || "",
        publisherOrg: f.publisherOrg || "",
        accreditingBody: f.accreditingBody || "",
        qualificationRef: f.qualificationRef || "",
        authors: Array.isArray(f.authors) ? f.authors.join(", ") : "",
        isbn: f.isbn || "",
        edition: f.edition || "",
        publicationYear: f.publicationYear ? String(f.publicationYear) : "",
      };
      setMetadata(meta);
      setEditForm(meta);
      if (data.interpretation) setAiInterpretation(data.interpretation);
    } catch (err: any) {
      setSuggestError(err.message || "Network error");
    } finally {
      setSuggesting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;
    const ext = droppedFile.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "txt", "md", "markdown", "json"].includes(ext || "")) {
      setError(`Unsupported file type: .${ext}`);
      return;
    }
    setFile(droppedFile);
    setError(null);
    const baseName = droppedFile.name.replace(/\.[^.]+$/, "");
    const slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const name = baseName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (!metadata) {
      const meta = { ...editForm, slug, name };
      setMetadata(meta);
      setEditForm(meta);
    }
  }

  async function handleCreateSource() {
    const form = editingMetadata ? editForm : metadata || editForm;
    if (!form.slug || !form.name) {
      setError("Slug and name are required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const createRes = await fetch("/api/content-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          documentType: form.documentType || undefined,
          authors: form.authors
            ? form.authors.split(",").map((a: string) => a.trim())
            : [],
          publicationYear: form.publicationYear
            ? parseInt(form.publicationYear)
            : null,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok)
        throw new Error(createData.error || "Failed to create source");

      const newSourceId = createData.source.id;
      setSourceId(newSourceId);
      setData("sourceId", newSourceId);
      setData("sourceName", form.name);
      setData("existingSource", false);
      setData("hasFile", !!file);

      if (file) {
        setClassifying(true);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("mode", "classify");
        try {
          const classifyRes = await fetch(
            `/api/content-sources/${newSourceId}/import`,
            { method: "POST", body: formData }
          );
          const classifyData = await classifyRes.json();
          if (!classifyRes.ok) {
            throw new Error(
              classifyData.error || "Failed to start classification"
            );
          }
          if (classifyData.taskId) {
            setClassifyTaskId(classifyData.taskId);
          }
          const sourceRes = await fetch(`/api/content-sources/${newSourceId}`);
          const sourceData = await sourceRes.json();
          if (sourceData.source?.mediaAssets?.[0]?.id) {
            setData("mediaAssetId", sourceData.source.mediaAssets[0].id);
          }
        } catch (uploadErr: any) {
          throw new Error(`File upload failed: ${uploadErr.message}`);
        } finally {
          setClassifying(false);
        }
      }

      if (selectedSubjectId) {
        await fetch(`/api/subjects/${selectedSubjectId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: newSourceId }),
        });
        setData("subjectId", selectedSubjectId);
        const subj = subjects.find((s) => s.value === selectedSubjectId);
        if (subj) setData("subjectName", subj.label);
      }

      setSourceCreated(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (sourceCreated) {
    return (
      <div className="hf-banner hf-banner-success src-created-banner">
        <div className="src-created-icon">{"\u2705"}</div>
        <div className="src-created-title">
          {getData<boolean>("hasFile")
            ? `File uploaded & material created: ${getData<string>("sourceName")}`
            : `Material created: ${getData<string>("sourceName")}`}
        </div>
        {classificationResult && (
          <div className="src-created-classification">
            Classified as{" "}
            {DOCUMENT_TYPES.find((d) => d.value === classificationResult.type)
              ?.label}{" "}
            ({classificationResult.confidence}%)
          </div>
        )}
        <button
          onClick={onNext}
          className="hf-btn hf-btn-primary src-created-btn"
        >
          {getData<boolean>("hasFile")
            ? "Continue to Extract"
            : "Continue to Review"}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Two entry paths side by side */}
      <div className="src-entry-grid">
        {/* Path A: Drop a file */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`src-dropzone${dragOver ? " src-dropzone--dragover" : file ? " src-dropzone--has-file" : ""}`}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".pdf,.txt,.md,.markdown,.json";
            input.onchange = (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) {
                setFile(f);
                const baseName = f.name.replace(/\.[^.]+$/, "");
                const slug = baseName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "");
                const name = baseName
                  .replace(/[-_]/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase());
                if (!metadata) {
                  const meta = { ...editForm, slug, name };
                  setMetadata(meta);
                  setEditForm(meta);
                }
              }
            };
            input.click();
          }}
        >
          <div className="src-dropzone-icon">
            {file ? "\u2705" : "\uD83D\uDCC4"}
          </div>
          <div className="src-dropzone-title">
            {file ? file.name : "Drop a file here"}
          </div>
          <div className="src-dropzone-hint">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : "PDF, TXT, MD, JSON"}
          </div>
        </div>

        {/* Path B: Describe it */}
        <div className="src-describe-col">
          <div className="src-describe-label">
            Or describe the material
          </div>
          <div className="src-describe-row">
            <input
              type="text"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && intentText.trim()) {
                  e.preventDefault();
                  handleSuggest();
                }
              }}
              placeholder='e.g. "CII R04 Insurance Syllabus 2025/26" or ISBN'
              disabled={suggesting}
              className="hf-input src-describe-input"
            />
            <button
              onClick={handleSuggest}
              disabled={!intentText.trim() || suggesting}
              className="hf-btn hf-btn-primary"
            >
              {suggesting ? "Thinking..." : "\u2728 Fill"}
            </button>
          </div>
          {suggestError && (
            <p className="src-suggest-error">
              {suggestError}
            </p>
          )}
          {aiInterpretation && (
            <div className="src-ai-interpretation">
              {"\u2728"} {aiInterpretation}
            </div>
          )}
        </div>
      </div>

      {/* Metadata card */}
      {metadata && (
        <div className="src-meta-card">
          <div className="src-meta-header">
            <span className="src-meta-title">
              Material Details
            </span>
            <button
              onClick={() => setEditingMetadata(!editingMetadata)}
              className="src-meta-edit-btn"
            >
              {editingMetadata ? "Collapse" : "Edit"}
            </button>
          </div>

          {!editingMetadata ? (
            <div className="src-meta-preview">
              <div>
                <span className="src-meta-label">Name:</span>{" "}
                <strong>{metadata.name}</strong>
              </div>
              <div>
                <span className="src-meta-label">Slug:</span>{" "}
                <code className="src-meta-slug">{metadata.slug}</code>
              </div>
              {metadata.documentType && (
                <div>
                  <DocumentTypeBadge type={metadata.documentType} />
                </div>
              )}
              {metadata.trustLevel && (
                <div>
                  <TrustBadge level={metadata.trustLevel} />
                </div>
              )}
              {metadata.publisherOrg && (
                <div>
                  <span className="src-meta-label">Publisher:</span>{" "}
                  {metadata.publisherOrg}
                </div>
              )}
              {metadata.qualificationRef && (
                <div>
                  <span className="src-meta-label">
                    Qualification:
                  </span>{" "}
                  {metadata.qualificationRef}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="src-edit-grid">
                {[
                  { key: "slug", label: "Slug *" },
                  { key: "name", label: "Name *" },
                  { key: "publisherOrg", label: "Publisher" },
                  { key: "qualificationRef", label: "Qualification Ref" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <div className="src-field-label">
                      {label}
                    </div>
                    <input
                      value={editForm[key as keyof typeof editForm] || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, [key]: e.target.value })
                      }
                      className="src-field-input"
                    />
                  </div>
                ))}
              </div>
              <div className="src-edit-grid--no-mb">
                <div>
                  <div className="src-field-label">
                    Document Type
                  </div>
                  <select
                    value={editForm.documentType}
                    onChange={(e) =>
                      setEditForm({ ...editForm, documentType: e.target.value })
                    }
                    className="src-field-input"
                  >
                    <option value="">Auto-detect</option>
                    {DOCUMENT_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.icon} {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="src-field-label">
                    Trust Level
                  </div>
                  <select
                    value={editForm.trustLevel}
                    onChange={(e) =>
                      setEditForm({ ...editForm, trustLevel: e.target.value })
                    }
                    className="src-field-input"
                  >
                    {TRUST_LEVELS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="src-field-label">
                    Authors
                  </div>
                  <input
                    value={editForm.authors}
                    onChange={(e) =>
                      setEditForm({ ...editForm, authors: e.target.value })
                    }
                    placeholder="Comma-separated"
                    className="src-field-input"
                  />
                </div>
                <div>
                  <div className="src-field-label">
                    ISBN
                  </div>
                  <input
                    value={editForm.isbn}
                    onChange={(e) =>
                      setEditForm({ ...editForm, isbn: e.target.value })
                    }
                    className="src-field-input"
                  />
                </div>
              </div>
            </div>
          )}

          {classificationResult && (
            <div className="src-classification">
              AI classified as{" "}
              <strong>
                {DOCUMENT_TYPES.find(
                  (d) => d.value === classificationResult.type
                )?.label || classificationResult.type}
              </strong>{" "}
              ({classificationResult.confidence}% confidence)
            </div>
          )}
        </div>
      )}

      {/* Subject selection */}
      <div className="src-subject-card">
        <div className="src-subject-title">
          Which subject does this belong to?
        </div>
        <div className="src-subject-row">
          <div className="src-subject-select">
            <FancySelect
              options={subjects}
              value={selectedSubjectId}
              onChange={setSelectedSubjectId}
              placeholder="Select a subject..."
            />
          </div>
          <div className="src-subject-or">
            or
          </div>
          <div className="src-subject-new-row">
            <input
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="New subject name"
              className="hf-input src-input-auto"
            />
            <button
              onClick={handleCreateSubject}
              disabled={!newSubjectName.trim() || creatingSubject}
              className="hf-btn hf-btn-primary"
            >
              {creatingSubject ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Create button */}
      <button
        onClick={handleCreateSource}
        disabled={creating || classifying || !metadata?.name}
        className="hf-btn hf-btn-primary src-btn-lg"
      >
        {creating
          ? "Creating material..."
          : classifying
            ? "Classifying document..."
            : file
              ? "Upload File & Create Material"
              : "Create Material & Continue"}
      </button>
    </>
  );
}

// ── Main SourceStep ─────────────────────────────────

export default function SourceStep({
  setData,
  getData,
  onNext,
  setStep,
}: StepProps) {
  // Library state
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [trustFilter, setTrustFilter] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    getData<string>("sourceId") || null
  );
  const [selectedSource, setSelectedSource] = useState<ContentSource | null>(
    null
  );
  const [showUploadNew, setShowUploadNew] = useState(false);

  // Subject selection (shared between library and upload modes)
  const [subjects, setSubjects] = useState<FancySelectOption[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState(
    getData<string>("subjectId") || ""
  );
  const [newSubjectName, setNewSubjectName] = useState("");
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjectPickerRef = useRef<HTMLDivElement>(null);

  // Fetch sources
  useEffect(() => {
    setLoadingSources(true);
    fetch("/api/content-sources")
      .then((r) => r.json())
      .then((data) => {
        const fetched = (data.sources || []) as ContentSource[];
        setSources(fetched);
        if (selectedSourceId) {
          const found = fetched.find((s) => s.id === selectedSourceId);
          if (found) setSelectedSource(found);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSources(false));
  }, []);

  // Fetch subjects
  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((data) => {
        if (data.subjects) {
          setSubjects(
            data.subjects.map((s: any) => ({
              value: s.id,
              label: s.name,
              subtitle: s.slug,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Client-side filtering
  const filteredSources = sources.filter((s) => {
    if (trustFilter && s.trustLevel !== trustFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.qualificationRef || "").toLowerCase().includes(q) ||
      (s.publisherOrg || "").toLowerCase().includes(q)
    );
  });

  function handleSelectCard(source: ContentSource) {
    if (selectedSourceId === source.id) {
      setSelectedSourceId(null);
      setSelectedSource(null);
    } else {
      setSelectedSourceId(source.id);
      setSelectedSource(source);
      // Auto-select subject if source is linked to exactly one
      if (source.subjects?.length === 1 && !selectedSubjectId) {
        setSelectedSubjectId(source.subjects[0].subject.id);
      }
      // Scroll to subject picker after React re-render
      setTimeout(() => {
        subjectPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }

  function handleContinueWithExisting() {
    if (!selectedSource || !selectedSubjectId) return;
    setData("sourceId", selectedSource.id);
    setData("sourceName", selectedSource.name);
    setData("existingSource", true);
    setData("hasFile", false);
    setData("subjectId", selectedSubjectId);
    const subj = subjects.find((s) => s.value === selectedSubjectId);
    if (subj) setData("subjectName", subj.label);
    // Jump to PlanStep (index 3), skipping Extract + Review
    if (setStep) {
      setStep(3);
    }
  }

  async function handleCreateSubject() {
    if (!newSubjectName.trim()) return;
    setCreatingSubject(true);
    try {
      const slug = newSubjectName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSubjectName.trim(), slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const newOpt = {
        value: data.subject.id,
        label: data.subject.name,
        subtitle: data.subject.slug,
      };
      setSubjects((prev) => [...prev, newOpt]);
      setSelectedSubjectId(data.subject.id);
      setNewSubjectName("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingSubject(false);
    }
  }

  return (
    <div>
      <h2 className="src-heading">
        What do you want to teach from?
      </h2>
      <p className="src-subtitle">
        Select an existing material or upload a new one.
      </p>

      {/* ── Section A: Library Grid (primary) ── */}
      {!showUploadNew && (
        <>
          {/* Search + filter row */}
          <div className="src-filter-row">
            <input
              type="text"
              placeholder="Search materials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="hf-input src-search-input"
            />
            {TRUST_LEVELS.map((t) => (
              <button
                key={t.value}
                onClick={() =>
                  setTrustFilter(trustFilter === t.value ? "" : t.value)
                }
                className="src-trust-filter"
                style={
                  trustFilter === t.value
                    ? { borderColor: t.color, background: t.bg, color: t.color }
                    : undefined
                }
              >
                {t.label.replace(/^L\d\s/, "")}
              </button>
            ))}
          </div>

          {/* Source count */}
          <div className="src-count">
            {filteredSources.length} material
            {filteredSources.length !== 1 ? "s" : ""} available
          </div>

          {/* Card grid */}
          {loadingSources ? (
            <div className="src-loading-center"><div className="hf-spinner" /></div>
          ) : filteredSources.length === 0 ? (
            <div className="src-empty">
              {sources.length === 0
                ? "No materials yet. Upload one below to get started."
                : "No materials match your search."}
            </div>
          ) : (
            <div className="src-card-grid">
              {filteredSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  isSelected={selectedSourceId === source.id}
                  onClick={() => handleSelectCard(source)}
                />
              ))}
            </div>
          )}

          {/* Subject selection — visible when a source is selected */}
          {selectedSource && (
            <div
              ref={subjectPickerRef}
              className="src-selected-picker"
            >
              <div className="src-picker-title">
                Attach to a subject
              </div>
              <p className="src-picker-desc">
                Which subject will use &ldquo;{selectedSource.name}&rdquo;?
              </p>
              <div className="src-picker-row">
                <div className="src-subject-select">
                  <FancySelect
                    options={subjects}
                    value={selectedSubjectId}
                    onChange={setSelectedSubjectId}
                    placeholder="Select a subject..."
                  />
                </div>
                <div className="src-subject-or">
                  or
                </div>
                <div className="src-subject-new-row">
                  <input
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    placeholder="New subject name"
                    className="hf-input src-input-auto"
                  />
                  <button
                    onClick={handleCreateSubject}
                    disabled={!newSubjectName.trim() || creatingSubject}
                    className="hf-btn hf-btn-primary"
                  >
                    {creatingSubject ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>

              <ErrorBanner error={error} />

              <button
                onClick={handleContinueWithExisting}
                disabled={!selectedSubjectId}
                className="hf-btn hf-btn-primary src-btn-lg"
              >
                Continue to Plan Sessions
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Divider toggle ── */}
      <div className="src-divider-wrap">
        <div className="src-divider-line" />
        <button
          onClick={() => setShowUploadNew(!showUploadNew)}
          className="src-divider-btn"
        >
          {showUploadNew ? "Back to library" : "Or upload a new material"}
        </button>
        <div className="src-divider-line" />
      </div>

      {/* ── Section B: Upload New (secondary) ── */}
      {showUploadNew && (
        <div className="src-upload-section">
          <UploadNewSourceSection
            setData={setData}
            getData={getData}
            onNext={onNext}
            subjects={subjects}
            selectedSubjectId={selectedSubjectId}
            setSelectedSubjectId={setSelectedSubjectId}
            newSubjectName={newSubjectName}
            setNewSubjectName={setNewSubjectName}
            creatingSubject={creatingSubject}
            handleCreateSubject={handleCreateSubject}
          />
        </div>
      )}
    </div>
  );
}
