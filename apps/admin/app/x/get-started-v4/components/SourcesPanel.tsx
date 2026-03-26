"use client";

/**
 * SourcesPanel — compact content sources panel for the wizard right column.
 *
 * Sits below the ScaffoldPanel under "Building your course". Handles:
 * - File drop zone (compact, right-panel friendly)
 * - Auto-classify + auto-ingest in nonBlocking mode
 * - Live extraction tracking via useSourceStatus
 * - Callbacks to parent for data bag updates
 *
 * Replaces the inline PackUploadStep that used to block the chat input area.
 */

import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from "react";
import { Upload, FileText, Check, AlertCircle, Loader2, RefreshCw, X, Eye, EyeOff } from "lucide-react";
import { useSourceStatus } from "@/hooks/useSourceStatus";
import { SourceStatusDots } from "@/components/shared/SourceStatusDots";
import { getDocTypeInfo, isStudentVisibleDefault } from "@/lib/doc-type-icons";

// ── Types ────────────────────────────────────────────────

export interface SourcesReadyData {
  subjects: Array<{ id: string; name: string }>;
  sourceIds: string[];
  sourceCount: number;
  classifications: Array<{
    fileName: string;
    documentType: string;
    confidence: number;
    reasoning: string;
  }>;
}

export interface SourcesPanelHandle {
  /** Add files programmatically (from page-level drop or inline zone) */
  addFiles: (files: FileList | File[]) => void;
}

interface SourcesPanelProps {
  domainId: string;
  courseName: string;
  interactionPattern?: string;
  teachingMode?: string;
  subjectDiscipline?: string;
  institutionName?: string;
  /** When true, applies hf-glow-active to draw attention */
  glow?: boolean;
  /** Called when sources are created and extraction is running in background */
  onSourcesReady?: (data: SourcesReadyData) => void;
  /** Called when background extraction finishes (all sources have assertions) */
  onExtractionDone?: (totals: { assertions: number; questions: number; vocabulary: number }) => void;
  /** Called when file processing begins (classification step) — use for chat-level indicators */
  onProcessingStart?: () => void;
}

type Phase = "idle" | "analyzing" | "uploading" | "tracking" | "done" | "error";

const VALID_EXTENSIONS = [".pdf", ".docx", ".doc", ".pptx", ".txt", ".md", ".markdown", ".json"];
const ACCEPT_ATTR = VALID_EXTENSIONS.join(",");

// ── Component ────────────────────────────────────────────

