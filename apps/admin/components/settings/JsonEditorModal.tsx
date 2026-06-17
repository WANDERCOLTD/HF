"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Save } from "lucide-react";

interface JsonEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  label: string;
  settingKey: string;
  initialText: string;
  onSave: (key: string, parsed: unknown) => Promise<void>;
}

export function JsonEditorModal({
  isOpen,
  onClose,
  label,
  settingKey,
  initialText,
  onSave,
}: JsonEditorModalProps) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-sync the textarea to the latest `initialText` whenever the modal
  // is opened OR the parent's snapshot changes while open. Without this
  // the modal would hold its first-mount text even after the parent
  // refetched a fresh playbookConfig — produces the stale-read fingerprint
  // the operator reported on 2026-06-17 (toggle ON in UI, modal still
  // showed `false` until a hard page refresh).
  useEffect(() => {
    if (!isOpen) return;
    setText(initialText);
    setError("");
  }, [isOpen, initialText]);

  const isDirty = text !== initialText;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (isDirty) {
      const ok = window.confirm(
        "Discard unsaved changes to this setting? Click Cancel to keep editing.",
      );
      if (!ok) return;
    }
    onClose();
  }, [isDirty, onClose, saving]);

  // Esc closes the modal (with warn-if-unsaved). Capture-phase listener
  // so we win over nested editors that also bind Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, requestClose]);

  if (!isOpen) return null;

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
      onClick={requestClose}
      data-testid="hf-json-editor-modal-backdrop"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: 16,
          padding: 24,
          width: "90%",
          maxWidth: 700,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            {label}
          </h3>
          <button
            onClick={requestClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
            }}
            aria-label="Close (Esc)"
            title="Close (Esc)"
            data-testid="hf-json-editor-modal-close"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, fontFamily: "monospace" }}>
          {settingKey}
          {isDirty && (
            <span style={{ marginLeft: 8, color: "var(--accent-primary)" }}>
              • Unsaved
            </span>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          style={{
            flex: 1,
            minHeight: 300,
            padding: 16,
            borderRadius: 10,
            border: error
              ? "2px solid var(--status-error-text)"
              : "1px solid var(--border-default)",
            background: "var(--surface-secondary)",
            color: "var(--text-primary)",
            fontSize: 13,
            fontFamily: "monospace",
            lineHeight: 1.5,
            resize: "vertical",
          }}
          data-testid="hf-json-editor-modal-textarea"
        />

        {error && (
          <div style={{ fontSize: 12, color: "var(--status-error-text)", marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            onClick={requestClose}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "var(--surface-secondary)",
              color: "var(--text-primary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              try {
                const parsed = JSON.parse(text);
                setSaving(true);
                await onSave(settingKey, parsed);
                onClose();
              } catch (err) {
                if (err instanceof SyntaxError) {
                  setError("Invalid JSON — please fix syntax errors before saving");
                } else {
                  setError(err instanceof Error ? err.message : "Failed to save");
                }
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent-primary)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
            data-testid="hf-json-editor-modal-save"
          >
            <Save size={14} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
