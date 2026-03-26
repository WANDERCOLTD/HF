"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScrollText,
  X,
  AlertTriangle,
  Check,
  RotateCcw,
  UserCircle,
  Fingerprint,
  FileType,
  FileOutput,
  Network,
  Scissors,
  Gauge,
  GraduationCap,
  Target,
  Layers,
} from "lucide-react";
import "./meta-prompts.css";

// ------------------------------------------------------------------
// Types (mirrors PromptState from prompt-settings.ts)
// ------------------------------------------------------------------

interface PromptState {
  slug: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  sourceFile: string;
  sourceLines: string;
  templateVars: string[];
  isEditable: boolean;
  defaultValue: string;
  currentValue: string;
  isOverridden: boolean;
  editGuidance?: string;
}

// ------------------------------------------------------------------
// Icon resolver
// ------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  UserCircle,
  Fingerprint,
  FileType,
  FileOutput,
  Network,
  Scissors,
  Gauge,
  GraduationCap,
  Target,
  Layers,
};

function PromptIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <ScrollText size={size} />;
  return <Icon size={size} />;
}

// ------------------------------------------------------------------
// Category labels
// ------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  voice: "Voice",
  extraction: "Extraction",
  identity: "Identity",
  sim: "Learn",
  admin: "Admin",
};

// ------------------------------------------------------------------
// Main Page
// ------------------------------------------------------------------

