"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Pencil } from "lucide-react";

export interface EditableTitleProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  as?: "h1" | "h2";
  style?: React.CSSProperties;
  disabled?: boolean;
  /**
   * Visual variant. `dark` inverts colours for use on dark backgrounds
   * (e.g. the WhatsApp-style green SIM header). Default `light`.
   */
  variant?: "light" | "dark";
}

export function EditableTitle({
  value,
  onSave,
  as: Tag = "h2",
  style,
  disabled = false,
  variant = "light",
}: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when value prop changes (e.g. after refetch)
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Auto-focus and select text when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      // Revert on error
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        cancel();
      }
    },
    [save, cancel]
  );

  const defaultStyles: Record<"h1" | "h2", React.CSSProperties> = {
    h1: { fontSize: 28, fontWeight: 700 },
    h2: { fontSize: 20, fontWeight: 700 },
  };

  const isDark = variant === "dark";
  const inputBg = isDark
    ? "color-mix(in srgb, #fff 18%, transparent)"
    : "var(--surface-primary, #fff)";
  const inputColor = isDark ? "#fff" : "var(--text-primary, #111)";
  const inputBorder = isDark
    ? "1px solid color-mix(in srgb, #fff 50%, transparent)"
    : "1px solid var(--accent-primary, #3b82f6)";
  const displayColor = isDark ? "#fff" : "var(--text-primary)";
  const pencilColor = isDark
    ? "color-mix(in srgb, #fff 70%, transparent)"
    : "var(--text-muted)";

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        disabled={saving}
        style={{
          ...defaultStyles[Tag],
          margin: 0,
          padding: "2px 6px",
          border: inputBorder,
          borderRadius: 4,
          outline: "none",
          background: inputBg,
          color: inputColor,
          width: "100%",
          maxWidth: 500,
          boxSizing: "border-box",
          opacity: saving ? 0.6 : 1,
          ...style,
        }}
      />
    );
  }

  return (
    <Tag
      onClick={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
              setEditing(true);
            }
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...defaultStyles[Tag],
        margin: 0,
        color: displayColor,
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
      title={disabled ? undefined : "Click to rename"}
    >
      {value}
      {!disabled && hovered && (
        <Pencil
          size={Tag === "h1" ? 16 : 14}
          style={{ color: pencilColor, flexShrink: 0 }}
        />
      )}
    </Tag>
  );
}
