"use client";

import { useState, useEffect } from "react";
import { useTerminology } from "@/contexts/TerminologyContext";

interface PromptPreviewData {
  promptSummary: string;
  voicePrompt: string;
  llmPrompt: any;
  metadata: any;
  createdPreviewCaller: boolean;
}

// ── Reusable inline content (used by both modal and wizard step) ──

interface PromptPreviewContentProps {
  domainId: string;
  domainName?: string;
  callerId?: string;
  open: boolean;
}

export function PromptPreviewContent({
  domainId,
  domainName,
  callerId,
  open,
}: PromptPreviewContentProps) {
  const { plural } = useTerminology();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PromptPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "voice" | "json">("summary");

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    setData(null);
    setTab("summary");

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/domains/${domainId}/preview-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(callerId ? { callerId } : {}),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "Failed to generate preview");
        setData(json);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || "Failed to generate preview");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, domainId, callerId]);

  if (!open) return null;

  return (
    <>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
        {(["summary", "voice", "json"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 16px",
              background: "none",
              border: "none",
              borderBottom: tab === t
                ? "2px solid var(--accent-primary)"
                : "2px solid transparent",
              color: tab === t
                ? "var(--accent-primary)"
                : "var(--text-muted)",
              fontWeight: tab === t ? 600 : 400,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t === "summary" ? "Full Summary" : t === "voice" ? "Voice Prompt" : "Raw JSON"}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          Composing first-call prompt...
        </div>
      ) : error ? (
        <div style={{
          padding: 16,
          background: "var(--status-error-bg)",
          color: "var(--status-error-text)",
          borderRadius: 8,
          fontSize: 14,
        }}>
          {error}
        </div>
      ) : data ? (
        <>
          {/* Metadata bar */}
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: "var(--surface-secondary)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--text-primary)" }}>
              {data.metadata.sectionsActivated.length}
            </strong>{" "}sections activated,{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {data.metadata.sectionsSkipped.length}
            </strong>{" "}skipped
            {data.metadata.identitySpec && (
              <> &middot; Identity: <strong style={{ color: "var(--text-primary)" }}>{data.metadata.identitySpec}</strong></>
            )}
            {data.metadata.contentSpec && (
              <> &middot; Content: <strong style={{ color: "var(--text-primary)" }}>{data.metadata.contentSpec}</strong></>
            )}
            {data.metadata.playbooksUsed.length > 0 && (
              <> &middot; {plural("playbook")}: {data.metadata.playbooksUsed.join(", ")}</>
            )}
            <> &middot; {data.metadata.loadTimeMs}ms load, {data.metadata.transformTimeMs}ms transform</>
            {data.createdPreviewCaller && (
              <div style={{ marginTop: 4, fontStyle: "italic" }}>
                Note: Created a preview caller (no existing callers in this domain)
              </div>
            )}
          </div>

          {/* Section provenance labels */}
          {data.metadata.sectionsActivated.length > 0 && (
            <div style={{
              marginBottom: 16,
              padding: 12,
              background: "var(--surface-secondary)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 2,
            }}>
              <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-xs">Sections</div>
              {data.metadata.sectionsActivated.map((section: string) => {
                const provenanceMap: Record<string, string> = {
                  pedagogy_mode: "subject",
                  teaching_style: "subject",
                  subject_methodology: "profile",
                  course_instructions: "uploaded",
                };
                const provenance = provenanceMap[section];
                return (
                  <div key={section} style={{ display: "inline-block", marginRight: 12 }}>
                    <span>{section}</span>
                    {provenance && (
                      <span className="hf-text-xs hf-text-muted" style={{ marginLeft: 4, fontStyle: "italic" }}>
                        {provenance}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab content */}
          {tab === "summary" && (
            <pre style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.6,
              margin: 0,
              color: "var(--text-primary)",
            }}>
              {data.promptSummary}
            </pre>
          )}
          {tab === "voice" && (
            <pre style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              lineHeight: 1.5,
              margin: 0,
              padding: 16,
              background: "var(--surface-secondary)",
              borderRadius: 8,
              color: "var(--text-primary)",
            }}>
              {data.voicePrompt}
            </pre>
          )}
          {tab === "json" && (
            <pre style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              lineHeight: 1.4,
              margin: 0,
              padding: 16,
              background: "var(--surface-secondary)",
              borderRadius: 8,
              color: "var(--text-primary)",
            }}>
              {JSON.stringify(data.llmPrompt, null, 2)}
            </pre>
          )}

          {/* Copy button */}
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => {
                const text =
                  tab === "json"
                    ? JSON.stringify(data.llmPrompt, null, 2)
                    : tab === "voice"
                      ? data.voicePrompt || ""
                      : data.promptSummary || "";
                navigator.clipboard.writeText(text).catch(() => {});
              }}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                background: "var(--surface-secondary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-strong)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Copy to Clipboard
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}

// ── Modal wrapper (backwards-compatible) ──

interface PromptPreviewModalProps {
  domainId: string;
  domainName?: string;
  open: boolean;
  onClose: () => void;
}

export function PromptPreviewModal({
  domainId,
  domainName,
  open,
  onClose,
}: PromptPreviewModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface-primary)",
          borderRadius: 12,
          width: 900,
          maxWidth: "90vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Prompt Preview &mdash; {domainName}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "4px 8px",
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          <PromptPreviewContent
            domainId={domainId}
            domainName={domainName}
            open={open}
          />
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-default)",
          display: "flex",
          justifyContent: "flex-end",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              background: "var(--surface-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