export default function MetaPromptsPage() {
  const [prompts, setPrompts] = useState<PromptState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [editingPrompt, setEditingPrompt] = useState<PromptState | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/meta-prompts");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setPrompts(data.prompts);
    } catch (err: any) {
      setError(err.message || "Failed to load prompts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  // Clear save message after 3s
  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  const handleSave = useCallback(
    async (slug: string, value: string) => {
      try {
        const res = await fetch("/api/meta-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, value }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        setEditingPrompt(null);
        setSaveMessage({ type: "success", text: "Prompt saved — takes effect within 30 seconds" });
        await fetchPrompts();
      } catch (err: any) {
        throw err; // Let the modal handle the error display
      }
    },
    [fetchPrompts],
  );

  const handleReset = useCallback(
    async (slug: string) => {
      if (!confirm("Reset this prompt to its code default? Your custom version will be deleted.")) return;
      try {
        const res = await fetch(`/api/meta-prompts?slug=${slug}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        setSaveMessage({ type: "success", text: "Prompt reset to default" });
        await fetchPrompts();
      } catch (err: any) {
        setSaveMessage({ type: "error", text: err.message || "Failed to reset" });
      }
    },
    [fetchPrompts],
  );

  // Get unique categories from data
  const categories = [...new Set(prompts.map((p) => p.category))];
  const filtered = activeTab === "all" ? prompts : prompts.filter((p) => p.category === activeTab);

  return (
    <div className="mp-page">
      {/* Header */}
      <div className="mp-header">
        <h1 className="hf-page-title">Meta Prompts</h1>
        <p className="hf-page-subtitle">View and edit system prompts that affect AI behaviour</p>
      </div>

      {/* Save indicator */}
      {saveMessage && (
        <div className={`mp-save-indicator ${saveMessage.type === "success" ? "mp-save-success" : "mp-save-error"}`}>
          {saveMessage.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          {saveMessage.text}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mp-empty">
          <div className="hf-spinner" />
          <p>Loading prompts...</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="hf-banner hf-banner-error">
          {error}
          <button className="hf-btn hf-btn-secondary" onClick={fetchPrompts}>
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="mp-tabs">
            <button
              className={`mp-tab ${activeTab === "all" ? "mp-tab-active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              All ({prompts.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`mp-tab ${activeTab === cat ? "mp-tab-active" : ""}`}
                onClick={() => setActiveTab(cat)}
              >
                {CATEGORY_LABELS[cat] || cat} ({prompts.filter((p) => p.category === cat).length})
              </button>
            ))}
          </div>

          {/* Cards */}
          {filtered.length === 0 ? (
            <div className="mp-empty">No prompts in this category</div>
          ) : (
            <div className="mp-grid">
              {filtered.map((prompt) => (
                <PromptCard
                  key={prompt.slug}
                  prompt={prompt}
                  onEdit={() => setEditingPrompt(prompt)}
                  onReset={() => handleReset(prompt.slug)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      {editingPrompt && (
        <EditPromptModal
          prompt={editingPrompt}
          onClose={() => setEditingPrompt(null)}
          onSave={handleSave}
          onReset={() => {
            handleReset(editingPrompt.slug);
            setEditingPrompt(null);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Prompt Card
// ------------------------------------------------------------------

function PromptCard({
  prompt,
  onEdit,
  onReset,
}: {
  prompt: PromptState;
  onEdit: () => void;
  onReset: () => void;
}) {
  const charCount = prompt.currentValue.length.toLocaleString();

  return (
    <div className="mp-card">
      <div className="mp-card-header">
        <div className="mp-card-icon">
          <PromptIcon name={prompt.icon} />
        </div>
        <div className="mp-card-title-area">
          <div className="mp-card-title">{prompt.label}</div>
          <span className={`mp-badge ${prompt.isOverridden ? "mp-badge-override" : "mp-badge-default"}`}>
            {prompt.isOverridden ? "DB Override" : "Default"}
          </span>
        </div>
      </div>

      <div className="mp-card-desc">{prompt.description}</div>

      <div className="mp-card-meta">
        <span>{charCount} chars</span>
        <span>·</span>
        <span>{prompt.sourceFile.split("/").slice(-1)[0]}</span>
      </div>

      {prompt.templateVars.length > 0 && (
        <div className="mp-card-vars">
          {prompt.templateVars.map((v) => (
            <span key={v} className="mp-var">
              {`{{${v}}}`}
            </span>
          ))}
        </div>
      )}

      <div className="mp-card-actions">
        <button className="hf-btn hf-btn-secondary" onClick={onEdit}>
          {prompt.isEditable ? "Edit" : "View"}
        </button>
        {prompt.isOverridden && (
          <button className="hf-btn hf-btn-destructive" onClick={onReset}>
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Edit Modal
// ------------------------------------------------------------------

function EditPromptModal({
  prompt,
  onClose,
  onSave,
  onReset,
}: {
  prompt: PromptState;
  onClose: () => void;
  onSave: (slug: string, value: string) => Promise<void>;
  onReset: () => void;
}) {
  const [value, setValue] = useState(prompt.currentValue);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Client-side template var validation
  useEffect(() => {
    if (prompt.templateVars.length === 0) {
      setValidationError(null);
      return;
    }
    const missing = prompt.templateVars.filter((v) => !value.includes(`{{${v}}}`));
    if (missing.length > 0) {
      setValidationError(`Missing required template variable${missing.length > 1 ? "s" : ""}: ${missing.map((v) => `{{${v}}}`).join(", ")}`);
    } else {
      setValidationError(null);
    }
  }, [value, prompt.templateVars]);

  const handleSave = async () => {
    if (validationError || !prompt.isEditable) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(prompt.slug, value);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const hasChanges = value !== prompt.currentValue;
  const canSave = prompt.isEditable && hasChanges && !validationError && value.trim().length > 0;

  return (
    <div className="mp-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mp-modal">
        {/* Header */}
        <div className="mp-modal-header">
          <h2 className="mp-modal-title">
            {prompt.isEditable ? "Edit" : "View"}: {prompt.label}
          </h2>
          <button className="mp-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="mp-modal-desc">{prompt.description}</p>

        {/* Warning */}
        {prompt.isEditable && (
          <div className="mp-warning">
            <AlertTriangle size={16} />
            Changes take effect within 30 seconds and affect all future AI operations using this prompt.
          </div>
        )}

        {/* Template vars */}
        {prompt.templateVars.length > 0 && (
          <div className="mp-vars-info">
            <span>Required template variables:</span>
            {prompt.templateVars.map((v) => (
              <span key={v} className="mp-var">
                {`{{${v}}}`}
              </span>
            ))}
          </div>
        )}

        {/* Edit guidance */}
        {prompt.editGuidance && prompt.isEditable && (
          <div className="mp-vars-info">{prompt.editGuidance}</div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="mp-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={!prompt.isEditable}
          spellCheck={false}
        />

        {/* Validation error */}
        {validationError && <div className="mp-validation-error">{validationError}</div>}

        {/* Save error */}
        {saveError && <div className="mp-validation-error">{saveError}</div>}

        {/* Char count */}
        <div className="mp-char-count">
          <span className={hasChanges ? "mp-char-changed" : ""}>
            {value.length.toLocaleString()} chars
          </span>
          {hasChanges && <span> (default: {prompt.defaultValue.length.toLocaleString()})</span>}
        </div>

        {/* Source reference */}
        <div className="mp-source">
          Source: {prompt.sourceFile}:{prompt.sourceLines}
        </div>

        {/* Footer */}
        {prompt.isEditable && (
          <div className="mp-modal-footer">
            <div>
              {prompt.isOverridden && (
                <button className="hf-btn hf-btn-destructive" onClick={onReset}>
                  <RotateCcw size={14} />
                  Reset to Default
                </button>
              )}
            </div>
            <div className="mp-modal-footer-right">
              <button className="hf-btn hf-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="hf-btn hf-btn-primary" onClick={handleSave} disabled={!canSave || saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* View-only footer */}
        {!prompt.isEditable && (
          <div className="mp-modal-footer">
            <div />
            <button className="hf-btn hf-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
