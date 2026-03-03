"use client";

/**
 * OptionPanel — single panel that appears above the chat input bar.
 *
 * Supports:
 *   - Radio mode (single-select) — user clicks an option → auto-submits
 *   - Checklist mode (multi-select) — user toggles options → confirms with button
 *   - Sliders mode — personality slider controls
 *   - Upload mode — delegates to PackUploadStep
 *   - Actions mode — primary/secondary action buttons
 *
 * One panel at a time — no tabs. The system enforces one show_* tool per AI turn.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Check, ArrowRight, Rocket, Upload } from "lucide-react";
import type { SliderDef } from "./wizard-schema";

// ── Types ────────────────────────────────────────────────

export interface OptionDef {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface OptionsPanel {
  type: "options";
  question: string;
  dataKey: string;
  mode: "radio" | "checklist";
  options: OptionDef[];
}

export interface SlidersPanel {
  type: "sliders";
  question: string;
  sliders: SliderDef[];
}

export interface UploadPanel {
  type: "upload";
  question: string;
}

export interface ActionsPanel {
  type: "actions";
  question: string;
  primary: { label: string; icon?: string };
  secondary: { label: string; icon?: string };
}

export type PanelConfig = OptionsPanel | SlidersPanel | UploadPanel | ActionsPanel;

interface OptionPanelProps {
  /** Single panel to render */
  panel: PanelConfig;
  /** Called when user selects an option / submits */
  onSubmit: (dataKey: string, value: unknown, displayText: string) => void;
  /** Called for action buttons */
  onAction?: (action: "primary" | "secondary") => void;
  /** Upload component to render (passed by parent to avoid circular deps) */
  uploadComponent?: React.ReactNode;
}

export function OptionPanel({ panel, onSubmit, onAction, uploadComponent }: OptionPanelProps) {
  return (
    <div className="gs-option-panel">
      <div className="gs-option-panel-content">
        {panel.type === "options" && (
          <OptionsContent panel={panel} onSubmit={onSubmit} />
        )}
        {panel.type === "sliders" && (
          <SlidersContent panel={panel} onSubmit={onSubmit} />
        )}
        {panel.type === "upload" && (
          <div className="gs-option-upload">
            <div className="gs-option-header">{panel.question}</div>
            {uploadComponent}
          </div>
        )}
        {panel.type === "actions" && (
          <ActionsContent panel={panel} onAction={onAction} />
        )}
      </div>
    </div>
  );
}

// ── Options (radio / checklist) ─────────────────────────

