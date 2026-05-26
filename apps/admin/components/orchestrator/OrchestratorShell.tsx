"use client";

import { useState, useEffect, useCallback } from "react";
import { SequencerView } from "@/components/orchestrator/SequencerView";
import { EnvelopeEditor, type EnvelopeData } from "@/components/orchestrator/EnvelopeEditor";
import { SpecConfigEditor } from "@/components/config-editor";

// ============================================================================
// Types
// ============================================================================

export type SpecDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: string;
  outputType: string;
  specRole: string | null;
  specType: string;
  domain: string | null;
  config: Record<string, unknown> | null;
  promptTemplate: string | null;
  isActive: boolean;
  isLocked: boolean;
  lockedReason: string | null;
  isDeletable: boolean;
  priority: number;
  version: string | null;
  compiledAt: string | null;
  compiledSetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeatureSet = {
  id: string;
  featureId: string;
  name: string;
  rawSpec: Record<string, unknown> | null;
};

type TabDef = { id: string; label: string };

const BASE_TABS: TabDef[] = [
  { id: "designer", label: "Designer" },
  { id: "story", label: "Story" },
  { id: "context", label: "Context" },
  { id: "acceptance", label: "Acceptance" },
  { id: "constraints", label: "Constraints" },
  { id: "related", label: "Related" },
  { id: "json", label: "JSON" },
];

// ============================================================================
// OrchestratorShell — reusable spec editor with sub-tabs
// ============================================================================

