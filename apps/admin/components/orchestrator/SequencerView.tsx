"use client";

import { useState, useCallback, useMemo } from "react";
import { FlowStepCard } from "./FlowStepCard";
import { ConfigField } from "@/components/config-editor/ConfigField";

interface SequencerViewProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled?: boolean;
}

type DetectedSequence = {
  path: string[];
  key: string;
  label: string;
  items: Record<string, unknown>[];
};

/**
 * Humanize a camelCase or snake_case key into a readable label.
 */
function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a contextual label from a path.
 * e.g. ["personas", "coach", "firstCallFlow", "phases"] → "Coach Phases"
 * e.g. ["firstCallFlow", "phases"] → "Phases"
 */
function labelFromPath(path: string[]): string {
  // Filter out numeric indices and common wrapper keys
  const meaningful = path.filter(
    (p) => !/^\d+$/.test(p) && !["config"].includes(p),
  );
  if (meaningful.length <= 1) return humanize(meaningful[0] || "items");

  const last = meaningful[meaningful.length - 1];
  // Find the most descriptive context key (skip generic wrappers)
  const contextKeys = meaningful.slice(0, -1).filter(
    (k) => !["firstCallFlow", "personas", "implementation", "parameters", "promptSlugs"].includes(k),
  );
  if (contextKeys.length > 0) {
    const ctx = humanize(contextKeys[contextKeys.length - 1]);
    return `${ctx} ${humanize(last)}`;
  }
  return humanize(last);
}

/**
 * Recursively scan a config object and find arrays of objects (sequences).
 * Returns them with their path for nested updates.
 *
 * Key behaviors:
 * - When an array of objects is found, also recurse into each item for nested sequences.
 * - If nested sequences are found, prefer those over the parent array.
 * - After collection, deduplicate: if two sequences have the same content (same JSON),
 *   keep only the one with the shorter path (the more direct reference).
 */
function detectSequencesRaw(
  obj: Record<string, unknown>,
  path: string[] = [],
  depth = 0,
): DetectedSequence[] {
  if (depth > 5) return [];
  const sequences: DetectedSequence[] = [];

  for (const [key, val] of Object.entries(obj)) {
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      val.every((x) => typeof x === "object" && x !== null && !Array.isArray(x))
    ) {
      // Found an array of objects. Check if items have nested sequences.
      const nestedSequences: DetectedSequence[] = [];
      for (let i = 0; i < val.length; i++) {
        const item = val[i] as Record<string, unknown>;
        const nested = detectSequencesRaw(item, [...path, key, String(i)], depth + 1);
        nestedSequences.push(...nested);
      }

      if (nestedSequences.length > 0) {
        // Prefer nested sequences (e.g. parameters[0].config.stages over parameters)
        sequences.push(...nestedSequences);
      } else {
        // No nested sequences — this array IS the sequence
        const fullPath = [...path, key];
        sequences.push({
          path: fullPath,
          key,
          label: labelFromPath(fullPath),
          items: val as Record<string, unknown>[],
        });
      }
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      sequences.push(
        ...detectSequencesRaw(val as Record<string, unknown>, [...path, key], depth + 1),
      );
    }
  }

  return sequences;
}

/**
 * Detect sequences and deduplicate.
 * When the same data appears at multiple paths (e.g. top-level `stages`
 * AND `parameters[0].config.stages`), keep only the shortest path.
 */
function detectSequences(obj: Record<string, unknown>): DetectedSequence[] {
  const raw = detectSequencesRaw(obj);

  // Deduplicate by content — keep shorter path when two have identical items.
  // Uses JSON of first two items as fingerprint to distinguish same-key sequences
  // with different content (e.g. coach phases vs tutor phases).
  const byHash = new Map<string, DetectedSequence>();
  for (const seq of raw) {
    const sample = seq.items.slice(0, 2);
    const fingerprint = seq.key + "|" + seq.items.length + "|" + JSON.stringify(sample).slice(0, 500);

    const existing = byHash.get(fingerprint);
    if (!existing || seq.path.length < existing.path.length) {
      byHash.set(fingerprint, seq);
    }
  }

  return Array.from(byHash.values());
}

/**
 * Set a value at a nested path in an object (immutably).
 * Handles both object keys and numeric array indices.
 */
function setAtPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj;
  if (path.length === 1) {
    if (Array.isArray(obj)) {
      const idx = parseInt(path[0], 10);
      if (!isNaN(idx)) {
        const copy = [...obj];
        copy[idx] = value;
        return copy as unknown as Record<string, unknown>;
      }
    }
    return { ...obj, [path[0]]: value };
  }
  const [head, ...rest] = path;
  const child = Array.isArray(obj)
    ? (obj[parseInt(head, 10)] as Record<string, unknown>) || {}
    : (obj[head] as Record<string, unknown>) || {};
  const updated = setAtPath(child, rest, value);

  if (Array.isArray(obj)) {
    const idx = parseInt(head, 10);
    const copy = [...obj];
    copy[idx] = updated;
    return copy as unknown as Record<string, unknown>;
  }
  return { ...obj, [head]: updated };
}

