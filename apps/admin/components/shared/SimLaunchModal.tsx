"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowLeft, Loader2 } from "lucide-react";
import { CallerPicker } from "@/components/shared/CallerPicker";

interface SimLaunchModalProps {
  playbookId: string;
  domainId: string;
  domainName: string;
  onClose: () => void;
  /** Called before navigating to sim (e.g. wizard endFlow) */
  onBeforeNavigate?: () => void;
}

export function SimLaunchModal({
  playbookId,
  domainId,
  domainName,
  onClose,
  onBeforeNavigate,
}: SimLaunchModalProps) {
  const router = useRouter();
  const [view, setView] = useState<"pick" | "create">("pick");
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);
  const [newCallerName, setNewCallerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const navigateToSim = (callerId: string) => {
    onBeforeNavigate?.();
    onClose();
    router.push(`/x/sim/${callerId}?playbookId=${playbookId}&domainId=${domainId}`);
  };

  const handlePickAndLaunch = () => {
    if (!selectedCallerId) return;
    navigateToSim(selectedCallerId);
  };

  const handleCreate = async () => {
    if (!newCallerName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/callers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCallerName.trim(), domainId, playbookId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create caller");
      navigateToSim(data.caller.id);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create caller");
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, var(--text-primary) 40%, transparent)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="hf-card"
        style={{ width: 480, padding: 0, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border-default)",
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Try a Call
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Select a caller from {domainName}
            </p>
          </div>
          <button
            className="hf-btn hf-btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: 4, marginTop: -4, marginRight: -4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px 24px", minHeight: 200 }}>
          {view === "pick" ? (
            <CallerPicker
              value={selectedCallerId}
              onChange={(id) => setSelectedCallerId(id || null)}
              domainId={domainId}
              placeholder="Search callers..."
              autoFocus
              onCreateNew={() => setView("create")}
            />
          ) : (
            <div>
              <button
                className="hf-btn hf-btn-ghost hf-btn-sm"
                onClick={() => { setView("pick"); setCreateError(null); }}
                style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}
              >
                <ArrowLeft size={14} />
                Back to caller list
              </button>
              <div className="hf-label" style={{ marginBottom: 6 }}>
                Test caller name
              </div>
              <input
                className="hf-input"
                type="text"
                value={newCallerName}
                onChange={(e) => setNewCallerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !creating) handleCreate(); }}
                placeholder="e.g. Test Student"
                autoFocus
                style={{ width: "100%" }}
              />
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                Will be added to {domainName}
              </p>
              {createError && (
                <div className="hf-banner hf-banner-error" style={{ marginTop: 12 }}>
                  {createError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "16px 24px",
          borderTop: "1px solid var(--border-default)",
        }}>
          <button className="hf-btn hf-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {view === "pick" ? (
            <button
              className="hf-btn hf-btn-primary"
              onClick={handlePickAndLaunch}
              disabled={!selectedCallerId}
            >
              Start Sim
            </button>
          ) : (
            <button
              className="hf-btn hf-btn-primary"
              onClick={handleCreate}
              disabled={!newCallerName.trim() || creating}
            >
              {creating ? (
                <>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />
                  Creating...
                </>
              ) : (
                "Create & Start Sim"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
