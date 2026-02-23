"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import { useViewMode } from "@/contexts/ViewModeContext";
import { AdvancedSection } from "@/components/shared/AdvancedSection";
import { SortableList } from "@/components/shared/SortableList";
import { reorderItems } from "@/lib/sortable/reorder";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { ProgressStepper } from "@/components/shared/ProgressStepper";
import { EditableTitle } from "@/components/shared/EditableTitle";
import {
  TrustBadge,
  DocumentTypeBadge as SharedDocumentTypeBadge,
  TRUST_LEVELS,
  DOCUMENT_TYPES as SHARED_DOCUMENT_TYPES,
} from "@/app/x/content-sources/_components/shared/badges";

// ------------------------------------------------------------------
// Extended document types (add color + desc for subject detail use)
// ------------------------------------------------------------------

const DOCUMENT_TYPES = [
  { value: "CURRICULUM", label: "Curriculum", color: "var(--badge-indigo-text)", desc: "Formal syllabus with LOs/ACs" },
  { value: "TEXTBOOK", label: "Textbook", color: "var(--status-success-text)", desc: "Dense reference material" },
  { value: "WORKSHEET", label: "Worksheet", color: "var(--badge-yellow-text)", desc: "Learner activity sheet" },
  { value: "EXAMPLE", label: "Example", color: "var(--badge-purple-text)", desc: "Illustrative document" },
  { value: "ASSESSMENT", label: "Assessment", color: "var(--status-error-text)", desc: "Test/quiz material" },
  { value: "REFERENCE", label: "Reference", color: "var(--text-muted)", desc: "Quick reference/glossary" },
] as const;

const SOURCE_TAGS = [
  { value: "syllabus", label: "Syllabus", color: "var(--accent-primary)", desc: "Defines the curriculum structure / schedule" },
  { value: "content", label: "Content", color: "var(--status-success-text)", desc: "Teaching material the AI delivers from" },
];

const SESSION_TYPES = [
  { value: "onboarding", label: "Onboarding", color: "var(--accent-primary)" },
  { value: "introduce", label: "Introduce", color: "var(--status-success-text)" },
  { value: "deepen", label: "Deepen", color: "var(--accent-primary)" },
  { value: "review", label: "Review", color: "var(--badge-yellow-text)" },
  { value: "assess", label: "Assess", color: "var(--status-error-text)" },
  { value: "consolidate", label: "Consolidate", color: "var(--badge-purple-text)" },
] as const;

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type MediaAsset = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  title: string | null;
  tags: string[];
  trustLevel: string;
  createdAt: string;
};

type SubjectSource = {
  id: string;
  sourceId: string;
  tags: string[];
  trustLevelOverride: string | null;
  sortOrder: number;
  source: {
    id: string;
    slug: string;
    name: string;
    trustLevel: string;
    documentType: string;
    documentTypeSource: string | null;
    _count: { assertions: number };
  };
};

type SubjectDomain = {
  id: string;
  domain: { id: string; slug: string; name: string; isActive?: boolean };
};

type Subject = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  qualificationBody: string | null;
  qualificationRef: string | null;
  qualificationLevel: string | null;
  isActive: boolean;
  sources: SubjectSource[];
  domains: SubjectDomain[];
  curricula: any[];
};

type CurriculumModule = {
  id: string;
  title: string;
  description: string;
  learningOutcomes: string[];
  assessmentCriteria?: string[];
  keyTerms?: string[];
  estimatedDurationMinutes?: number;
  sortOrder: number;
};

// ------------------------------------------------------------------
// Small badge components
// ------------------------------------------------------------------

function TagPills({ tags }: { tags: string[] }) {
  return (
    <span className="hf-flex" style={{ gap: 3 }}>
      {tags.map((tag) => {
        const cfg = SOURCE_TAGS.find((t) => t.value === tag);
        const c = cfg?.color || "var(--text-muted)";
        return (
          <span key={tag} style={{ display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, color: c, backgroundColor: `color-mix(in srgb, ${c} 15%, transparent)`, textTransform: "uppercase" }}>
            {cfg?.label || tag}
          </span>
        );
      })}
      {tags.length === 0 && (
        <span className="hf-text-xs hf-text-muted hf-text-italic">no tags</span>
      )}
    </span>
  );
}

function SessionTypeBadge({ type }: { type: string }) {
  const cfg = SESSION_TYPES.find((t) => t.value === type);
  const color = cfg?.color || "var(--text-muted)";
  return (
    <span style={{
      display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 10,
      fontWeight: 600, color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      textTransform: "uppercase", minWidth: 70, textAlign: "center",
    }}>
      {cfg?.label || type}
    </span>
  );
}

