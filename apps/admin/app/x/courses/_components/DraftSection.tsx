"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

// ── DraftSection ──────────────────────────────────────
//
// Reusable collapsible section for the v3 course builder.
// Supports: collapsed/expanded toggle, badge, skeleton/ready/error states.
// Uses hf-draft-* CSS classes from globals.css.

export type DraftSectionStatus = "idle" | "loading" | "ready" | "error";

export interface DraftSectionProps {
  /** Section title shown in the header */
  title: string;
  /** Whether the section starts expanded (default: true) */
  defaultOpen?: boolean;
  /** Force open/closed from parent */
  open?: boolean;
  /** Called when user toggles the section */
  onToggle?: (open: boolean) => void;
  /** Badge element shown to the right of the title */
  badge?: ReactNode;
  /** Current status — drives the loading indicator in the header */
  status?: DraftSectionStatus;
  /** Error message shown when status is "error" */
  error?: string | null;
  /** Called when user clicks "Retry" on error state */
  onRetry?: () => void;
  /** Section content */
  children: ReactNode;
}

export function DraftSection({
  title,
  defaultOpen = true,
  open: controlledOpen,
  onToggle,
  badge,
  status = "ready",
  error,
  onRetry,
  children,
}: DraftSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? internalOpen;

  const toggle = () => {
    const next = !isOpen;
    if (controlledOpen === undefined) setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <div className="hf-draft-section">
      <div
        className="hf-draft-section-header"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="hf-draft-section-title">{title}</div>

        {status === "loading" && (
          <Loader2 size={14} className="hf-spinner" />
        )}

        {badge}

        <ChevronRight
          size={16}
          className={
            "hf-draft-section-chevron" +
            (isOpen ? " hf-draft-section-chevron-open" : "")
          }
        />
      </div>

      {isOpen && (
        <div className="hf-draft-section-body">
          {status === "error" && error ? (
            <div className="hf-banner hf-banner-error" style={{ marginBottom: 12 }}>
              <span>{error}</span>
              {onRetry && (
                <button className="hf-btn hf-btn-sm" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          ) : null}
          {children}
        </div>
      )}
    </div>
  );
}

/** Convenience badge components */
export function DraftBadge({
  variant = "muted",
  children,
}: {
  variant?: "info" | "success" | "muted";
  children: ReactNode;
}) {
  return (
    <span className={`hf-draft-badge hf-draft-badge-${variant}`}>
      {children}
    </span>
  );
}
