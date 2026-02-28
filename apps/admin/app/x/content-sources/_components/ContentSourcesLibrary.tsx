"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";
import { ActiveJobsBanner } from "./shared/ActiveJobsBanner";
import {
  ContentSource,
  DOCUMENT_TYPES,
  TRUST_LEVELS,
  TrustBadge,
  FreshnessIndicator,
  DocTypeBadge,
  UsedByCell,
  ArchivedBadge,
} from "./shared/badges";
import { SourceStatusDots, type SourceStatusData } from "@/components/shared/SourceStatusDots";
import { useSourceStatus } from "@/hooks/useSourceStatus";

// ── Inline Uploader (background extraction) ─────────────

type UploadPhase = "pick" | "running" | "done" | "error";

interface JobProgress {
  status: string;
  currentChunk: number;
  totalChunks: number;
  extractedCount: number;
  importedCount?: number;
  duplicatesSkipped?: number;
  warnings: string[];
  error?: string;
}

function InlineUploader({
  sourceId,
  sourceName,
  onDone,
}: {
  sourceId: string;
  sourceName: string;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<UploadPhase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      setElapsed(0);
      const startedAt = Date.now();
      const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      pollRef.current = setInterval(async () => {
        // Timeout guard
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (tickRef.current) clearInterval(tickRef.current);
          setError("Extraction timed out. Please try again.");
          setPhase("error");
          return;
        }
        try {
          const res = await fetch(`/api/content-sources/${sourceId}/import?jobId=${jobId}`);
          const data = await res.json();
          if (!data.ok) return;
          const job = data.job as JobProgress;
          setProgress(job);
          if (job.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (tickRef.current) clearInterval(tickRef.current);
            setPhase("done");
          } else if (job.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (tickRef.current) clearInterval(tickRef.current);
            setError(job.error || "Extraction failed");
            setPhase("error");
          }
        } catch {
          // keep polling
        }
      }, 2000);
    },
    [sourceId]
  );

  const handleUpload = async () => {
    if (!file) return;
    setPhase("running");
    setError(null);
    setProgress(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "background");
      formData.append("maxAssertions", "500");
      const res = await fetch(`/api/content-sources/${sourceId}/import`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok && data.jobId) {
        setProgress({
          status: "extracting",
          currentChunk: 0,
          totalChunks: data.totalChunks || 0,
          extractedCount: 0,
          warnings: [],
        });
        startPolling(data.jobId);
      } else {
        setError(data.error || "Failed to start extraction");
        setPhase("pick");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
      setPhase("pick");
    }
  };

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const pct =
    progress && progress.totalChunks > 0
      ? Math.round((progress.currentChunk / progress.totalChunks) * 100)
      : 0;

  return (
    <div className="hf-upload-panel">
      {phase === "pick" && (
        <div className="hf-flex hf-gap-md hf-flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.json"
            className="hf-hidden"
            onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="hf-btn hf-btn-secondary"
          >
            {file ? file.name : "Choose file..."}
          </button>
          {file && (
            <span className="hf-text-xs hf-text-muted">
              {(file.size / 1024).toFixed(1)} KB
            </span>
          )}
          <button
            onClick={handleUpload}
            disabled={!file}
            className="hf-btn hf-btn-primary hf-ml-auto"
          >
            Extract &amp; Import
          </button>
          {error && <span className="hf-text-xs hf-text-error hf-w-full">{error}</span>}
        </div>
      )}

      {phase === "running" && (
        <div className="hf-glow-active" style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 12 }}>
          <div className="hf-flex hf-gap-sm hf-mb-sm">
            <span className="hf-pulse-dot" />
            <span className="hf-text-sm hf-text-bold hf-text-primary">
              {progress ? `Extracting \u2014 ${progress.extractedCount} assertions found` : "Starting..."}
            </span>
            <span className="hf-text-xs hf-text-muted hf-ml-auto hf-tabular-nums">
              {timeStr}
            </span>
          </div>
          {progress && progress.totalChunks > 0 && (
            <div className="hf-progress-bar-track">
              <div className="hf-progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          {!progress && (
            <div className="hf-progress-bar-track">
              <div className="hf-progress-bar-indeterminate" />
            </div>
          )}
          <div className="hf-text-xs hf-text-muted hf-mt-xs">
            {file?.name}{progress && progress.totalChunks > 0 ? ` \u2014 chunk ${progress.currentChunk}/${progress.totalChunks}` : ""}
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="hf-flex hf-gap-md">
          <span style={{ fontSize: 18 }}>{"\u2705"}</span>
          <div>
            <span className="hf-text-sm hf-text-bold hf-text-success">
              {progress?.importedCount ?? progress?.extractedCount ?? 0} assertions imported
            </span>
            {(progress?.duplicatesSkipped ?? 0) > 0 && (
              <span className="hf-text-xs hf-text-muted" style={{ marginLeft: 8 }}>
                ({progress?.duplicatesSkipped} duplicates skipped)
              </span>
            )}
          </div>
          <div className="hf-flex hf-gap-sm hf-ml-auto">
            <Link
              href={`/x/content-sources/${sourceId}`}
              className="hf-btn hf-btn-secondary hf-no-decoration"
            >
              Review Assertions
            </Link>
            <button
              onClick={onDone}
              className="hf-btn hf-btn-primary"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="hf-flex hf-gap-md">
          <span className="hf-text-sm hf-text-bold hf-text-error">
            Failed: {error}
          </span>
          <button
            onClick={() => { setPhase("pick"); setError(null); setProgress(null); }}
            className="hf-btn hf-btn-secondary hf-ml-auto"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

// ── Source Row ─────────────────────────────────────

function SourceRow({
  source: s,
  isUploading,
  onToggleUpload,
  onUploadDone,
  onRefresh,
  status,
}: {
  source: ContentSource;
  isUploading: boolean;
  onToggleUpload: () => void;
  onUploadDone: () => void;
  onRefresh: () => void;
  status?: SourceStatusData | null;
}) {
  const [extracting, setExtracting] = useState(false);
  const [changingType, setChangingType] = useState(false);
  const [archiveAction, setArchiveAction] = useState(false);

  const isArchived = !!s.archivedAt;

  const awaiting = s._count.assertions === 0 && s.documentTypeSource?.startsWith("ai:");
  const confidence = s.documentTypeSource?.startsWith("ai:")
    ? Math.round(parseFloat(s.documentTypeSource.split(":")[1]) * 100)
    : null;

  async function handleExtract() {
    setExtracting(true);
    try {
      const res = await fetch(`/api/content-sources/${s.id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onRefresh();
    } catch {
      // Error handled by banner
    } finally {
      setExtracting(false);
    }
  }

  async function handleChangeType(newType: string) {
    setChangingType(true);
    try {
      const res = await fetch(`/api/content-sources/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: newType }),
      });
      if (!res.ok) return;
      onRefresh();
    } finally {
      setChangingType(false);
    }
  }

  async function handleArchiveToggle() {
    setArchiveAction(true);
    try {
      if (isArchived) {
        const res = await fetch(`/api/content-sources/${s.id}/unarchive`, { method: "POST" });
        if (!res.ok) return;
      } else {
        const res = await fetch(`/api/content-sources/${s.id}?force=true`, { method: "DELETE" });
        if (!res.ok) return;
      }
      onRefresh();
    } finally {
      setArchiveAction(false);
    }
  }

  const hasExpandedRow = isUploading || awaiting;

  return (
    <>
      <tr
        className={`${hasExpandedRow ? "hf-tr-no-border" : "hf-tr-border"} ${awaiting ? "hf-tr-awaiting" : ""}`}
        style={{ opacity: isArchived ? 0.55 : 1 }}
      >
        <td className="cs-td">
          <div className="hf-flex hf-gap-xs">
            <Link href={`/x/content-sources/${s.id}`} className="hf-text-bold hf-text-primary hf-no-decoration">{s.name}</Link>
            {isArchived && <ArchivedBadge archivedAt={s.archivedAt} />}
          </div>
          <div className="hf-text-xs hf-text-muted hf-mono">{s.slug}</div>
          {s.authors.length > 0 && (
            <div className="hf-text-xs hf-text-muted">{s.authors.join(", ")}</div>
          )}
        </td>
        <td className="cs-td">
          <DocTypeBadge type={s.documentType} source={s.documentTypeSource} onChange={handleChangeType} />
        </td>
        <td className="cs-td">
          <TrustBadge level={s.trustLevel} />
        </td>
        <td className="cs-td hf-text-secondary">
          {s.qualificationRef || "-"}
          {s.accreditationRef && (
            <div className="hf-text-xs hf-text-muted">{s.accreditationRef}</div>
          )}
        </td>
        <td className="cs-td hf-text-secondary">
          {s.publisherOrg || "-"}
          {s.accreditingBody && (
            <div className="hf-text-xs hf-text-muted">Accredited by: {s.accreditingBody}</div>
          )}
        </td>
        <td className="cs-td">
          <FreshnessIndicator validUntil={s.validUntil} />
        </td>
        <td className="cs-td">
          <UsedByCell subjects={s.subjects} />
        </td>
        <td className="cs-td-right">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <SourceStatusDots status={status ?? null} />
            {s._count.assertions > 0 ? (
              <Link href={`/x/content-sources/${s.id}`} className="hf-no-decoration hf-text-500" style={{ color: "var(--accent-primary)" }}>
                {s._count.assertions}
              </Link>
            ) : (
              <span className="hf-text-muted">0</span>
            )}
          </div>
        </td>
        <td className="cs-td-right">
          <div className="hf-flex hf-gap-xs hf-justify-end">
            {!isArchived && (
              <button
                onClick={onToggleUpload}
                className={`hf-btn hf-btn-xs ${isUploading ? "hf-btn-primary" : "hf-btn-secondary"}`}
              >
                {isUploading ? "Close" : "Upload"}
              </button>
            )}
            <button
              onClick={handleArchiveToggle}
              disabled={archiveAction}
              title={isArchived ? "Restore this material" : "Archive this material"}
              className="hf-btn hf-btn-secondary hf-btn-xs"
            >
              {archiveAction ? "..." : isArchived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </td>
      </tr>
      {awaiting && !isUploading && (
        <tr className="hf-tr-border">
          <td colSpan={9} style={{ padding: "0 12px 12px" }}>
            <div className="hf-classified-row">
              <span className="hf-text-xs hf-text-bold" style={{ color: "var(--accent-primary)" }}>
                Classified{confidence !== null ? ` (${confidence}%)` : ""}
              </span>
              <button
                onClick={handleExtract}
                disabled={extracting}
                className="hf-btn hf-btn-primary hf-btn-xs"
                style={{ padding: "4px 14px" }}
              >
                {extracting ? "Starting..." : "Extract Assertions"}
              </button>
              <span className="hf-text-xs hf-text-muted hf-ml-auto">
                Confirm type before extracting
              </span>
            </div>
          </td>
        </tr>
      )}
      {isUploading && (
        <tr className="hf-tr-border">
          <td colSpan={9} style={{ padding: "0 12px 16px" }}>
            <InlineUploader sourceId={s.id} sourceName={s.name} onDone={onUploadDone} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Create Source Form ─────────────────────────────

function CreateSourceForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    slug: "", name: "", description: "", trustLevel: "UNVERIFIED", documentType: "",
    publisherOrg: "", accreditingBody: "", accreditationRef: "", authors: "",
    isbn: "", edition: "", publicationYear: "", qualificationRef: "", validFrom: "", validUntil: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentText, setIntentText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [aiInterpretation, setAiInterpretation] = useState<string | null>(null);

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
      setForm((prev) => ({
        ...prev,
        slug: f.slug || prev.slug, name: f.name || prev.name,
        description: f.description || prev.description, trustLevel: f.trustLevel || prev.trustLevel,
        documentType: f.documentType || prev.documentType, publisherOrg: f.publisherOrg || prev.publisherOrg,
        accreditingBody: f.accreditingBody || prev.accreditingBody, accreditationRef: f.accreditationRef || prev.accreditationRef,
        authors: Array.isArray(f.authors) ? f.authors.join(", ") : prev.authors,
        isbn: f.isbn || prev.isbn, edition: f.edition || prev.edition,
        publicationYear: f.publicationYear ? String(f.publicationYear) : prev.publicationYear,
        qualificationRef: f.qualificationRef || prev.qualificationRef,
        validFrom: f.validFrom || prev.validFrom, validUntil: f.validUntil || prev.validUntil,
      }));
      if (data.interpretation) setAiInterpretation(data.interpretation);
    } catch (err: any) {
      setSuggestError(err.message || "Network error");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/content-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          documentType: form.documentType || undefined,
          authors: form.authors ? form.authors.split(",").map((a) => a.trim()) : [],
          publicationYear: form.publicationYear ? parseInt(form.publicationYear) : null,
          validFrom: form.validFrom || null, validUntil: form.validUntil || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="hf-form-panel">
      <h3 className="hf-heading-sm" style={{ margin: "0 0 12px", fontSize: 16 }}>Add Material</h3>

      <div className="hf-mb-md">
        <div className="hf-flex hf-gap-sm">
          <input type="text" value={intentText} onChange={(e) => setIntentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && intentText.trim() && !suggesting) { e.preventDefault(); handleSuggest(); } }}
            placeholder='Describe the material... e.g. "CII R04 Insurance Syllabus 2025/26" or paste an ISBN'
            disabled={suggesting}
            className="hf-input-compact hf-flex-1"
            style={{ padding: "8px 12px" }}
          />
          <button type="button" onClick={handleSuggest} disabled={!intentText.trim() || suggesting}
            className="hf-btn hf-btn-primary hf-nowrap"
          >
            {suggesting ? (
              <><span className="hf-spinner-inline" />Thinking...</>
            ) : (
              <><span style={{ fontSize: 14 }}>&#10024;</span>Fill</>
            )}
          </button>
        </div>
        {suggestError && <p className="hf-text-xs hf-text-error" style={{ margin: "4px 0 0" }}>{suggestError}</p>}
        {aiInterpretation && (
          <div className="hf-ai-interpretation">
            <span className="hf-text-sm">&#10024;</span>
            {aiInterpretation}
            <button type="button" onClick={() => setAiInterpretation(null)} className="hf-btn-dismiss">
              &times;
            </button>
          </div>
        )}
      </div>

      {error && <p className="hf-text-sm hf-text-error hf-mb-sm">{error}</p>}

      <div className="hf-grid-4 hf-mb-md">
        <div><div className="hf-label-compact">Slug *</div><input className="hf-input-compact" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="e.g., cii-r04-syllabus-2025" required /></div>
        <div><div className="hf-label-compact">Name *</div><input className="hf-input-compact" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., CII R04 Syllabus 2025/26" required /></div>
        <div><div className="hf-label-compact">Document Type</div>
          <select className="hf-input-compact" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
            <option value="">Auto-detect</option>
            {DOCUMENT_TYPES.map((d) => (<option key={d.value} value={d.value}>{d.icon} {d.label}</option>))}
          </select>
        </div>
        <div><div className="hf-label-compact">Trust Level</div>
          <select className="hf-input-compact" value={form.trustLevel} onChange={(e) => setForm({ ...form, trustLevel: e.target.value })}>
            {TRUST_LEVELS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
          </select>
        </div>
      </div>

      <div className="hf-grid-3 hf-mb-md">
        <div><div className="hf-label-compact">Publisher</div><input className="hf-input-compact" value={form.publisherOrg} onChange={(e) => setForm({ ...form, publisherOrg: e.target.value })} placeholder="e.g., Chartered Insurance Institute" /></div>
        <div><div className="hf-label-compact">Accrediting Body</div><input className="hf-input-compact" value={form.accreditingBody} onChange={(e) => setForm({ ...form, accreditingBody: e.target.value })} placeholder="e.g., CII, Ofqual" /></div>
        <div><div className="hf-label-compact">Qualification Ref</div><input className="hf-input-compact" value={form.qualificationRef} onChange={(e) => setForm({ ...form, qualificationRef: e.target.value })} placeholder="e.g., CII R04" /></div>
      </div>

      <div className="hf-grid-4 hf-mb-md">
        <div><div className="hf-label-compact">Authors (comma-separated)</div><input className="hf-input-compact" value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })} placeholder="e.g., Richard Sprenger" /></div>
        <div><div className="hf-label-compact">ISBN</div><input className="hf-input-compact" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} /></div>
        <div><div className="hf-label-compact">Edition</div><input className="hf-input-compact" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })} placeholder="e.g., 37th Edition" /></div>
        <div><div className="hf-label-compact">Publication Year</div><input className="hf-input-compact" type="number" value={form.publicationYear} onChange={(e) => setForm({ ...form, publicationYear: e.target.value })} /></div>
      </div>

      <div className="hf-grid-2 hf-mb-md">
        <div><div className="hf-label-compact">Valid From</div><input className="hf-input-compact" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></div>
        <div><div className="hf-label-compact">Valid Until</div><input className="hf-input-compact" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></div>
      </div>

      <div className="hf-flex hf-gap-sm">
        <button type="submit" disabled={saving} className="hf-btn hf-btn-primary">
          {saving ? "Saving..." : "Create Material"}
        </button>
        <button type="button" onClick={onCancel} className="hf-btn hf-btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main Library Component ────────────────────────