export const SourcesPanel = forwardRef<SourcesPanelHandle, SourcesPanelProps>(function SourcesPanel({
  domainId,
  courseName,
  interactionPattern,
  teachingMode,
  subjectDiscipline,
  institutionName,
  glow,
  onSourcesReady,
  onExtractionDone,
  onProcessingStart,
}, ref) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [classifications, setClassifications] = useState<SourcesReadyData["classifications"]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [studentVisible, setStudentVisible] = useState<Record<number, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const notifiedDone = useRef(false);

  // ── Live extraction tracking ──────────────────────────

  const statusMap = useSourceStatus(sourceIds, {
    enabled: sourceIds.length > 0 && phase === "tracking",
    pollInterval: 5_000,
  });

  const { totalAssertions, totalEmbedded, extractionDone } = useMemo(() => {
    const values = Object.values(statusMap);
    if (values.length === 0 || values.length < sourceIds.length) {
      return { totalAssertions: 0, totalEmbedded: 0, extractionDone: false };
    }
    const assertions = values.reduce((sum, s) => sum + s.assertionCount, 0);
    const embedded = values.reduce((sum, s) => sum + s.embeddedCount, 0);
    const done = values.every((s) => s.assertionCount > 0);
    return { totalAssertions: assertions, totalEmbedded: embedded, extractionDone: done };
  }, [statusMap, sourceIds]);

  // Auto-transition when extraction completes
  useEffect(() => {
    if (extractionDone && phase === "tracking" && !notifiedDone.current) {
      notifiedDone.current = true;
      setPhase("done");
      onExtractionDone?.({ assertions: totalAssertions, questions: 0, vocabulary: 0 });
    }
  }, [extractionDone, phase, totalAssertions, onExtractionDone]);

  // ── File handling ─────────────────────────────────────

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const allFiles = Array.from(newFiles);
    const valid = allFiles.filter((f) => {
      const name = f.name.toLowerCase();
      return VALID_EXTENSIONS.some((ext) => name.endsWith(ext));
    });

    // Compute rejected file names and update warning state (cleared on every drop)
    const rejected = allFiles
      .filter((f) => !valid.includes(f))
      .map((f) => f.name);
    setRejectedFiles(rejected);

    if (valid.length === 0) return;

    // If we already processed a batch, set files to ONLY the new ones
    // (previous batch is already represented in classifications/sourceIds).
    // Reset to idle so auto-process picks them up.
    setFiles((prev) => {
      if (phase === "tracking" || phase === "done") {
        const alreadyClassified = new Set(classifications.map((c) => c.fileName));
        return valid.filter((f) => !alreadyClassified.has(f.name));
      }
      const existingNames = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !existingNames.has(f.name))];
    });
    if (phase === "tracking" || phase === "done") {
      setPhase("idle");
    }
    setError(null);
  }, [phase, classifications]);

  // Expose addFiles for external callers (page-level drop, inline zone)
  useImperativeHandle(ref, () => ({
    addFiles,
  }), [addFiles]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  // ── Process: analyze → ingest (nonBlocking) ───────────

  const handleProcess = useCallback(async () => {
    if (files.length === 0 || !domainId) return;

    setPhase("analyzing");
    setError(null);
    onProcessingStart?.();

    try {
      // Step 1: Classify files
      const analyzeForm = new FormData();
      analyzeForm.append("courseName", courseName);
      analyzeForm.append("domainId", domainId);
      for (const file of files) analyzeForm.append("files", file);

      const analyzeRes = await fetch("/api/course-pack/analyze", {
        method: "POST",
        body: analyzeForm,
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeData.ok) throw new Error(analyzeData.error || "Analysis failed");

      const manifest = analyzeData.manifest;

      // Build classifications from manifest
      const classificationsList: SourcesReadyData["classifications"] = [
        ...(manifest.groups?.flatMap((g: any) =>
          g.files.map((f: any) => ({
            fileName: f.fileName,
            documentType: f.documentType,
            confidence: f.confidence,
            reasoning: f.reasoning,
          })),
        ) || []),
        ...(manifest.pedagogyFiles?.map((f: any) => ({
          fileName: f.fileName,
          documentType: f.documentType,
          confidence: f.confidence,
          reasoning: f.reasoning,
        })) || []),
      ];
      // Step 2: Ingest (nonBlocking — creates sources, fires off extraction)
      setPhase("uploading");

      const ingestForm = new FormData();
      ingestForm.append("manifest", JSON.stringify(manifest));
      ingestForm.append("domainId", domainId);
      ingestForm.append("courseName", courseName);
      ingestForm.append("nonBlocking", "true");
      if (interactionPattern) ingestForm.append("interactionPattern", interactionPattern);
      if (teachingMode) ingestForm.append("teachingMode", teachingMode);
      if (subjectDiscipline) ingestForm.append("subjectDiscipline", subjectDiscipline);
      for (const file of files) ingestForm.append("files", file);

      const ingestRes = await fetch("/api/course-pack/ingest", {
        method: "POST",
        body: ingestForm,
      });
      const ingestData = await ingestRes.json();
      if (!ingestData.ok) throw new Error(ingestData.error || "Upload failed");

      // Merge with existing results from previous batches (using functional setState)
      let mergedClassifications = classificationsList;
      setClassifications((prev) => {
        mergedClassifications = [...prev, ...classificationsList];
        return mergedClassifications;
      });

      let mergedSourceIds = ingestData.sourceIds || [];
      setSourceIds((prev) => {
        mergedSourceIds = [...prev, ...(ingestData.sourceIds || [])];
        return mergedSourceIds;
      });

      setSubjects((prev) => {
        const existing = new Set(prev.map((s) => s.id));
        const newSubjects = (ingestData.subjects || []).filter((s: { id: string }) => !existing.has(s.id));
        return [...prev, ...newSubjects];
      });
      setPhase("tracking");
      notifiedDone.current = false;

      // Initialize student visibility for new files (offset by previous batch size)
      setStudentVisible((prev) => {
        const offset = Object.keys(prev).length;
        const visMap = { ...prev };
        classificationsList.forEach((c, i) => {
          visMap[offset + i] = isStudentVisibleDefault(c.documentType);
        });
        return visMap;
      });

      // Notify parent with full merged data
      onSourcesReady?.({
        subjects: ingestData.subjects || [],
        sourceIds: mergedSourceIds,
        sourceCount: mergedSourceIds.length,
        classifications: mergedClassifications,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPhase("error");
    }
  }, [files, domainId, courseName, interactionPattern, teachingMode, subjectDiscipline, onSourcesReady]);

  // Auto-process when files are added (after a short debounce to allow multi-file drops)
  // Only fires when domainId is available — if not, files stay queued until it arrives.
  const processTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (files.length > 0 && phase === "idle" && domainId) {
      if (processTimer.current) clearTimeout(processTimer.current);
      processTimer.current = setTimeout(() => handleProcess(), 800);
    }
    return () => {
      if (processTimer.current) clearTimeout(processTimer.current);
    };
  }, [files, phase, domainId, handleProcess]);

  // When domainId arrives and files are already queued, kick off processing
  const prevDomainId = useRef<string>("");
  useEffect(() => {
    if (domainId && !prevDomainId.current && files.length > 0 && phase === "idle") {
      handleProcess();
    }
    prevDomainId.current = domainId;
  }, [domainId, files.length, phase, handleProcess]);

  // ── Remove a file ────────────────────────────────────

  const removeFile = useCallback((fileName: string) => {
    // Remove from local files (pre-upload)
    setFiles((prev) => prev.filter((f) => f.name !== fileName));

    // Remove from classifications + sourceIds (post-upload)
    const idx = classifications.findIndex((c) => c.fileName === fileName);
    if (idx >= 0) {
      const newClassifications = classifications.filter((_, i) => i !== idx);
      const newSourceIds = sourceIds.filter((_, i) => i !== idx);
      setClassifications(newClassifications);
      setSourceIds(newSourceIds);

      // Re-notify parent with updated data
      if (newSourceIds.length > 0) {
        onSourcesReady?.({
          subjects: [], // parent keeps its own subject state
          sourceIds: newSourceIds,
          sourceCount: newSourceIds.length,
          classifications: newClassifications,
        });
      }

      // If all files removed, reset to idle
      if (newClassifications.length === 0) {
        setPhase("idle");
        notifiedDone.current = false;
      }
    }
  }, [classifications, sourceIds, onSourcesReady]);

  // ── Toggle student visibility ────────────────────────

  const toggleStudentVisible = useCallback(async (idx: number) => {
    const sourceId = sourceIds[idx];
    const subjectId = subjects[0]?.id;
    if (!sourceId || !subjectId) return;

    const newVisible = !studentVisible[idx];
    setStudentVisible((prev) => ({ ...prev, [idx]: newVisible }));

    // Build tags: keep existing non-visibility tags, toggle student-material
    const baseTags = ["content", "pack-upload"];
    const tags = newVisible ? [...baseTags, "student-material"] : baseTags;

    try {
      await fetch(`/api/subjects/${subjectId}/sources`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, tags }),
      });
    } catch {
      // Revert on failure
      setStudentVisible((prev) => ({ ...prev, [idx]: !newVisible }));
    }
  }, [sourceIds, subjects, studentVisible]);

  // ── Render ────────────────────────────────────────────

  const isProcessing = phase === "analyzing" || phase === "uploading";
  const hasResults = classifications.length > 0;
  const showDropZone = phase === "idle" || phase === "error";

  return (
    <div ref={containerRef} className={`cv4-sources${glow ? " hf-glow-active" : ""}`}>
      <div className="cv4-sources-header">Teaching Materials</div>

      {/* Drop zone */}
      {showDropZone && (
        <div
          className={`cv4-sources-dropzone${dragOver ? " cv4-sources-dropzone--active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} />
          <span>Drop files here</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="cv4-sources-file-input"
        accept={ACCEPT_ATTR}
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Rejected file warning */}
      {rejectedFiles.length > 0 && (
        <div className="cv4-sources-warning">
          Skipped: {rejectedFiles.join(", ")} — Supported: PDF, Word, PowerPoint, TXT, MD, JSON
        </div>
      )}

      {/* Queued files (before classification) */}
      {files.length > 0 && !hasResults && !isProcessing && (
        <div className="cv4-sources-files">
          {files.map((f) => (
            <div key={f.name} className="cv4-sources-file">
              <FileText size={12} />
              <span className="cv4-sources-filename" title={f.name}>{f.name}</span>
              {!domainId && <span className="cv4-sources-queued">queued</span>}
              <button
                className="cv4-sources-remove"
                onClick={() => removeFile(f.name)}
                title="Remove file"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="cv4-sources-status">
          <Loader2 size={14} className="hf-spinner" />
          <span>{phase === "analyzing" ? "Classifying..." : "Uploading..."}</span>
        </div>
      )}

      {/* File list with classifications */}
      {hasResults && (
        <div className="cv4-sources-files">
          {classifications.map((c, idx) => {
            const info = getDocTypeInfo(c.documentType);
            const isVisible = studentVisible[idx] ?? false;
            return (
              <div key={c.fileName} className="cv4-sources-file">
                <FileText size={12} />
                <span className="cv4-sources-filename" title={c.fileName}>{c.fileName}</span>
                <span
                  className="cv4-sources-doctype"
                  style={{ "--badge-color": info.color, "--badge-bg": info.bg } as React.CSSProperties}
                >
                  {info.label}
                </span>
                <button
                  className={`cv4-sources-visibility${isVisible ? " cv4-sources-visibility--on" : ""}`}
                  onClick={() => toggleStudentVisible(idx)}
                  title={isVisible
                    ? "Students can access this file. Click to make teacher-only. (Content still feeds the AI tutor either way.)"
                    : "Teacher-only reference — students can't access this file, but the AI tutor still learns from it. Click to share with students."
                  }
                >
                  {isVisible ? <><Eye size={11} /> Student</> : <><EyeOff size={11} /> Teacher</>}
                </button>
                <button
                  className="cv4-sources-remove"
                  onClick={() => removeFile(c.fileName)}
                  title="Remove file"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Extraction progress */}
      {phase === "tracking" && (
        <div className="cv4-sources-extraction">
          <div className="cv4-sources-extraction-row">
            <span className="cv4-sources-pulse" />
            <span>Extracting content...</span>
          </div>
          {totalAssertions > 0 && (
            <div className="cv4-sources-count">
              {totalAssertions} item{totalAssertions !== 1 ? "s" : ""} extracted
            </div>
          )}
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="cv4-sources-done">
          <Check size={14} />
          <span>{totalAssertions} item{totalAssertions !== 1 ? "s" : ""} ready</span>
          <span className="cv4-sources-done-hint">Available across all sessions</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="cv4-sources-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button
            className="cv4-sources-retry"
            onClick={() => { setPhase("idle"); setError(null); }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Add more files (when tracking or done) */}
      {(phase === "tracking" || phase === "done") && (
        <button
          className="cv4-sources-add-more"
          onClick={() => fileInputRef.current?.click()}
        >
          + Add more files
        </button>
      )}
    </div>
  );
});
