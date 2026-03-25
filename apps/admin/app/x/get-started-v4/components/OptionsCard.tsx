"use client";

/**
 * OptionsCard — Inline structured option panel for V4 conversational wizard.
 *
 * Renders as a card in the message stream (not above the input bar).
 * Supports radio (single-select, auto-submits) and checklist (multi-select + Confirm).
 * Always shows "Something else" escape and Skip for optional fields.
 * Full keyboard navigation: ↑↓ navigate, Space toggle, Enter confirm, Esc dismiss.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Pencil, ChevronLeft, ChevronRight } from "lucide-react";

// ── Types ────────────────────────────────────────────────

export interface OptionDef {
  value: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface OptionsPanel {
  question: string;
  dataKey: string;
  mode: "radio" | "checklist";
  required?: boolean;
  fieldPicker?: boolean;
  options: OptionDef[];
}

interface OptionsCardProps {
  panel: OptionsPanel;
  onSelect: (value: string | string[], displayText: string) => void;
  onSkip: () => void;
  onSomethingElse: () => void;
}

const PAGE_SIZE = 6;

// ── Component ────────────────────────────────────────────

export function OptionsCard({ panel, onSelect, onSkip, onSomethingElse }: OptionsCardProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const options = panel.options || [];
  const totalPages = Math.ceil(options.length / PAGE_SIZE);
  const pageOptions = options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = pageOptions.length;

  // Auto-focus the card on mount
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // focusedIndex is reset to 0 inside setPage call sites (prev/next buttons + keyboard handlers)

  const handleRadioSelect = useCallback(
    (opt: OptionDef) => {
      onSelect(opt.value, opt.label);
    },
    [onSelect],
  );

  const handleChecklistConfirm = useCallback(() => {
    if (selected.size === 0) return;
    const values = Array.from(selected);
    const labels = values
      .map((v) => options.find((o) => o.value === v)?.label ?? v)
      .join(", ");
    onSelect(values, labels);
  }, [selected, options, onSelect]);

  const toggleSelected = useCallback((value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, pageCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case " ":
          e.preventDefault();
          if (panel.mode === "radio") {
            handleRadioSelect(pageOptions[focusedIndex]);
          } else {
            toggleSelected(pageOptions[focusedIndex].value);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (panel.mode === "radio") {
            handleRadioSelect(pageOptions[focusedIndex]);
          } else if (e.metaKey || e.ctrlKey) {
            handleChecklistConfirm();
          } else {
            toggleSelected(pageOptions[focusedIndex].value);
          }
          break;
        case "Escape":
          e.preventDefault();
          onSomethingElse();
          break;
      }
    },
    [panel.mode, pageOptions, focusedIndex, pageCount, handleRadioSelect, toggleSelected, handleChecklistConfirm, onSomethingElse],
  );

  return (
    <div
      ref={cardRef}
      className="cv4-options-card"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={panel.question}
    >
      {/* Header */}
      <div className="cv4-options-header">
        <span className="cv4-options-question">{panel.question}</span>
        {totalPages > 1 && (
          <span className="cv4-options-pagination">
            {page + 1} of {totalPages}
          </span>
        )}
      </div>

      {/* Options list */}
      <ul className="cv4-options-list" role="listbox" aria-multiselectable={panel.mode === "checklist"}>
        {pageOptions.map((opt, idx) => {
          const isFocused = focusedIndex === idx;
          const isSelected = selected.has(opt.value);

          const letter = String.fromCharCode(65 + page * PAGE_SIZE + idx);
          return (
            <li
              key={opt.value}
              className={
                "cv4-option-row" +
                (isFocused ? " cv4-option-row--focused" : "") +
                (isSelected ? " cv4-option-row--selected" : "")
              }
              role="option"
              aria-selected={panel.mode === "checklist" || panel.fieldPicker ? isSelected : undefined}
              onClick={() => {
                setFocusedIndex(idx);
                if (panel.mode === "radio" && !panel.fieldPicker) {
                  handleRadioSelect(opt);
                } else {
                  toggleSelected(opt.value);
                }
              }}
              onMouseEnter={() => setFocusedIndex(idx)}
            >
              {panel.fieldPicker ? (
                <span className={`cv4-option-checkbox${isSelected ? " cv4-option-checkbox--checked" : ""}`} aria-hidden="true" />
              ) : panel.mode === "radio" ? (
                <span className="cv4-option-number">{page * PAGE_SIZE + idx + 1}</span>
              ) : (
                <span className={`cv4-option-checkbox${isSelected ? " cv4-option-checkbox--checked" : ""}`} aria-hidden="true" />
              )}
              <div className="cv4-option-body">
                <div className="cv4-option-label-row">
                  <span className="cv4-option-label">
                    {panel.fieldPicker && <span className="cv4-option-letter">{letter} — </span>}
                    {opt.label}
                  </span>
                  {opt.recommended && (
                    <span className="cv4-option-recommended">Recommended</span>
                  )}
                </div>
                <span className="cv4-option-desc">{opt.description}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="cv4-options-pages">
          <button
            type="button"
            className="cv4-options-page-btn"
            onClick={() => { setPage((p) => Math.max(p - 1, 0)); setFocusedIndex(0); }}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <button
            type="button"
            className="cv4-options-page-btn"
            onClick={() => { setPage((p) => Math.min(p + 1, totalPages - 1)); setFocusedIndex(0); }}
            disabled={page === totalPages - 1}
            aria-label="Next page"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Footer */}
      {panel.fieldPicker ? (
        <div className="cv4-options-footer cv4-options-footer--picker">
          <button
            type="button"
            className="cv4-options-escape"
            onClick={onSkip}
          >
            Looks good — build it
          </button>
          <button
            type="button"
            className="cv4-options-confirm-btn"
            disabled={selected.size === 0}
            onClick={handleChecklistConfirm}
          >
            {selected.size > 0 ? `${selected.size} ` : ""}Change this ›
          </button>
        </div>
      ) : (
        <div className="cv4-options-footer">
          <div className="cv4-options-footer-left">
            {panel.mode === "checklist" && (
              <button
                type="button"
                className="cv4-options-confirm-btn"
                disabled={selected.size === 0}
                onClick={handleChecklistConfirm}
              >
                Confirm{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
            )}
            <button
              type="button"
              className="cv4-options-escape"
              onClick={onSomethingElse}
            >
              <Pencil size={11} />
              Something else
            </button>
            {!panel.required && (
              <button
                type="button"
                className="cv4-options-skip"
                onClick={onSkip}
              >
                Skip
              </button>
            )}
          </div>
          <div className="cv4-options-hints">
            <span>↑↓ navigate</span>
            <span>·</span>
            <span>{panel.mode === "checklist" ? "Space toggle" : "Enter select"}</span>
            <span>·</span>
            <span>Esc dismiss</span>
          </div>
        </div>
      )}
    </div>
  );
}