/**
 * Collect keys in the config that are NOT arrays-of-objects (scalars, simple arrays, etc.)
 */
function collectScalarKeys(
  config: Record<string, unknown>,
  sequencePaths: Set<string>,
): Array<{ key: string; value: unknown }> {
  const scalars: Array<{ key: string; value: unknown }> = [];
  for (const [key, val] of Object.entries(config)) {
    if (sequencePaths.has(key)) continue;
    scalars.push({ key, value: val });
  }
  return scalars;
}

export function SequencerView({ config, onChange, disabled }: SequencerViewProps) {
  const [search, setSearch] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [activeSequenceIdx, setActiveSequenceIdx] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Detect all sequences in the config
  const sequences = useMemo(() => detectSequences(config), [config]);

  // Collect top-level scalar fields (non-sequence)
  const sequenceTopKeys = useMemo(
    () => new Set(sequences.map((s) => s.path[0])),
    [sequences],
  );
  const scalarFields = useMemo(
    () => collectScalarKeys(config, sequenceTopKeys),
    [config, sequenceTopKeys],
  );

  const activeSeq = sequences[activeSequenceIdx] || null;

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!activeSeq) return [];
    if (!search.trim()) return activeSeq.items.map((item, i) => ({ item, originalIndex: i }));
    const q = search.toLowerCase();
    return activeSeq.items
      .map((item, i) => ({ item, originalIndex: i }))
      .filter(({ item }) =>
        Object.values(item).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(q),
        ),
      );
  }, [activeSeq, search]);

  // Update a single item in the active sequence
  const updateItem = useCallback(
    (itemIndex: number, key: string, value: unknown) => {
      if (!activeSeq) return;
      const newItems = activeSeq.items.map((item, i) =>
        i === itemIndex ? { ...item, [key]: value } : item,
      );
      onChange(setAtPath(config, activeSeq.path, newItems));
    },
    [activeSeq, config, onChange],
  );

  // Remove an item
  const removeItem = useCallback(
    (itemIndex: number) => {
      if (!activeSeq) return;
      const newItems = activeSeq.items.filter((_, i) => i !== itemIndex);
      const renumbered = newItems.map((item, i) => {
        if ("order" in item && typeof item.order === "number") {
          return { ...item, order: (i + 1) * 10 };
        }
        return item;
      });
      onChange(setAtPath(config, activeSeq.path, renumbered));
    },
    [activeSeq, config, onChange],
  );

  // Add a new item
  const addItem = useCallback(() => {
    if (!activeSeq) return;
    const template: Record<string, unknown> = {};
    if (activeSeq.items.length > 0) {
      for (const [k, v] of Object.entries(activeSeq.items[0])) {
        if (typeof v === "string") template[k] = "";
        else if (typeof v === "number") template[k] = 0;
        else if (typeof v === "boolean") template[k] = false;
        else if (Array.isArray(v)) template[k] = [];
        else if (v && typeof v === "object") template[k] = {};
        else template[k] = null;
      }
      if ("order" in template) {
        const maxOrder = Math.max(...activeSeq.items.map((it) => (typeof it.order === "number" ? it.order : 0)));
        template.order = maxOrder + 10;
      }
    }
    const newItems = [...activeSeq.items, template];
    onChange(setAtPath(config, activeSeq.path, newItems));
  }, [activeSeq, config, onChange]);

  // Move item up/down
  const moveItem = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (!activeSeq || toIdx < 0 || toIdx >= activeSeq.items.length) return;
      const newItems = [...activeSeq.items];
      const [moved] = newItems.splice(fromIdx, 1);
      newItems.splice(toIdx, 0, moved);
      const renumbered = newItems.map((item, i) => {
        if ("order" in item && typeof item.order === "number") {
          return { ...item, order: (i + 1) * 10 };
        }
        return item;
      });
      onChange(setAtPath(config, activeSeq.path, renumbered));
    },
    [activeSeq, config, onChange],
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => setDragFrom(index), []);
  const handleDragOver = useCallback((index: number) => setDragOver(index), []);
  const handleDrop = useCallback(() => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      moveItem(dragFrom, dragOver);
    }
    setDragFrom(null);
    setDragOver(null);
  }, [dragFrom, dragOver, moveItem]);

  // Update a scalar field
  const updateScalar = useCallback(
    (key: string, value: unknown) => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  if (sequences.length === 0 && scalarFields.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary, #9ca3af)" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>&nbsp;</div>
        <div style={{ fontSize: 13 }}>No config data to display</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Switch to the JSON tab to add configuration</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      {/* Sequence selector pills (if multiple sequences detected) */}
      {sequences.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            padding: "0 0 12px",
            marginBottom: 12,
            borderBottom: "1px solid var(--border-default, #e5e7eb)",
          }}
        >
          {sequences.map((seq, idx) => (
            <button
              key={seq.path.join(".")}
              onClick={() => { setActiveSequenceIdx(idx); setSearch(""); }}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: "1px solid",
                borderColor:
                  idx === activeSequenceIdx
                    ? "var(--accent-primary, #3b82f6)"
                    : "var(--border-default, #e5e7eb)",
                background:
                  idx === activeSequenceIdx
                    ? "var(--accent-primary, #3b82f6)"
                    : "var(--surface-primary, #fff)",
                color:
                  idx === activeSequenceIdx
                    ? "var(--button-primary-text, #fff)"
                    : "var(--text-secondary, #6b7280)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {seq.label}
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  opacity: idx === activeSequenceIdx ? 0.8 : 0.6,
                  fontWeight: 400,
                }}
              >
                {seq.items.length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Search + actions bar */}
      {activeSeq && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-default, #e5e7eb)",
              background: "var(--surface-primary, #fff)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary, #9ca3af)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${activeSeq.label.toLowerCase()}...`}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                color: "var(--text-primary, #111827)",
                width: "100%",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--text-tertiary)", padding: 0 }}
              >
                ×
              </button>
            )}
          </div>

          {/* Flow label */}
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-secondary, #6b7280)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3" /><line x1="12" y1="8" x2="12" y2="16" /><circle cx="12" cy="19" r="3" />
            </svg>
            {filteredItems.length} step{filteredItems.length !== 1 ? "s" : ""}
          </div>

          {!disabled && (
            <button
              onClick={addItem}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid var(--accent-primary, #3b82f6)",
                background: "color-mix(in srgb, var(--accent-primary, #3b82f6) 10%, transparent)",
                color: "var(--accent-primary, #3b82f6)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              + Add Step
            </button>
          )}
        </div>
      )}

      {/* Visual flow */}
      {activeSeq && (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            paddingRight: 4,
            paddingBottom: 20,
          }}
        >
          {/* Flow container with left-side timeline */}
          <div style={{ position: "relative", paddingLeft: 36 }}>
            {/* Vertical timeline line */}
            {filteredItems.length > 1 && (
              <div
                style={{
                  position: "absolute",
                  left: 15,
                  top: 20,
                  bottom: 20,
                  width: 2,
                  background: "linear-gradient(to bottom, var(--accent-primary, #3b82f6), color-mix(in srgb, var(--accent-primary, #3b82f6) 30%, transparent))",
                  borderRadius: 1,
                }}
              />
            )}

            {filteredItems.map(({ item, originalIndex }, displayIdx) => (
              <div key={originalIndex} style={{ position: "relative", marginBottom: displayIdx < filteredItems.length - 1 ? 0 : 0 }}>
                {/* Step node on timeline */}
                <div
                  style={{
                    position: "absolute",
                    left: -36,
                    top: 16,
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    background: "var(--accent-primary, #3b82f6)",
                    color: "var(--button-primary-text, #fff)",
                    boxShadow: "0 2px 6px rgba(59,130,246,0.3)",
                    zIndex: 2,
                  }}
                >
                  {originalIndex + 1}
                </div>

                {/* Arrow connector between cards */}
                {displayIdx < filteredItems.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      left: -24,
                      bottom: -4,
                      zIndex: 1,
                    }}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--accent-primary, #3b82f6)">
                      <path d="M4 8 L0 3 L8 3 Z" />
                    </svg>
                  </div>
                )}

                {/* The step card */}
                <FlowStepCard
                  item={item}
                  index={originalIndex}
                  total={activeSeq.items.length}
                  onUpdate={(key, val) => updateItem(originalIndex, key, val)}
                  onRemove={() => removeItem(originalIndex)}
                  onMoveUp={() => moveItem(originalIndex, originalIndex - 1)}
                  onMoveDown={() => moveItem(originalIndex, originalIndex + 1)}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragTarget={dragOver === originalIndex && dragFrom !== originalIndex}
                  disabled={disabled}
                />
              </div>
            ))}

            {/* End node */}
            {filteredItems.length > 0 && (
              <div style={{ position: "relative", paddingTop: 4 }}>
                <div
                  style={{
                    position: "absolute",
                    left: -33,
                    top: 4,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "color-mix(in srgb, var(--accent-primary, #3b82f6) 15%, transparent)",
                    border: "2px solid var(--accent-primary, #3b82f6)",
                    zIndex: 2,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary, #3b82f6)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
            )}

            {filteredItems.length === 0 && search && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-tertiary, #9ca3af)", fontSize: 12 }}>
                No steps match &quot;{search}&quot;
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scalar (non-sequence) fields — collapsible */}
      {scalarFields.length > 0 && (
        <div
          style={{
            borderTop: sequences.length > 0 ? "1px solid var(--border-default, #e5e7eb)" : "none",
            paddingTop: sequences.length > 0 ? 12 : 0,
            marginTop: sequences.length > 0 ? 8 : 0,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-secondary, #6b7280)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: settingsOpen ? 10 : 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              width: "100%",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transition: "transform 0.15s",
                transform: settingsOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Settings
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>
              {scalarFields.length}
            </span>
          </button>
          {settingsOpen &&
            scalarFields.map(({ key, value }) => (
              <ConfigField
                key={key}
                fieldKey={key}
                value={value}
                onChange={(newVal) => updateScalar(key, newVal)}
                disabled={disabled}
              />
            ))}
        </div>
      )}
    </div>
  );
}
