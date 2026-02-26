"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { useBackgroundTaskQueue } from "@/components/shared/ContentJobQueue";
import { DOCUMENT_TYPES } from "../shared/badges";
import type { StepProps } from "../types";

export default function ExtractStep({ setData, getData, onNext, onPrev }: StepProps) {
  const { addExtractionJob } = useBackgroundTaskQueue();
  const sourceId = getData<string>("sourceId");
  const sourceName = getData<string>("sourceName");
  const hasFile = getData<boolean>("hasFile");

  const [phase, setPhase] = useState<"confirm" | "extracting" | "done" | "error">("confirm");
  const [documentType, setDocumentType] = useState("");
  const [extractedCount, setExtractedCount] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);
  const [vocabCount, setVocabCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [chunkProgress, setChunkProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Task ID for polling (UserTask ID returned from extract API as jobId)
  const [quickPreview, setQuickPreview] = useState<Array<{ text: string; category: string }>>([]);
  const [extractTaskId, setExtractTaskId] = useState<string | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  // Check for active extraction jobs on mount (re-entry)
  useEffect(() => {
    async function checkActiveJobs() {
      try {
        const res = await fetch("/api/tasks?status=in_progress");
        const data = await res.json();
        if (!data.ok) return;
        const job = (data.tasks || []).find(
          (t: any) => t.taskType === "extraction" && t.context?.sourceId === sourceId
        );
        if (job) {
          setPhase("extracting");
          setExtractTaskId(job.id);
          addExtractionJob(job.id, sourceId!, sourceName || "Content Extraction", "");
          // Start elapsed timer
          tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
        }
      } catch {}
    }
    if (sourceId) checkActiveJobs();
  }, [sourceId]);

  // Load source to get document type
  useEffect(() => {
    if (!sourceId) return;
    fetch(`/api/content-sources/${sourceId}`).then((r) => r.json()).then((data) => {
      if (data.source?.documentType) setDocumentType(data.source.documentType);
    }).catch(() => {});
  }, [sourceId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Poll extraction task using the shared hook
  const handleComplete = useCallback(async (task: PollableTask) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setExtractTaskId(null);
    setQuickPreview([]);

    // Capture warnings from task context
    const ctx = task.context || {};
    if (Array.isArray(ctx.warnings) && ctx.warnings.length > 0) {
      setWarnings(ctx.warnings);
    }

    // Fetch final counts for assertions, questions, vocabulary
    try {
      const [countRes, qRes, vRes] = await Promise.all([
        fetch(`/api/content-sources/${sourceId}/assertions?limit=1`),
        fetch(`/api/content-sources/${sourceId}/questions?limit=1`),
        fetch(`/api/content-sources/${sourceId}/vocabulary?limit=1`),
      ]);
      const [countData, qData, vData] = await Promise.all([
        countRes.json(), qRes.json(), vRes.json(),
      ]);
      const finalCount = countData.total || extractedCount;
      const qTotal = qData.total || 0;
      const vTotal = vData.total || 0;
      setExtractedCount(finalCount);
      setQuestionCount(qTotal);
      setVocabCount(vTotal);
      setData("assertionCount", finalCount);
      setData("questionCount", qTotal);
      setData("vocabCount", vTotal);
    } catch {
      // Use whatever counts we have from progress
    }
    setPhase("done");
  }, [sourceId, extractedCount, setData]);

  const handleError = useCallback((message: string) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setExtractTaskId(null);
    setError(message);
    setPhase("error");
  }, []);

  const handleProgress = useCallback((task: PollableTask) => {
    const ctx = task.context || {};
    setExtractedCount(ctx.extractedCount || 0);
    setChunkProgress({ current: ctx.currentChunk || 0, total: ctx.totalChunks || 0 });
    if (ctx.quickPreview?.length > 0) {
      setQuickPreview((prev) => prev.length === 0 ? ctx.quickPreview : prev);
    }
  }, []);

  useTaskPoll({
    taskId: extractTaskId,
    onComplete: handleComplete,
    onError: handleError,
    onProgress: handleProgress,
  });

  async function handleExtract() {
    setPhase("extracting");
    setError(null);
    try {
      // Ensure media asset exists
      const sourceRes = await fetch(`/api/content-sources/${sourceId}`);
      const sourceData = await sourceRes.json();

      if (!sourceData.source?.mediaAssets?.[0]) {
        throw new Error("No file found. Please go back to Add Source and upload a file.");
      }

      // Proceed with extraction
      const res = await fetch(`/api/content-sources/${sourceId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // The extract API returns jobId which IS a UserTask ID
      setExtractTaskId(data.jobId);
      addExtractionJob(data.jobId, sourceId!, sourceName || "Content Extraction", "");
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err: any) {
      setError(err.message);
      setPhase("error");
    }
  }

  async function handleChangeType(newType: string) {
    setDocumentType(newType);
    await fetch(`/api/content-sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentType: newType }),
    });
  }

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const pct = chunkProgress.total > 0 ? Math.round((chunkProgress.current / chunkProgress.total) * 100) : 0;

  if (!hasFile) return null;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
        Extract Teaching Points
      </h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 24px" }}>
        Confirm the document type below, then the AI will extract teaching points, questions, and vocabulary from <strong>{sourceName}</strong>.
      </p>

      {phase === "confirm" && (
        <div style={{
          padding: 24, borderRadius: 12, border: "1px solid var(--border-default)",
          background: "var(--surface-secondary)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Document Type:</span>
            <select
              value={documentType}
              onChange={(e) => handleChangeType(e.target.value)}
              className="hf-input"
              style={{ width: "auto" }}
            >
              {DOCUMENT_TYPES.map((d) => (
                <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={handleExtract}
              className="hf-btn hf-btn-primary"
              style={{ padding: "12px 32px", fontSize: 15, fontWeight: 700 }}
            >
              Extract Teaching Points
            </button>
            <button onClick={onPrev}
              className="hf-btn hf-btn-secondary"
              style={{ padding: "12px 24px" }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {phase === "extracting" && (
        <div style={{
          padding: 24, borderRadius: 12, border: "1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)",
          background: "color-mix(in srgb, var(--accent-primary) 4%, transparent)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", background: "var(--accent-primary)",
              animation: "extract-pulse 1.5s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              Extracting... {extractedCount > 0 ? `${extractedCount} teaching points found` : ""}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 14, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {timeStr}
            </span>
          </div>
          {chunkProgress.total > 0 && (
            <>
              <div style={{ height: 6, borderRadius: 3, background: "var(--surface-tertiary)", overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: "var(--accent-primary)",
                  width: `${pct}%`, transition: "width 0.5s ease-out",
                }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Chunk {chunkProgress.current}/{chunkProgress.total} ({pct}%)
              </div>
            </>
          )}
          {quickPreview.length > 0 && (
            <div className="hf-banner hf-banner-info hf-mt-sm">
              <p className="hf-text-sm hf-text-bold hf-mb-xs">
                Quick scan — {quickPreview.length} key points found
              </p>
              {quickPreview.map((item, i) => (
                <div key={i} className="hf-list-row hf-text-sm">{item.text}</div>
              ))}
              <p className="hf-text-xs hf-text-muted hf-mt-xs">Full enrichment running…</p>
            </div>
          )}
          <style>{`@keyframes extract-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
        </div>
      )}

      {phase === "done" && (() => {
        // Parse warnings into structured categories
        const skippedWarnings = warnings.filter((w) => w.startsWith("Skipped "));
        const linkedWarnings = warnings.filter((w) => w.startsWith("Linked "));
        const referenceWarnings = warnings.filter((w) => w.includes("reference content"));
        const figureWarnings = warnings.filter((w) => w.includes("fig:") || w.includes("Figure"));
        const otherWarnings = warnings.filter(
          (w) => !skippedWarnings.includes(w) && !linkedWarnings.includes(w) &&
                 !referenceWarnings.includes(w) && !figureWarnings.includes(w)
        );
        const hasInsights = skippedWarnings.length > 0 || linkedWarnings.length > 0 ||
                            referenceWarnings.length > 0 || otherWarnings.length > 0;

        return (
          <div className="hf-banner hf-banner-success" style={{
            padding: 24, borderRadius: 12, borderWidth: 2, flexDirection: "column", alignItems: "stretch",
          }}>
            {/* Main result */}
            <div style={{ textAlign: "center", marginBottom: hasInsights ? 20 : 16 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{"\u2705"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                {extractedCount} teaching points extracted
              </div>
              {(questionCount > 0 || vocabCount > 0) && (
                <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 4, fontSize: 14, color: "var(--text-secondary)" }}>
                  {questionCount > 0 && (
                    <span>{"\uD83D\uDCDD"} {questionCount} question{questionCount !== 1 ? "s" : ""}</span>
                  )}
                  {vocabCount > 0 && (
                    <span>{"\uD83D\uDCDA"} {vocabCount} vocabulary term{vocabCount !== 1 ? "s" : ""}</span>
                  )}
                </div>
              )}
            </div>

            {/* Extraction insights */}
            {hasInsights && (
              <div style={{
                padding: "12px 16px", borderRadius: 8,
                background: "color-mix(in srgb, var(--surface-primary) 70%, transparent)",
                marginBottom: 16, fontSize: 13, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Extraction details
                </div>
                {skippedWarnings.map((w, i) => (
                  <div key={`skip-${i}`} style={{ color: "var(--text-muted)" }}>
                    {"\u23ED\uFE0F"} {w}
                  </div>
                ))}
                {referenceWarnings.map((w, i) => (
                  <div key={`ref-${i}`} style={{ color: "var(--text-muted)" }}>
                    {"\uD83D\uDCCB"} {w}
                  </div>
                ))}
                {linkedWarnings.map((w, i) => (
                  <div key={`link-${i}`} style={{ color: "var(--text-muted)" }}>
                    {"\uD83D\uDD17"} {w}
                  </div>
                ))}
                {otherWarnings.map((w, i) => (
                  <div key={`other-${i}`} style={{ color: "var(--text-muted)" }}>
                    {w}
                  </div>
                ))}
              </div>
            )}

            {!hasInsights && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, textAlign: "center" }}>
                Ready for review.
              </div>
            )}

            <div style={{ textAlign: "center" }}>
              <button onClick={onNext}
                className="hf-btn hf-btn-primary"
                style={{ padding: "12px 32px", fontSize: 15, fontWeight: 700 }}
              >
                Continue to Review
              </button>
            </div>
          </div>
        );
      })()}

      {phase === "error" && (
        <div className="hf-banner hf-banner-error" style={{
          padding: 24, borderRadius: 12, flexDirection: "column", alignItems: "stretch", gap: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--status-error-text)" }}>
            Extraction failed: {error}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => { setPhase("confirm"); setError(null); }}
              className="hf-btn hf-btn-primary"
              style={{ padding: "10px 24px", fontSize: 13, fontWeight: 600 }}
            >
              Try Again
            </button>
            <button onClick={onPrev}
              className="hf-btn hf-btn-secondary"
              style={{ padding: "10px 24px", fontSize: 13 }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