function DetailDocumentTypeBadge({ type, source: typeSource }: { type: string; source?: string | null }) {
  const cfg = DOCUMENT_TYPES.find((t) => t.value === type) || DOCUMENT_TYPES[1];
  const isAiSuggested = typeSource?.startsWith("ai:");
  const confidence = isAiSuggested ? Math.round(parseFloat(typeSource!.split(":")[1]) * 100) : null;
  return (
    <span
      title={`${cfg.desc}${confidence !== null ? ` (AI: ${confidence}%)` : typeSource === "admin:manual" ? " (manually set)" : ""}`}
      style={{
        display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
        color: cfg.color,
        backgroundColor: `color-mix(in srgb, ${cfg.color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${cfg.color} 25%, transparent)`,
      }}
    >
      {cfg.label}
      {confidence !== null && (
        <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>{confidence}%</span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------
// Main Detail Component
// ------------------------------------------------------------------

interface SubjectDetailProps {
  subjectId: string;
  onSubjectUpdated: () => void;
  isOperator: boolean;
}

export default function SubjectDetail({ subjectId, onSubjectUpdated, isOperator }: SubjectDetailProps) {
  const router = useRouter();
  const { addExtractionJob, addCurriculumJob, jobs } = useBackgroundTaskQueue();
  const { isAdvanced } = useViewMode();
  const { plural } = useTerminology();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [uploadResults, setUploadResults] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [extractingSourceIds, setExtractingSourceIds] = useState<Set<string>>(new Set());

  // Curriculum state
  const [curriculum, setCurriculum] = useState<any>(null);
  const [curriculumTaskId, setCurriculumTaskId] = useState<string | null>(null);
  const [curriculumPreview, setCurriculumPreview] = useState<any>(null);

  // Lesson plan state
  const [lessonPlan, setLessonPlan] = useState<any>(null);
  const [lessonPlanLoading, setLessonPlanLoading] = useState(false);
  const [lessonPlanEditing, setLessonPlanEditing] = useState(false);
  const [lessonPlanGenerating, setLessonPlanGenerating] = useState(false);
  const [lessonPlanDraft, setLessonPlanDraft] = useState<any[]>([]);
  const [lessonPlanReasoning, setLessonPlanReasoning] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  // Derived: active background jobs
  const activeCurriculumJob = jobs.find(
    (j) => j.taskType === "curriculum_generation" && j.subjectId === subjectId && j.progress.status === "in_progress"
  );
  const activeExtractionJobs = jobs.filter(
    (j) => j.taskType === "extraction" && j.subjectId === subjectId && j.progress.status === "in_progress"
  );
  const generatingCurriculum = !!activeCurriculumJob;

  // Domain linking state
  const [allDomains, setAllDomains] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [linkingDomain, setLinkingDomain] = useState(false);

  // Editing description
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");

  // Media library state
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>("all");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaDragging, setMediaDragging] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);

  // Deactivation
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // Load subject
  useEffect(() => {
    loadSubject();
    loadCurriculum();
    loadDomains();
    loadMedia();
    // Reset local state on subject switch
    setError(null);
    setCurriculum(null);
    setCurriculumPreview(null);
    setCurriculumTaskId(null);
    setLessonPlan(null);
    setLessonPlanEditing(false);
    setLessonPlanDraft([]);
    setLessonPlanReasoning(null);
    setUploadResults([]);
    setConfirmDeactivate(false);
  }, [subjectId]);

  async function loadSubject() {
    try {
      setLoading(true);
      const res = await fetch(`/api/subjects/${subjectId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubject(data.subject);
      setEditDesc(data.subject.description || "");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCurriculum() {
    try {
      const res = await fetch(`/api/subjects/${subjectId}/curriculum`);
      const data = await res.json();
      if (data.curriculum) {
        setCurriculum(data.curriculum);
        loadLessonPlan(data.curriculum.id);
      }
    } catch (err) { console.error("[subjects] Failed to load curriculum:", err); }
  }

  async function loadLessonPlan(curriculumId: string) {
    setLessonPlanLoading(true);
    try {
      const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`);
      const data = await res.json();
      if (data.ok && data.plan) setLessonPlan(data.plan);
    } catch (err) { console.error("[subjects] Failed to load lesson plan:", err); }
    setLessonPlanLoading(false);
  }

  async function generateLessonPlan() {
    if (!curriculum) return;
    setLessonPlanGenerating(true);
    setLessonPlanReasoning(null);
    try {
      const res = await fetch(`/api/curricula/${curriculum.id}/lesson-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalSessionTarget: sessionCount || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setLessonPlanDraft(data.plan);
        setLessonPlanReasoning(data.reasoning);
        setLessonPlanEditing(true);
      } else {
        setError(data.error || "Failed to generate lesson plan");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLessonPlanGenerating(false);
  }

  async function saveLessonPlan(entries: any[]) {
    if (!curriculum) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/curricula/${curriculum.id}/lesson-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (data.ok) {
        setLessonPlan(data.plan);
        setLessonPlanEditing(false);
        setLessonPlanDraft([]);
        setLessonPlanReasoning(null);
      } else {
        setError(data.error || "Failed to save lesson plan");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function loadDomains() {
    try {
      const res = await fetch("/api/domains");
      const data = await res.json();
      setAllDomains(data.domains || []);
    } catch (err) { console.error("[subjects] Failed to load domains:", err); }
  }

  // ------------------------------------------------------------------
  // Media library
  // ------------------------------------------------------------------

  async function loadMedia() {
    setMediaLoading(true);
    try {
      const typeParam = mediaTypeFilter !== "all" ? `&type=${mediaTypeFilter}` : "";
      const res = await fetch(`/api/subjects/${subjectId}/media?limit=100${typeParam}`);
      const data = await res.json();
      if (data.ok) setMediaAssets(data.media || []);
    } catch (err) { console.error("[subjects] Failed to load media:", err); } finally {
      setMediaLoading(false);
    }
  }

  async function handleMediaUpload(files: File[]) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/mpeg", "audio/wav", "audio/ogg"];
    const valid = files.filter((f) => allowed.includes(f.type));
    if (valid.length === 0) {
      setError("No valid files. Supported: JPG, PNG, WebP, PDF, MP3, WAV, OGG");
      return;
    }
    setMediaUploading(true);
    try {
      for (const file of valid) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("subjectId", subjectId);
        const res = await fetch("/api/media/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!data.ok) setError(`Upload failed: ${data.error}`);
      }
      loadMedia();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMediaUploading(false);
    }
  }

  async function unlinkMedia(mediaId: string) {
    try {
      await fetch(`/api/subjects/${subjectId}/media`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      setMediaAssets((prev) => prev.filter((m) => m.id !== mediaId));
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (subjectId) loadMedia();
  }, [mediaTypeFilter]);

  // ------------------------------------------------------------------
  // Subject editing
  // ------------------------------------------------------------------

  async function saveSubjectField(field: string, value: any) {
    setSaving(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubject((prev) => prev ? { ...prev, [field]: value } : prev);
      if (field === "name") onSubjectUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to deactivate");
      onSubjectUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeactivating(false);
      setConfirmDeactivate(false);
    }
  }

  // ------------------------------------------------------------------
  // Drag-and-drop file upload
  // ------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        handleFiles(Array.from(e.dataTransfer.files));
      }
    },
    [subjectId]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(Array.from(e.target.files));
    }
  };

  async function handleFiles(files: File[]) {
    const validExts = [".pdf", ".txt", ".md", ".markdown", ".json"];
    const validFiles = files.filter((f) =>
      validExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (validFiles.length === 0) {
      setError("No valid files. Supported: PDF, TXT, MD, JSON");
      return;
    }

    setUploadResults([]);

    const uploads = validFiles.map(async (file) => {
      setUploadingFiles((prev) => [...prev, file.name]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("tags", "content");

        const res = await fetch(`/api/subjects/${subjectId}/upload`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();

        if (data.ok && data.source) {
          const conf = data.classification;
          const pct = conf ? Math.round(conf.confidence * 100) : 0;
          const typeLabel = DOCUMENT_TYPES.find((t) => t.value === conf?.documentType)?.label || conf?.documentType;
          setUploadResults((prev) => [
            ...prev,
            {
              fileName: file.name,
              ok: true,
              sourceId: data.source.id,
              documentType: conf?.documentType,
              confidence: pct,
              reasoning: conf?.reasoning,
              message: `Classified as ${typeLabel} (${pct}%) \u2014 confirm type to extract`,
            },
          ]);
        } else {
          setUploadResults((prev) => [...prev, { fileName: file.name, ...data }]);
        }
      } catch (err: any) {
        setUploadResults((prev) => [...prev, { fileName: file.name, ok: false, error: err.message }]);
      } finally {
        setUploadingFiles((prev) => prev.filter((n) => n !== file.name));
      }
    });

    await Promise.all(uploads);
    loadSubject();
  }

  // ------------------------------------------------------------------
  // Source management
  // ------------------------------------------------------------------

  async function toggleSourceTag(sourceId: string, currentTags: string[], tag: string) {
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];
    try {
      await fetch(`/api/subjects/${subjectId}/sources`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      await fetch(`/api/subjects/${subjectId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, tags: newTags }),
      });
      loadSubject();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeSource(sourceId: string) {
    try {
      await fetch(`/api/subjects/${subjectId}/sources`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      loadSubject();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function changeDocumentType(sourceId: string, documentType: string) {
    try {
      const res = await fetch(`/api/content-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadSubject();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function triggerExtraction(sourceId: string, sourceName: string) {
    setExtractingSourceIds((prev) => new Set([...prev, sourceId]));
    try {
      const res = await fetch(`/api/content-sources/${sourceId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.jobId) {
        addExtractionJob(data.jobId, sourceId, sourceName, sourceName, subjectId);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExtractingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  }

  // ------------------------------------------------------------------
  // Domain linking
  // ------------------------------------------------------------------

  async function linkDomain(domainId: string) {
    setLinkingDomain(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadSubject();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLinkingDomain(false);
    }
  }

  async function unlinkDomain(domainId: string) {
    try {
      await fetch(`/api/subjects/${subjectId}/domains`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      loadSubject();
    } catch (err: any) {
      setError(err.message);
    }
  }

  // ------------------------------------------------------------------
  // Curriculum generation
  // ------------------------------------------------------------------

  async function generateCurriculum() {
    setCurriculumPreview(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/curriculum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.taskId) {
        setCurriculumTaskId(data.taskId);
        addCurriculumJob(data.taskId, subjectId, subject?.name || "Subject");
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    const taskId = curriculumTaskId || activeCurriculumJob?.taskId;
    if (!taskId) return;
    const job = jobs.find((j) => j.taskId === taskId);
    if (job && job.progress.status === "completed") {
      fetch(`/api/subjects/${subjectId}/curriculum/preview?taskId=${taskId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.curriculum) {
            setCurriculumPreview(data.curriculum);
            setCurriculumTaskId(null);
          }
        })
        .catch((err) => console.error("[subjects] Failed to fetch curriculum preview:", err));
    }
  }, [jobs, curriculumTaskId, activeCurriculumJob?.taskId, subjectId]);

  async function saveCurriculum() {
    setSaving(true);
    try {
      const taskId = curriculumTaskId || activeCurriculumJob?.taskId;
      const res = await fetch(`/api/subjects/${subjectId}/curriculum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "save",
          taskId,
          curriculum: curriculumPreview,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurriculum(data.curriculum);
      setCurriculumPreview(null);
      setCurriculumTaskId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <div className="hf-text-center hf-text-muted" style={{ padding: 40 }}>
        <div className="hf-spinner" />
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="hf-banner hf-banner-error" style={{ borderRadius: 8 }}>
        Subject not found
      </div>
    );
  }

  const linkedDomainIds = new Set(subject.domains.map((d) => d.domain.id));
  const availableDomains = allDomains.filter((d) => !linkedDomainIds.has(d.id));
  const hasSyllabus = subject.sources.some((s) => s.tags?.includes("syllabus"));
  const totalAssertions = subject.sources.reduce((sum, s) => sum + s.source._count.assertions, 0);
  const curriculumModules: CurriculumModule[] = curriculum?.notableInfo?.modules || [];

  return (
    <>
      {/* Error */}
      {error && (
        <div className="hf-banner hf-banner-error hf-text-sm hf-mb-md" style={{ borderRadius: 8 }}>
          {error}
          <button onClick={() => setError(null)} className="hf-text-xs" style={{ marginLeft: "auto", textDecoration: "underline", color: "inherit" }}>Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="hf-flex hf-flex-between hf-mb-lg hf-items-start">
        <div>
          <div className="hf-flex hf-gap-md hf-items-center hf-mb-sm">
            <EditableTitle
              value={subject.name}
              as="h2"
              onSave={async (newName) => {
                await saveSubjectField("name", newName);
              }}
            />
            <TrustBadge level={subject.defaultTrustLevel} />
            {subject.qualificationLevel && (
              <span className="hf-text-xs hf-badge hf-badge-muted">
                {subject.qualificationLevel}
              </span>
            )}
          </div>

          {/* Editable description */}
          {editingDesc ? (
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={() => {
                setEditingDesc(false);
                if (editDesc !== (subject.description || "")) saveSubjectField("description", editDesc.trim() || null);
              }}
              autoFocus
              rows={2}
              className="hf-input hf-text-sm"
              style={{ resize: "vertical", border: "1px solid var(--accent-primary)", width: "100%" }}
            />
          ) : (
            <p
              onClick={() => setEditingDesc(true)}
              className="hf-text-sm hf-text-muted"
              style={{ margin: 0, cursor: "pointer" }}
              title="Click to edit"
            >
              {subject.description || "Click to add description..."}
            </p>
          )}
        </div>
        <button
          onClick={() => router.push("/x/content-sources")}
          className="hf-btn-sm hf-btn-primary hf-nowrap"
        >
          Content Wizard
        </button>
      </div>

      {/* Trust level selector + stats */}
      <div className="hf-flex hf-gap-lg hf-mb-lg hf-items-center">
        <div className="hf-flex hf-gap-sm hf-items-center">
          <span className="hf-text-xs hf-text-bold">Default trust:</span>
          <select
            value={subject.defaultTrustLevel}
            onChange={(e) => saveSubjectField("defaultTrustLevel", e.target.value)}
            className="hf-text-xs"
            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-default)" }}
          >
            {TRUST_LEVELS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <span className="hf-text-sm hf-text-muted">
          {subject.sources.length} sources / {totalAssertions} assertions
        </span>
      </div>

      {/* Progress Stepper */}
      <ProgressStepper
        steps={[
          {
            label: "Sources",
            completed: subject.sources.length > 0,
            active: subject.sources.length === 0,
            onClick: () => document.getElementById("section-sources")?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          {
            label: "Curriculum",
            completed: !!curriculum,
            active: subject.sources.length > 0 && !curriculum,
            onClick: () => document.getElementById("section-curriculum")?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          {
            label: "Lesson Plan",
            completed: !!lessonPlan,
            active: !!curriculum && !lessonPlan,
            onClick: () => document.getElementById("section-lesson-plan")?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          {
            label: "Domains",
            completed: subject.domains.length > 0,
            active: !!lessonPlan && subject.domains.length === 0,
            onClick: () => document.getElementById("section-domains")?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
        ]}
      />

      {/* === SOURCES SECTION === */}
      <section id="section-sources" style={{ marginBottom: 32 }}>
        <h3 className="hf-heading-lg hf-mb-md">Sources</h3>

        {subject.sources.length > 0 && (() => {
          const sorted = [...subject.sources].sort((a, b) => {
            const aAwaiting = a.source._count.assertions === 0 && a.source.documentTypeSource?.startsWith("ai:") ? 0 : 1;
            const bAwaiting = b.source._count.assertions === 0 && b.source.documentTypeSource?.startsWith("ai:") ? 0 : 1;
            return aAwaiting - bAwaiting;
          });
          return (
            <div className="hf-mb-md" style={{ display: "grid", gap: 8 }}>
              {sorted.map((ss) => {
                const awaiting = ss.source._count.assertions === 0 && ss.source.documentTypeSource?.startsWith("ai:");
                const isExtracting = extractingSourceIds.has(ss.sourceId);
                return (
                  <div
                    key={ss.id}
                    className="hf-p-md"
                    style={{
                      borderRadius: 10,
                      border: awaiting
                        ? "1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)"
                        : "1px solid var(--border-default)",
                      background: awaiting
                        ? "color-mix(in srgb, var(--accent-primary) 3%, var(--surface-primary))"
                        : "var(--surface-primary)",
                    }}
                  >
                    <div className="hf-flex-between">
                      <div className="hf-flex hf-gap-sm hf-items-center hf-flex-1">
                        <TagPills tags={ss.tags || []} />
                        <DetailDocumentTypeBadge type={ss.source.documentType} source={ss.source.documentTypeSource} />
                        <span className="hf-text-md hf-text-bold">{ss.source.name}</span>
                        <TrustBadge level={ss.trustLevelOverride || ss.source.trustLevel} />
                        <span className="hf-text-xs hf-text-muted">
                          {ss.source._count.assertions} assertions
                        </span>
                      </div>
                      <div className="hf-flex hf-gap-sm hf-items-center">
                        {isAdvanced && SOURCE_TAGS.map((tag) => {
                          const active = ss.tags?.includes(tag.value);
                          return (
                            <button
                              key={tag.value}
                              onClick={() => toggleSourceTag(ss.sourceId, ss.tags || [], tag.value)}
                              title={tag.desc}
                              className="hf-filter-pill"
                              style={active ? {
                                border: `1px solid ${tag.color}`,
                                background: `color-mix(in srgb, ${tag.color} 12%, transparent)`,
                                color: tag.color,
                                opacity: 1,
                              } : { opacity: 0.5 }}
                            >
                              {tag.label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => removeSource(ss.sourceId)}
                          className="hf-btn-unstyled hf-text-error hf-text-sm"
                          style={{ padding: "2px 6px" }}
                          title="Remove from subject"
                        >
                          x
                        </button>
                      </div>
                    </div>

                    {isAdvanced && awaiting && (
                      <div className="hf-flex hf-gap-sm hf-mt-sm hf-items-center" style={{ paddingTop: 8, borderTop: "1px solid color-mix(in srgb, var(--border-default) 50%, transparent)" }}>
                        <span className="hf-text-xs hf-text-bold hf-text-muted">Type:</span>
                        <select
                          value={ss.source.documentType}
                          onChange={(e) => changeDocumentType(ss.sourceId, e.target.value)}
                          className="hf-text-xs"
                          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-default)" }}
                        >
                          {DOCUMENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => triggerExtraction(ss.sourceId, ss.source.name)}
                          disabled={isExtracting}
                          className="hf-btn hf-btn-primary hf-text-xs hf-text-bold"
                          style={{ opacity: isExtracting ? 0.6 : 1 }}
                        >
                          {isExtracting ? "Extracting..." : "Extract"}
                        </button>
                        <button
                          onClick={() => loadSubject()}
                          className="hf-btn hf-btn-secondary hf-text-xs"
                          title="Keep this document for lesson use without extracting assertions"
                        >
                          Store for Lessons
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Upload results */}
        {uploadResults.length > 0 && (
          <div className="hf-mb-md">
            {uploadResults.map((r, i) => (
              <div
                key={i}
                className="hf-text-sm hf-mb-xs hf-p-sm"
                style={{
                  borderRadius: 4,
                  background: r.ok ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)" : "var(--status-error-bg)",
                  color: r.ok ? "var(--text-primary)" : "var(--status-error-text)",
                }}
              >
                {r.ok ? `${r.fileName}: ${r.message}` : `${r.fileName}: ${r.error}`}
              </div>
            ))}
            <button onClick={() => setUploadResults([])} className="hf-btn-unstyled hf-text-xs hf-text-muted hf-mt-xs">
              Dismiss
            </button>
          </div>
        )}

        {uploadingFiles.length > 0 && (
          <div className="hf-mb-md hf-text-sm hf-text-muted">
            Uploading &amp; classifying: {uploadingFiles.join(", ")}...
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="hf-text-center"
          style={{
            border: `2px dashed ${isDragging ? "var(--accent-primary)" : "var(--border-default)"}`,
            borderRadius: 8,
            padding: 32,
            cursor: "pointer",
            transition: "all 0.15s",
            background: isDragging ? "color-mix(in srgb, var(--accent-primary) 5%, transparent)" : "transparent",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.markdown,.json"
            onChange={handleFileInput}
            style={{ display: "none" }}
          />
          <p className="hf-text-bold" style={{ fontSize: 15, margin: "0 0 4px", color: isDragging ? "var(--accent-primary)" : "var(--text-primary)" }}>
            {isDragging ? "Drop files here" : "Drag documents here or click to upload"}
          </p>
          <p className="hf-text-sm hf-text-muted" style={{ margin: 0 }}>
            PDF, TXT, MD, JSON &mdash; documents will be auto-classified, then extracted after you confirm the type
          </p>
        </div>
      </section>

      {/* === CURRICULUM SECTION === */}
      <section id="section-curriculum" style={{ marginBottom: 32 }}>
        <div className="hf-flex-between hf-mb-md">
          <h3 className="hf-heading-lg">Curriculum</h3>
          {isAdvanced && (
            <div className="hf-flex hf-gap-sm hf-items-center">
              {generatingCurriculum && (
                <span className="hf-text-xs hf-text-bold" style={{ color: "var(--accent-primary)" }}>
                  Generating in background...
                </span>
              )}
              {totalAssertions > 0 && (
                <button
                  onClick={generateCurriculum}
                  disabled={generatingCurriculum}
                  className="hf-btn hf-btn-secondary hf-text-sm hf-text-bold"
                  style={{ opacity: generatingCurriculum ? 0.6 : 1 }}
                >
                  {generatingCurriculum
                    ? "Generating..."
                    : curriculum
                    ? "Regenerate"
                    : hasSyllabus
                    ? "Generate from Syllabus"
                    : "Generate from All Sources"}
                </button>
              )}
            </div>
          )}
        </div>

        <AdvancedSection label="Curriculum generation">
          {activeExtractionJobs.length > 0 && !generatingCurriculum && (
            <div className="hf-banner hf-banner-info hf-mb-md">
              {activeExtractionJobs.length} extraction{activeExtractionJobs.length > 1 ? "s" : ""} running &mdash; curriculum will generate automatically when complete.
            </div>
          )}

          {curriculumPreview && (
            <div className="hf-card hf-mb-md" style={{ border: "2px solid var(--accent-primary)", background: "color-mix(in srgb, var(--accent-primary) 3%, transparent)" }}>
              <div className="hf-flex-between hf-mb-md">
                <span className="hf-text-md hf-text-bold" style={{ color: "var(--accent-primary)" }}>Generated Preview</span>
                <div className="hf-flex hf-gap-sm">
                  <button onClick={saveCurriculum} disabled={saving} className="hf-btn hf-btn-primary hf-text-sm">
                    {saving ? "Saving..." : "Save Curriculum"}
                  </button>
                  <button onClick={() => setCurriculumPreview(null)} className="hf-btn hf-btn-secondary hf-text-sm">
                    Discard
                  </button>
                </div>
              </div>
              <CurriculumView modules={curriculumPreview.modules || []} name={curriculumPreview.name} description={curriculumPreview.description} />
            </div>
          )}
        </AdvancedSection>

        {curriculum && !curriculumPreview && (
          <CurriculumView modules={curriculumModules} name={curriculum.name} description={curriculum.description} />
        )}

        {!curriculum && !curriculumPreview && totalAssertions === 0 && (
          <p className="hf-text-md hf-text-muted">
            Upload documents first, then generate a curriculum from the extracted content.
          </p>
        )}
        {!curriculum && !curriculumPreview && totalAssertions > 0 && (
          <p className="hf-text-md hf-text-muted">
            {totalAssertions} assertions ready. Click &quot;Generate&quot; to create a curriculum structure.
          </p>
        )}
      </section>

      {/* === LESSON PLAN SECTION === */}
      {curriculum && (
        <section id="section-lesson-plan" style={{ marginBottom: 32 }}>
          <div className="hf-flex-between hf-mb-md">
            <h3 className="hf-heading-lg">Lesson Plan</h3>
            {lessonPlanGenerating && (
              <span className="hf-text-xs hf-text-bold" style={{ color: "var(--accent-primary)" }}>
                Generating...
              </span>
            )}
          </div>

          {!lessonPlanEditing && (
            <SessionCountPicker value={sessionCount} onChange={setSessionCount} />
          )}

          <div className="hf-flex hf-gap-sm hf-mb-md hf-items-center">
            <button
              onClick={generateLessonPlan}
              disabled={lessonPlanGenerating}
              className="hf-btn hf-btn-secondary hf-text-sm hf-text-bold"
              style={{ opacity: lessonPlanGenerating ? 0.6 : 1 }}
            >
              {lessonPlan ? "Regenerate Plan" : "Generate Plan"}{sessionCount ? ` (${sessionCount} sessions)` : ""}
            </button>
            {lessonPlan && !lessonPlanEditing && (
              <button
                onClick={() => {
                  setLessonPlanDraft(lessonPlan.entries || []);
                  setLessonPlanEditing(true);
                }}
                className="hf-btn hf-btn-secondary hf-text-sm"
              >
                Edit
              </button>
            )}
          </div>

          {lessonPlanReasoning && lessonPlanEditing && (
            <div className="hf-banner hf-banner-info hf-mb-md hf-text-italic">
              AI reasoning: {lessonPlanReasoning}
            </div>
          )}

          {lessonPlanEditing && (
            <LessonPlanEditor
              entries={lessonPlanDraft}
              modules={curriculumModules}
              onChange={setLessonPlanDraft}
              onSave={() => saveLessonPlan(lessonPlanDraft)}
              onCancel={() => { setLessonPlanEditing(false); setLessonPlanDraft([]); setLessonPlanReasoning(null); }}
              saving={saving}
            />
          )}

          {!lessonPlanEditing && lessonPlan && (
            <LessonPlanView entries={lessonPlan.entries || []} />
          )}

          {!lessonPlanEditing && !lessonPlan && !lessonPlanLoading && (
            <p className="hf-text-md hf-text-muted">
              No lesson plan yet. Click &quot;Generate Plan&quot; to create one from the curriculum.
            </p>
          )}
          {lessonPlanLoading && (
            <p className="hf-text-sm hf-text-muted">Loading plan...</p>
          )}
        </section>
      )}

      {/* === DOMAINS SECTION === */}
      <section id="section-domains" style={{ marginBottom: 32 }}>
        <h3 className="hf-heading-lg hf-mb-md">Domains</h3>
        <p className="hf-text-sm hf-text-muted hf-mb-md" style={{ marginTop: -8 }}>
          Link this subject to domains so the AI tutor can teach it to callers in those domains.
        </p>

        {subject.domains.length > 0 && (
          <div className="hf-flex hf-flex-wrap hf-gap-sm hf-mb-md">
            {subject.domains.map((sd) => (
              <div
                key={sd.id}
                className="hf-flex hf-gap-sm hf-text-sm hf-items-center"
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--surface-secondary)" }}
              >
                <span className="hf-text-bold">{sd.domain.name}</span>
                <button
                  onClick={() => unlinkDomain(sd.domain.id)}
                  className="hf-btn-unstyled hf-text-error hf-text-xs"
                  style={{ padding: "0 2px" }}
                  title="Unlink domain"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {availableDomains.length > 0 && (
          <div className="hf-flex hf-gap-sm hf-items-center">
            <select
              id="link-domain-select"
              defaultValue=""
              className="hf-text-sm"
              style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid var(--border-default)" }}
            >
              <option value="" disabled>Select domain...</option>
              {availableDomains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const sel = document.getElementById("link-domain-select") as HTMLSelectElement;
                if (sel?.value) linkDomain(sel.value);
              }}
              disabled={linkingDomain}
              className="hf-btn hf-btn-secondary hf-text-sm hf-text-bold"
            >
              {linkingDomain ? "Linking..." : "Link"}
            </button>
          </div>
        )}

        {availableDomains.length === 0 && subject.domains.length > 0 && (
          <p className="hf-text-sm hf-text-muted">All domains are linked.</p>
        )}
        {allDomains.length === 0 && (
          <p className="hf-text-sm hf-text-muted">{`No ${plural("domain").toLowerCase()} configured yet. Create ${plural("domain").toLowerCase()} first.`}</p>
        )}
      </section>

      {/* === MEDIA LIBRARY SECTION === */}
      <section style={{ marginBottom: 32 }}>
        <div className="hf-flex-between hf-mb-md">
          <h3 className="hf-heading-lg">Media Library</h3>
          <div className="hf-flex hf-gap-sm hf-items-center">
            {["all", "image", "pdf", "audio"].map((f) => (
              <button
                key={f}
                onClick={() => setMediaTypeFilter(f)}
                className={mediaTypeFilter === f ? "hf-chip hf-chip-selected" : "hf-chip"}
                style={{ textTransform: "capitalize" }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <p className="hf-text-sm hf-text-muted hf-mb-md" style={{ marginTop: -8 }}>
          Images, PDFs, and audio files that the AI tutor can share with learners during conversations.
        </p>

        {mediaLoading && mediaAssets.length === 0 ? (
          <p className="hf-text-sm hf-text-muted">Loading media...</p>
        ) : mediaAssets.length > 0 ? (
          <div className="hf-mb-md" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {mediaAssets.map((m) => {
              const isImage = m.mimeType.startsWith("image/");
              const isPdf = m.mimeType === "application/pdf";
              const isAudio = m.mimeType.startsWith("audio/");
              const sizeKB = Math.round(m.fileSize / 1024);
              const sizeLabel = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`;
              return (
                <div key={m.id} style={{ borderRadius: 10, border: "1px solid var(--border-default)", background: "var(--surface-primary)", overflow: "hidden", position: "relative" }}>
                  <div className="hf-flex-center" style={{ height: 120, background: "var(--surface-secondary)" }}>
                    {isImage ? (
                      <img src={`/api/media/${m.id}`} alt={m.title || m.fileName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }} />
                    ) : isPdf ? (
                      <div className="hf-text-center hf-text-muted">
                        <div style={{ fontSize: 32 }}>PDF</div>
                        <div className="hf-text-xs">{sizeLabel}</div>
                      </div>
                    ) : isAudio ? (
                      <div className="hf-text-center hf-text-muted">
                        <div style={{ fontSize: 32 }}>AUD</div>
                        <div className="hf-text-xs">{sizeLabel}</div>
                      </div>
                    ) : (
                      <div className="hf-text-center hf-text-muted">
                        <div style={{ fontSize: 32 }}>FILE</div>
                        <div className="hf-text-xs">{sizeLabel}</div>
                      </div>
                    )}
                  </div>
                  <div className="hf-p-sm">
                    <div className="hf-text-xs hf-text-bold hf-truncate" title={m.fileName}>
                      {m.title || m.fileName}
                    </div>
                    <div className="hf-flex-between hf-mt-xs">
                      <TrustBadge level={m.trustLevel} />
                      <button onClick={() => unlinkMedia(m.id)} className="hf-btn-unstyled hf-text-error hf-text-xs" style={{ padding: "2px 4px" }} title="Remove from subject">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hf-text-sm hf-text-muted hf-mb-md">
            No media files yet. Upload images, PDFs, or audio below.
          </p>
        )}

        {/* Media upload drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setMediaDragging(true); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setMediaDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setMediaDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMediaDragging(false);
            if (e.dataTransfer.files?.length) handleMediaUpload(Array.from(e.dataTransfer.files));
          }}
          onClick={() => mediaFileRef.current?.click()}
          className="hf-text-center"
          style={{
            border: `2px dashed ${mediaDragging ? "var(--accent-primary)" : "var(--border-default)"}`,
            borderRadius: 8,
            padding: 24,
            cursor: mediaUploading ? "wait" : "pointer",
            transition: "all 0.15s",
            background: mediaDragging ? "color-mix(in srgb, var(--accent-primary) 5%, transparent)" : "transparent",
            opacity: mediaUploading ? 0.6 : 1,
          }}
        >
          <input
            ref={mediaFileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/wav,audio/ogg"
            onChange={(e) => {
              if (e.target.files?.length) handleMediaUpload(Array.from(e.target.files));
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <p className="hf-text-md hf-text-bold" style={{ margin: "0 0 4px", color: mediaDragging ? "var(--accent-primary)" : "var(--text-primary)" }}>
            {mediaUploading ? "Uploading..." : mediaDragging ? "Drop media here" : "Drag media files here or click to upload"}
          </p>
          <p className="hf-text-xs hf-text-muted" style={{ margin: 0 }}>
            JPG, PNG, WebP, PDF, MP3, WAV, OGG &mdash; files the AI can share in conversations
          </p>
        </div>
      </section>

      {/* === DEACTIVATE + METADATA === */}
      {isOperator && subject.isActive && (
        <div style={{ paddingTop: 16, borderTop: "1px solid var(--border-default)" }}>
          {!confirmDeactivate ? (
            <button onClick={() => setConfirmDeactivate(true)} className="hf-btn-sm hf-btn-destructive">
              Deactivate Subject
            </button>
          ) : (
            <div className="hf-flex hf-gap-sm hf-items-center">
              <span className="hf-text-xs hf-text-error">Deactivate permanently?</span>
              <button onClick={handleDeactivate} disabled={deactivating} className="hf-btn-sm hf-btn-destructive">
                {deactivating ? "..." : "Yes"}
              </button>
              <button onClick={() => setConfirmDeactivate(false)} className="hf-btn-sm hf-btn-secondary">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <div className="hf-mt-lg" style={{ paddingTop: 16, borderTop: "1px solid var(--border-default)" }}>
        <div className="hf-flex hf-gap-lg hf-text-xs hf-text-muted">
          <span>ID: <span className="hf-mono">{subject.id.slice(0, 8)}...</span></span>
          <span>Slug: <span className="hf-mono">{subject.slug}</span></span>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------
// Curriculum display component
// ------------------------------------------------------------------

function CurriculumView({ modules, name, description }: { modules: CurriculumModule[]; name?: string; description?: string }) {
  return (
    <div>
      {name && <h4 className="hf-heading-md hf-mb-xs" style={{ marginTop: 0 }}>{name}</h4>}
      {description && <p className="hf-text-sm hf-text-muted" style={{ margin: "0 0 12px" }}>{description}</p>}
      {modules.length === 0 ? (
        <p className="hf-text-sm hf-text-muted">No modules defined.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {modules.map((mod) => (
            <div key={mod.id} className="hf-card-compact">
              <div className="hf-flex hf-gap-sm hf-mb-sm hf-items-center">
                <span className="hf-text-xs hf-mono" style={{ fontWeight: 700, color: "var(--accent-primary)" }}>{mod.id}</span>
                <span className="hf-text-md hf-text-bold">{mod.title}</span>
                {mod.estimatedDurationMinutes && (
                  <span className="hf-text-xs hf-text-muted">{mod.estimatedDurationMinutes}min</span>
                )}
              </div>
              {mod.description && (
                <p className="hf-text-sm hf-text-muted" style={{ margin: "0 0 6px" }}>{mod.description}</p>
              )}
              {mod.learningOutcomes.length > 0 && (
                <div className="hf-text-xs">
                  <span className="hf-category-label">Learning Outcomes</span>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {mod.learningOutcomes.map((lo, i) => (
                      <li key={i} className="hf-text-primary" style={{ marginBottom: 2 }}>{lo}</li>
                    ))}
                  </ul>
                </div>
              )}
              {mod.keyTerms && mod.keyTerms.length > 0 && (
                <div className="hf-flex hf-flex-wrap hf-gap-xs hf-mt-sm">
                  {mod.keyTerms.map((t, i) => (
                    <span key={i} className="hf-micro-pill hf-text-muted" style={{ background: "var(--surface-secondary)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Lesson Plan components
// ------------------------------------------------------------------

function LessonPlanView({ entries }: { entries: any[] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="hf-text-sm hf-text-bold hf-text-secondary hf-mb-sm">
        {entries.length} sessions planned
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {entries.map((e: any) => (
          <div key={e.session} className="hf-plan-row" style={{ background: "var(--surface-primary)", border: "1px solid var(--border-subtle)" }}>
            <span className="hf-text-xs hf-text-bold hf-text-muted hf-text-right" style={{ minWidth: 24, fontVariantNumeric: "tabular-nums" }}>
              {e.session}.
            </span>
            <span className="hf-text-sm hf-text-500 hf-text-primary hf-flex-1">
              {e.label}
            </span>
            <SessionTypeBadge type={e.type} />
            {e.moduleLabel && <span className="hf-text-xs hf-text-muted">{e.moduleLabel}</span>}
            {e.assertionCount != null && <span className="hf-text-xs hf-text-muted">{e.assertionCount} pts</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function LessonPlanEditor({
  entries, modules, onChange, onSave, onCancel, saving,
}: {
  entries: any[];
  modules: CurriculumModule[];
  onChange: (entries: any[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const renumber = (list: any[]) => list.map((e, i) => ({ ...e, session: i + 1 }));

  const updateEntry = (index: number, patch: any) => {
    const next = entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    onChange(next);
  };

  const inputStyle: React.CSSProperties = {
    padding: "4px 6px", borderRadius: 4, border: "1px solid var(--border-default)",
    backgroundColor: "var(--surface-secondary)", color: "var(--text-primary)", fontSize: 12,
  };

  return (
    <div>
      <div className="hf-mb-md">
        <SortableList
          items={entries}
          getItemId={(e) => `session-${e.session}-${e.label}`}
          onReorder={(from, to) => {
            const reordered = reorderItems(entries, from, to);
            onChange(renumber(reordered));
          }}
          onRemove={(index) => {
            const next = entries.filter((_, i) => i !== index);
            onChange(renumber(next));
          }}
          onAdd={() => {
            onChange([...entries, {
              session: entries.length + 1,
              type: "introduce",
              moduleId: null,
              moduleLabel: "",
              label: "",
            }]);
          }}
          addLabel="+ Add Session"
          emptyLabel="No sessions. Click + Add Session to begin."
          renderCard={(e, index) => (
            <div className="hf-flex hf-gap-sm hf-items-center hf-flex-1">
              <span className="hf-text-xs hf-text-bold hf-text-muted hf-text-right" style={{ minWidth: 20 }}>
                {index + 1}
              </span>
              <input
                value={e.label}
                onChange={(ev) => updateEntry(index, { label: ev.target.value })}
                onClick={(ev) => ev.stopPropagation()}
                placeholder="Session label"
                style={{ ...inputStyle, flex: 1 }}
              />
              <select
                value={e.type}
                onChange={(ev) => updateEntry(index, { type: ev.target.value })}
                onClick={(ev) => ev.stopPropagation()}
                style={{ ...inputStyle, width: 110 }}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select
                value={e.moduleId || ""}
                onChange={(ev) => {
                  const mod = modules.find((m) => m.id === ev.target.value);
                  updateEntry(index, {
                    moduleId: ev.target.value || null,
                    moduleLabel: mod?.title || "",
                  });
                }}
                onClick={(ev) => ev.stopPropagation()}
                style={{ ...inputStyle, width: 160 }}
              >
                <option value="">No module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </div>
          )}
        />
      </div>

      <div className="hf-flex hf-gap-sm hf-items-center" style={{ justifyContent: "flex-end" }}>
        <button onClick={onCancel} className="hf-btn hf-btn-secondary hf-text-sm">Cancel</button>
        <button
          onClick={onSave}
          disabled={saving || entries.length === 0}
          className="hf-btn hf-btn-primary hf-text-sm"
          style={{ opacity: saving || entries.length === 0 ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : `Save Plan (${entries.length} sessions)`}
        </button>
      </div>
    </div>
  );
}