function OptionsContent({ panel, onSubmit }: { panel: OptionsPanel; onSubmit: OptionPanelProps["onSubmit"] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const isRadio = panel.mode === "radio";

  // Auto-focus the list when panel appears
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (value: string, label: string) => {
      if (isRadio) {
        onSubmit(panel.dataKey, value, label);
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
      }
    },
    [isRadio, onSubmit, panel.dataKey],
  );

  const handleConfirm = useCallback(() => {
    const values = Array.from(selected);
    const labels = panel.options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label)
      .join(", ");
    onSubmit(panel.dataKey, values, labels);
  }, [selected, onSubmit, panel.dataKey, panel.options]);

  // Keyboard navigation: Arrow Up/Down to move, Space to select, Enter to confirm
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const len = panel.options.length;
      if (!len) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => (i + 1) % len);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => (i - 1 + len) % len);
          break;
        case " ": {
          e.preventDefault();
          const opt = panel.options[focusedIndex];
          if (opt) handleSelect(opt.value, opt.label);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (!isRadio && selected.size > 0) {
            handleConfirm();
          } else if (isRadio) {
            const opt = panel.options[focusedIndex];
            if (opt) handleSelect(opt.value, opt.label);
          }
          break;
        }
      }
    },
    [panel.options, focusedIndex, isRadio, selected.size, handleSelect, handleConfirm],
  );

  return (
    <div className="gs-option-group">
      <div className="gs-option-header">{panel.question}</div>
      <div
        ref={listRef}
        className="gs-option-list"
        tabIndex={0}
        role="listbox"
        onKeyDown={handleKeyDown}
      >
        {panel.options.map((opt, idx) => {
          const isSelected = selected.has(opt.value);
          const isFocused = idx === focusedIndex;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={
                "gs-option-item" +
                (isSelected ? " gs-option-item--selected" : "") +
                (isFocused ? " gs-option-item--focused" : "")
              }
              onClick={() => {
                setFocusedIndex(idx);
                handleSelect(opt.value, opt.label);
              }}
              onMouseEnter={() => setFocusedIndex(idx)}
            >
              <div className="gs-option-radio">
                {isRadio ? (
                  <div className={`gs-option-radio-dot${isSelected ? " gs-option-radio-dot--active" : ""}`} />
                ) : (
                  <div className={`gs-option-check${isSelected ? " gs-option-check--active" : ""}`}>
                    {isSelected && <Check size={12} />}
                  </div>
                )}
              </div>
              <div className="gs-option-text">
                <div className="gs-option-label">
                  {opt.label}
                  {opt.recommended && <span className="gs-option-rec">(Recommended)</span>}
                </div>
                <div className="gs-option-desc">{opt.description}</div>
              </div>
            </button>
          );
        })}
      </div>
      {!isRadio && selected.size > 0 && (
        <button type="button" className="hf-btn hf-btn-primary gs-option-confirm" onClick={handleConfirm}>
          Confirm ({selected.size})
        </button>
      )}
      <div className="gs-option-hint">
        Use <kbd>↑</kbd><kbd>↓</kbd> to navigate, <kbd>space</kbd> to select{!isRadio ? ", enter to confirm" : ""}
      </div>
    </div>
  );
}

// ── Sliders ─────────────────────────────────────────────

function SlidersContent({ panel, onSubmit }: { panel: SlidersPanel; onSubmit: OptionPanelProps["onSubmit"] }) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(panel.sliders.map((s) => [s.key, 50])),
  );

  const handleChange = useCallback((key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleApply = useCallback(() => {
    onSubmit("behaviorTargets", values, "Personality configured");
  }, [values, onSubmit]);

  return (
    <div className="gs-option-group">
      <div className="gs-option-header">{panel.question}</div>
      <div className="gs-option-sliders">
        {panel.sliders.map((s) => (
          <div key={s.key} className="gs-option-slider-row">
            <div className="gs-option-slider-labels">
              <span className="gs-option-slider-end">{s.low}</span>
              <span className="gs-option-slider-center">{s.label}</span>
              <span className="gs-option-slider-end">{s.high}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={values[s.key] ?? 50}
              onChange={(e) => handleChange(s.key, Number(e.target.value))}
              className="gs-option-slider-input"
            />
          </div>
        ))}
      </div>
      <button type="button" className="hf-btn hf-btn-primary gs-option-confirm" onClick={handleApply}>
        Apply
      </button>
    </div>
  );
}

// ── Actions ─────────────────────────────────────────────

function ActionsContent({ panel, onAction }: { panel: ActionsPanel; onAction?: OptionPanelProps["onAction"] }) {
  const getIcon = (name?: string) => {
    switch (name) {
      case "Rocket": return <Rocket size={16} />;
      case "ArrowRight": return <ArrowRight size={16} />;
      case "Upload": return <Upload size={16} />;
      default: return null;
    }
  };

  return (
    <div className="gs-option-group">
      <div className="gs-option-header">{panel.question}</div>
      <div className="gs-option-actions">
        <button
          type="button"
          className="hf-btn hf-btn-primary gs-option-action"
          onClick={() => onAction?.("primary")}
        >
          {getIcon(panel.primary.icon)}
          {panel.primary.label}
        </button>
        <button
          type="button"
          className="hf-btn hf-btn-secondary gs-option-action"
          onClick={() => onAction?.("secondary")}
        >
          {getIcon(panel.secondary.icon)}
          {panel.secondary.label}
        </button>
      </div>
    </div>
  );
}
