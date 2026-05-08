"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ConfigEditorToolbar } from "./ConfigEditorToolbar";
import { ConfigSection } from "./ConfigSection";
import { ConfigField } from "./ConfigField";
import { groupConfigKeys } from "./utils/groupConfigKeys";

interface SpecConfigEditorProps {
  configText: string;
  onConfigChange: (newJsonString: string) => void;
  disabled?: boolean;
  specRole?: string;
  outputType?: string;
}

/**
 * Smart spec config editor with progressive disclosure.
 *
 * Drop-in replacement for the raw JSON textarea.
 * Same contract: receives JSON string, emits JSON string.
 *
 * Three tiers:
 *   1. Essentials — booleans, sliders, key limits (always visible)
 *   2. Advanced — collapsible sections with summary badges
 *   3. JSON — raw textarea (always accessible via tab toggle)
 */
export function SpecConfigEditor({
  configText,
  onConfigChange,
  disabled,
}: SpecConfigEditorProps) {
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const sectionKeyRef = useRef(0);

  // Parse config from JSON string. Returns either the parsed object or an
  // error message — never sets state directly inside the memo (would risk an
  // infinite render loop). Errors are surfaced via the effect below.
  const parseResult = useMemo<{ value: Record<string, unknown> | null; error: string | null }>(() => {
    try {
      return { value: JSON.parse(configText || "{}") as Record<string, unknown>, error: null };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [configText]);
  const parsed = parseResult.value;
  useEffect(() => {
    setJsonError(parseResult.error);
  }, [parseResult.error]);

  // Group fields into Essential / Advanced sections
  const groups = useMemo(() => {
    if (!parsed) return [];
    return groupConfigKeys(parsed);
  }, [parsed]);

  // Update a single field by key, serialize back to JSON
  const updateField = useCallback(
    (key: string, newValue: unknown) => {
      if (!parsed) return;
      const updated = { ...parsed, [key]: newValue };
      onConfigChange(JSON.stringify(updated, null, 2));
    },
    [parsed, onConfigChange],
  );

  // Collapse all advanced sections (bump key to force re-render with collapsed=true)
  const handleCollapseAll = useCallback(() => {
    sectionKeyRef.current += 1;
    // Force re-render by toggling mode briefly — simpler than managing each section's state
    setMode("visual");
  }, []);

  // If config can't be parsed, force JSON mode
  if (jsonError && mode === "visual") {
    return (
      <div>
        <ConfigEditorToolbar mode="json" onModeChange={setMode} />
        <div
          style={{
            padding: "6px 10px",
            marginBottom: 6,
            borderRadius: 4,
            background: "var(--status-error-bg, #fef2f2)",
            color: "var(--status-error-text, #dc2626)",
            fontSize: 11,
          }}
        >
          Invalid JSON — fix in JSON mode: {jsonError}
        </div>
        <textarea
          value={configText}
          onChange={(e) => onConfigChange(e.target.value)}
          disabled={disabled}
          rows={10}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 11,
            border: "1px solid var(--status-error-border, #fca5a5)",
            borderRadius: 8,
            padding: 12,
            color: "var(--text-primary)",
            background: "var(--surface-primary, #fff)",
            resize: "vertical",
          }}
        />
      </div>
    );
  }

  // JSON mode — raw textarea (same as current behavior)
  if (mode === "json") {
    return (
      <div>
        <ConfigEditorToolbar mode="json" onModeChange={setMode} />
        <textarea
          value={configText}
          onChange={(e) => onConfigChange(e.target.value)}
          disabled={disabled}
          rows={12}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 11,
            border: jsonError
              ? "1px solid var(--status-error-border, #fca5a5)"
              : "1px solid var(--border-default, #d1d5db)",
            borderRadius: 8,
            padding: 12,
            color: "var(--text-primary)",
            background: disabled ? "var(--surface-disabled)" : "var(--surface-primary, #fff)",
            resize: "vertical",
          }}
          placeholder="{}"
        />
        {jsonError && (
          <div style={{ fontSize: 10, color: "var(--status-error-text, #ef4444)", marginTop: 4 }}>
            JSON Error: {jsonError}
          </div>
        )}
      </div>
    );
  }

  // Visual mode — progressive disclosure
  return (
    <div>
      <ConfigEditorToolbar mode="visual" onModeChange={setMode} onCollapseAll={handleCollapseAll} />
      {groups.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "12px 0", textAlign: "center" }}>
          Empty config — switch to JSON to add values
        </div>
      )}
      {groups.map((group) => (
        <ConfigSection
          key={`${group.name}-${sectionKeyRef.current}`}
          name={group.name}
          collapsed={group.collapsed}
        >
          {group.fields.map((field) => (
            <ConfigField
              key={field.key}
              fieldKey={field.key}
              value={field.value}
              onChange={(newVal) => updateField(field.key, newVal)}
              disabled={disabled}
            />
          ))}
        </ConfigSection>
      ))}
    </div>
  );
}