export default function ContentSourcesLibrary() {
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTrust, setFilterTrust] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [uploadSourceId, setUploadSourceId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropStatus, setDropStatus] = useState<{ phase: "idle" | "creating" | "classifying" | "done" | "error"; message: string }>({ phase: "idle", message: "" });

  async function fetchSources() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTrust) params.set("trustLevel", filterTrust);
      if (showArchived) params.set("activeOnly", "false");
      const res = await fetch(`/api/content-sources?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSources(data.sources || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSources();
  }, [filterTrust, showArchived]);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "txt", "md", "markdown", "json"].includes(ext || "")) {
      setDropStatus({ phase: "error", message: `Unsupported file type: .${ext}` });
      setTimeout(() => setDropStatus({ phase: "idle", message: "" }), 4000);
      return;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const name = baseName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    setDropStatus({ phase: "creating", message: `Creating material "${name}"...` });
    try {
      const createRes = await fetch("/api/content-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, trustLevel: "UNVERIFIED" }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Failed to create material");

      const sourceId = createData.source.id;

      setDropStatus({ phase: "classifying", message: `Classifying "${file.name}"...` });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "classify");
      const classifyRes = await fetch(`/api/content-sources/${sourceId}/import`, {
        method: "POST",
        body: formData,
      });
      const classifyData = await classifyRes.json();
      if (!classifyRes.ok) throw new Error(classifyData.error || "Failed to classify document");

      const detectedType = classifyData.classification?.documentType
        ? DOCUMENT_TYPES.find((d) => d.value === classifyData.classification.documentType)
        : null;
      const pct = classifyData.classification?.confidence
        ? Math.round(classifyData.classification.confidence * 100)
        : 0;
      const typeMsg = detectedType ? ` Classified as ${detectedType.icon} ${detectedType.label} (${pct}%).` : "";
      setDropStatus({ phase: "done", message: `Material created.${typeMsg} Review the type, then extract.` });
      fetchSources();
      setTimeout(() => setDropStatus({ phase: "idle", message: "" }), 5000);
    } catch (err: any) {
      setDropStatus({ phase: "error", message: err.message });
      setTimeout(() => setDropStatus({ phase: "idle", message: "" }), 5000);
    }
  }

  const filtered = sources.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.qualificationRef || "").toLowerCase().includes(q) ||
      (s.publisherOrg || "").toLowerCase().includes(q)
    );
  });

  // Batch-fetch processing status for all visible sources
  const sourceIds = filtered.map((s) => s.id);
  const statusMap = useSourceStatus(sourceIds);

  const expired = sources.filter((s) => s.validUntil && new Date(s.validUntil) < new Date());
  const expiringSoon = sources.filter((s) => {
    if (!s.validUntil) return false;
    const daysUntil = Math.floor((new Date(s.validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 60;
  });

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{ position: "relative" }}
    >
      <AdvancedBanner />
      {dragOver && (
        <div className="hf-drop-overlay">
          <div className="hf-drop-card">
            <div className="hf-mb-sm" style={{ fontSize: 32 }}>&#128196;</div>
            <div className="hf-text-bold" style={{ fontSize: 16, color: "var(--text-primary)" }}>Drop to create material &amp; classify</div>
            <div className="hf-text-xs hf-text-muted hf-mt-xs">PDF, TXT, MD, JSON</div>
          </div>
        </div>
      )}

      {dropStatus.phase !== "idle" && (
        <div className={`hf-banner ${dropStatus.phase === "error" ? "hf-banner-error" : dropStatus.phase === "done" ? "hf-banner-success" : "hf-banner-info"}${dropStatus.phase === "creating" || dropStatus.phase === "classifying" ? " hf-glow-active" : ""}`}>
          {(dropStatus.phase === "creating" || dropStatus.phase === "classifying") && (
            <span className="hf-pulse-dot" style={{ background: "currentColor" }} />
          )}
          {dropStatus.message}
        </div>
      )}

      <ActiveJobsBanner onJobDone={fetchSources} />

      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="hf-flex hf-gap-md hf-flex-wrap hf-mb-md">
          {expired.length > 0 && (
            <div className="hf-banner hf-banner-error hf-text-sm hf-mb-0">
              <span className="hf-text-bold hf-text-error">{expired.length} expired</span>
              <span className="hf-text-error"> material{expired.length > 1 ? "s" : ""} need{expired.length === 1 ? "s" : ""} updating</span>
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="hf-banner hf-banner-warning hf-text-sm hf-mb-0">
              <span className="hf-text-bold hf-text-warning">{expiringSoon.length}</span>
              <span className="hf-text-warning"> material{expiringSoon.length > 1 ? "s" : ""} expiring within 60 days</span>
            </div>
          )}
        </div>
      )}

      <div className="hf-flex hf-gap-md hf-mb-md hf-flex-wrap">
        <input type="text" placeholder="Search materials..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="hf-input" style={{ width: 240 }}
        />
        <select value={filterTrust} onChange={(e) => setFilterTrust(e.target.value)}
          className="hf-input" style={{ width: "auto" }}>
          <option value="">All trust levels</option>
          {TRUST_LEVELS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
        </select>
        <label className="hf-checkbox-label">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <button onClick={() => setShowCreateForm(!showCreateForm)}
          className="hf-btn hf-btn-primary">
          + Add Material
        </button>
        <span className="hf-text-xs hf-text-muted">{filtered.length} material{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {showCreateForm && (
        <CreateSourceForm onCreated={() => { setShowCreateForm(false); fetchSources(); }} onCancel={() => setShowCreateForm(false)} />
      )}

      {loading ? (
        <div className="hf-flex hf-justify-center" style={{ padding: "24px 0" }}><div className="hf-spinner" /></div>
      ) : error ? (
        <div className="hf-banner hf-banner-error">Error: {error}</div>
      ) : filtered.length === 0 ? (
        <p className="hf-text-muted">No materials found. Add one to get started.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="hf-html-table">
            <thead>
              <tr className="hf-thead-border">
                <th className="cs-th">Material</th>
                <th className="cs-th">Type</th>
                <th className="cs-th">Trust Level</th>
                <th className="cs-th">Qualification</th>
                <th className="cs-th">Publisher</th>
                <th className="cs-th">Validity</th>
                <th className="cs-th">Used by</th>
                <th className="cs-th-right">Assertions</th>
                <th className="cs-th-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  isUploading={uploadSourceId === s.id}
                  onToggleUpload={() => setUploadSourceId(uploadSourceId === s.id ? null : s.id)}
                  onUploadDone={() => { setUploadSourceId(null); fetchSources(); }}
                  onRefresh={fetchSources}
                  status={statusMap[s.id] ?? null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
