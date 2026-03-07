"use client";

import { useState, useId } from "react";
import { ChevronRight } from "lucide-react";

export interface CollapsibleCardProps {
  /** Header title text or ReactNode */
  title: React.ReactNode;
  /** Optional subtitle/hint below the header */
  hint?: string;
  /** "card" = standalone with border/bg, "embedded" = borderless toggle within parent */
  variant?: "card" | "embedded";
  /** Chevron size: "sm" (14px icon), "md" (16px, default), "lg" (20px) */
  chevronSize?: "sm" | "md" | "lg";
  /** Start expanded? Default: false */
  defaultOpen?: boolean;
  /** Controlled mode: external open state */
  open?: boolean;
  /** Controlled mode: called when toggle is clicked */
  onToggle?: (open: boolean) => void;
  /** Optional status indicator rendered inline with title (e.g. saving spinner) */
  status?: React.ReactNode;
  /** Extra className on the root element */
  className?: string;
  /** Content revealed when expanded */
  children: React.ReactNode;
}

const ICON_SIZE = { sm: 14, md: 16, lg: 20 } as const;

export function CollapsibleCard({
  title,
  hint,
  variant = "card",
  chevronSize = "md",
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  status,
  className,
  children,
}: CollapsibleCardProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const contentId = useId();

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  const chevronCls =
    "hf-chevron" +
    (chevronSize !== "md" ? ` hf-chevron--${chevronSize}` : "") +
    (isOpen ? " hf-chevron--open" : "");

  const rootCls = [
    variant === "card" ? "hf-expandable-card" : "hf-collapsible--embedded",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls}>
      <button
        type="button"
        className="hf-collapsible-header"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className={chevronCls}>
          <ChevronRight size={ICON_SIZE[chevronSize]} />
        </span>
        <span className="hf-collapsible-title">{title}</span>
        {status}
      </button>

      {hint && <div className="hf-collapsible-hint">{hint}</div>}

      {isOpen && (
        <div id={contentId} className="hf-collapsible-body">
          {children}
        </div>
      )}
    </div>
  );
}