export function OrchestratorShell({
  spec,
  featureSet,
  onSave,
  saving,
  extraTabs,
  renderExtraTab,
}: {
  spec: SpecDetail;
  featureSet: FeatureSet | null;
  onSave: (updates: { config?: Record<string, unknown>; rawSpec?: Record<string, unknown>; metadata?: Partial<SpecDetail> }) => void;
  saving: boolean;
  /** Additional sub-tabs to show (e.g. "Live View" for PIPELINE-001) */
  extraTabs?: TabDef[];
  /** Renderer for extra tab content */
  renderExtraTab?: (tabId: string) => React.ReactNode;
}) {
  const allTabs = extraTabs
    ? [BASE_TABS[0], ...extraTabs, ...BASE_TABS.slice(1)]
    : BASE_TABS;

  const [activeTab, setActiveTab] = useState(allTabs[0].id);
  const [editedConfig, setEditedConfig] = useState<Record<string, unknown>>(spec.config || {});
  const [editedEnvelope, setEditedEnvelope] = useState<EnvelopeData>({});
  const [editedName, setEditedName] = useState(spec.name);
  const [editedActive, setEditedActive] = useState(spec.isActive);
  const [jsonText, setJsonText] = useState("");

  // Reset state when spec changes
  useEffect(() => {
    setEditedConfig(spec.config || {});
    setEditedName(spec.name);
    setEditedActive(spec.isActive);

    const raw = featureSet?.rawSpec || {};
    setEditedEnvelope({
      story: (raw as any).story,
      context: (raw as any).context,
      acceptanceCriteria: (raw as any).acceptanceCriteria,
      constraints: (raw as any).constraints,
      related: (raw as any).related,
    });

    setJsonText(JSON.stringify(spec.config || {}, null, 2));
  }, [spec, featureSet]);

  // Track changes
  const hasConfigChanges = JSON.stringify(editedConfig) !== JSON.stringify(spec.config || {});
  const hasEnvelopeChanges = (() => {
    const raw = featureSet?.rawSpec || {};
    const orig: EnvelopeData = {
      story: (raw as any).story,
      context: (raw as any).context,
      acceptanceCriteria: (raw as any).acceptanceCriteria,
      constraints: (raw as any).constraints,
      related: (raw as any).related,
    };
    return JSON.stringify(editedEnvelope) !== JSON.stringify(orig);
  })();
  const hasMetadataChanges = editedName !== spec.name || editedActive !== spec.isActive;
  const hasChanges = hasConfigChanges || hasEnvelopeChanges || hasMetadataChanges;

  const handleSave = useCallback(() => {
    const updates: Parameters<typeof onSave>[0] = {};
    if (hasConfigChanges) updates.config = editedConfig;
    if (hasEnvelopeChanges) {
      const rawSpec = { ...(featureSet?.rawSpec || {}), ...editedEnvelope };
      updates.rawSpec = rawSpec as Record<string, unknown>;
    }
    if (hasMetadataChanges) {
      updates.metadata = { name: editedName, isActive: editedActive };
    }
    onSave(updates);
  }, [editedConfig, editedEnvelope, editedName, editedActive, hasConfigChanges, hasEnvelopeChanges, hasMetadataChanges, featureSet, onSave]);

  const handleDiscard = useCallback(() => {
    setEditedConfig(spec.config || {});
    setEditedName(spec.name);
    setEditedActive(spec.isActive);
    const raw = featureSet?.rawSpec || {};
    setEditedEnvelope({
      story: (raw as any).story,
      context: (raw as any).context,
      acceptanceCriteria: (raw as any).acceptanceCriteria,
      constraints: (raw as any).constraints,
      related: (raw as any).related,
    });
    setJsonText(JSON.stringify(spec.config || {}, null, 2));
    // setX dispatchers are stable by React contract; listed so React Compiler
    // can preserve manual memoization (react-hooks/preserve-manual-memoization).
  }, [spec, featureSet, setEditedConfig, setEditedName, setEditedActive, setEditedEnvelope, setJsonText]);

  const handleJsonChange = useCallback((newJson: string) => {
    setJsonText(newJson);
    try {
      const parsed = JSON.parse(newJson);
      setEditedConfig(parsed);
    } catch {
      // Invalid JSON, don't update config
    }
    // setX dispatchers stable per React; listed for compiler preservation.
  }, [setJsonText, setEditedConfig]);

  const isExtraTab = extraTabs?.some((t) => t.id === activeTab);
  const isEnvelopeTab = ["story", "context", "acceptance", "constraints", "related"].includes(activeTab);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Metadata bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-default, #e5e7eb)",
          background: "var(--surface-primary, #fff)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            fontWeight: 700,
            color: "var(--accent-primary, #3b82f6)",
            background: "color-mix(in srgb, var(--accent-primary, #3b82f6) 10%, transparent)",
            padding: "3px 8px",
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          {spec.slug}
        </span>

        <input
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 700,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary, #111827)",
            minWidth: 0,
          }}
        />

        {spec.version && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-tertiary, #9ca3af)",
              background: "var(--surface-secondary, #f3f4f6)",
              padding: "2px 6px",
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            v{spec.version}
          </span>
        )}

        <button
          onClick={() => setEditedActive(!editedActive)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid",
            borderColor: editedActive ? "var(--status-success-border, #22c55e)" : "var(--border-default)",
            background: editedActive ? "var(--status-success-bg)" : "var(--surface-secondary)",
            color: editedActive ? "var(--status-success-text)" : "var(--text-muted)",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: editedActive ? "var(--status-success-text)" : "var(--border-default)" }} />
          {editedActive ? "Active" : "Inactive"}
        </button>

        {spec.isLocked && (
          <span
            style={{
              fontSize: 10,
              color: "var(--status-warning-text)",
              background: "var(--status-warning-bg, #fffbeb)",
              padding: "2px 6px",
              borderRadius: 4,
              flexShrink: 0,
            }}
            title={spec.lockedReason || "Locked"}
          >
            Locked
          </span>
        )}

        {hasChanges && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleDiscard}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-default, #e5e7eb)",
                background: "var(--surface-primary, #fff)",
                color: "var(--text-secondary, #6b7280)",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: "1px solid var(--accent-primary, #3b82f6)",
                background: "var(--accent-primary, #3b82f6)",
                color: "var(--button-primary-text, #fff)",
                fontSize: 12,
                cursor: saving ? "wait" : "pointer",
                fontWeight: 600,
                opacity: saving ? 0.7 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* Sub-tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "0 16px",
          borderBottom: "1px solid var(--border-default, #e5e7eb)",
          background: "var(--surface-primary, #fff)",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {allTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const hasDot =
            (tab.id === "designer" && hasConfigChanges) ||
            (["story", "context", "acceptance", "constraints", "related"].includes(tab.id) && hasEnvelopeChanges);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "10px 14px",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent-primary, #3b82f6)" : "2px solid transparent",
                background: "none",
                color: isActive ? "var(--accent-primary, #3b82f6)" : "var(--text-secondary, #6b7280)",
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                position: "relative",
                whiteSpace: "nowrap",
                transition: "color 0.15s",
              }}
            >
              {tab.label}
              {hasDot && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 4,
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--status-warning-text)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          overflowY: activeTab === "designer" || isExtraTab ? "hidden" : "auto",
          padding: isExtraTab ? 0 : 16,
        }}
      >
        {activeTab === "designer" && (
          <SequencerView
            config={editedConfig}
            onChange={setEditedConfig}
            disabled={spec.isLocked}
          />
        )}

        {activeTab === "json" && (
          <SpecConfigEditor
            configText={jsonText}
            onConfigChange={handleJsonChange}
            disabled={spec.isLocked}
          />
        )}

        {isEnvelopeTab && (
          <EnvelopeEditor
            tab={activeTab as "story" | "context" | "acceptance" | "constraints" | "related"}
            envelope={editedEnvelope}
            onChange={setEditedEnvelope}
            disabled={spec.isLocked}
          />
        )}

        {isExtraTab && renderExtraTab?.(activeTab)}
      </div>
    </div>
  );
}
