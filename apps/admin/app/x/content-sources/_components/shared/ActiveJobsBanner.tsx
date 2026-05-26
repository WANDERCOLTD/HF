"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ActiveJob = {
  id: string;
  status: string;
  context: {
    sourceId?: string;
    fileName?: string;
    currentChunk?: number;
    totalChunks?: number;
    extractedCount?: number;
    importedCount?: number;
    duplicatesSkipped?: number;
    warnings?: string[];
    error?: string;
  };
  startedAt: string;
  updatedAt: string;
};

export function ActiveJobsBanner({ onJobDone }: { onJobDone: () => void }) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActiveJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?status=in_progress");
      const data = await res.json();
      if (!data.ok) return;
      const extractionJobs = (data.tasks || []).filter(
        (t: any) => t.taskType === "extraction"
      );
      setJobs(extractionJobs);
      if (extractionJobs.length === 0 && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchActiveJobs();
    const startedAt = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    pollRef.current = setInterval(() => {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setJobs([]); // Clear stale jobs
        return;
      }
      fetchActiveJobs();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchActiveJobs]);

  const prevJobIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(jobs.map((j) => j.id));
    if (prevJobIds.current.size > 0 && prevJobIds.current.size > currentIds.size) {
      onJobDone();
    }
    prevJobIds.current = currentIds;
  }, [jobs, onJobDone]);

  if (jobs.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {jobs.map((job) => {
        const ctx = job.context || {};
        const pct = ctx.totalChunks && ctx.totalChunks > 0
          ? Math.round(((ctx.currentChunk || 0) / ctx.totalChunks) * 100)
          : 0;
        // eslint-disable-next-line react-hooks/purity -- live elapsed display in a polling banner; rerenders every 3s tick when jobs[] updates, so Date.now() is intentionally evaluated on each render to advance the seconds counter
        const elapsed = Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        return (
          <div
            key={job.id}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--accent-primary) 6%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)",
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent-primary)",
                  animation: "activejob-pulse 1.5s ease-in-out infinite",
                }}
              />
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {ctx.fileName ? `Extracting: ${ctx.fileName}` : "Extracting..."}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {timeStr}
              </span>
            </div>
            {ctx.totalChunks && ctx.totalChunks > 0 && (
              <div style={{ height: 4, borderRadius: 2, background: "var(--surface-tertiary)", overflow: "hidden", marginBottom: 4 }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    background: "linear-gradient(90deg, var(--accent-primary), var(--accent-primary))",
                    width: `${pct}%`,
                    transition: "width 0.5s ease-out",
                  }}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
              {ctx.totalChunks ? <span>Chunk {ctx.currentChunk}/{ctx.totalChunks}</span> : null}
              {ctx.extractedCount ? <span>{ctx.extractedCount} assertions</span> : null}
              {(ctx.duplicatesSkipped ?? 0) > 0 && <span>{ctx.duplicatesSkipped} dupes skipped</span>}
            </div>
          </div>
        );
      })}
      <style>{`@keyframes activejob-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}
