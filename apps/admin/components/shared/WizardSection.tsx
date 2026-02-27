"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import "./wizard-section.css";

export type SectionStatus = "locked" | "active" | "done";

interface WizardSectionProps {
  id: string;
  stepNumber: number;
  status: SectionStatus;
  title: string;
  hint?: string;
  /** Short label shown before the summary text when done, e.g. "Institution" */
  summaryLabel?: string;
  /** Content shown in the collapsed done row */
  summary?: React.ReactNode;
  /** Called when the section is expanded from done state — triggers cascade in parent */
  onEdit?: () => void;
  /** Show sparkles icon to indicate AI auto-suggest in this section. */
  aiEnhanced?: boolean;
  /** Animate the sparkles icon while AI is fetching. */
  aiLoading?: boolean;
  /**
   * Whether to render the step header (number + title + hint) above the children.
   * Default: true. Set to false when the step component renders its own title.
   */
  showHeader?: boolean;
  /** Content shown when section is active */
  children: React.ReactNode;
}

export default function WizardSection({
  id,
  stepNumber,
  status,
  title,
  hint,
  summaryLabel,
  summary,
  onEdit,
  aiEnhanced,
  aiLoading,
  showHeader = true,
  children,
}: WizardSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Scroll section to top of viewport when it becomes active
  useEffect(() => {
    if (status === "active" && sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [status]);

  // Reset expanded state when section transitions away from "done"
  // (e.g. when cascade re-locks it or it becomes active again)
  const isExpanded = status === "done" && expanded;

  if (status === "done") {
    return (
      <div
        ref={sectionRef}
        className={`ws-wrap${isExpanded ? " ws-wrap--expanded" : ""}`}
        data-status="done"
        data-section={id}
      >
        <div
          className="ws-summary-row"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <div className="ws-done-icon">✓</div>
          {summaryLabel && (
            <span className="ws-summary-label">{summaryLabel}</span>
          )}
          <span className="ws-summary-text">{summary}</span>
          <div className={`hf-chevron${isExpanded ? " hf-chevron--open" : ""}`}>
            <ChevronRight size={18} />
          </div>
        </div>
        {isExpanded && (
          <div className="ws-body ws-body--done">
            {children}
            {onEdit && (
              <div className="ws-edit-row">
                <button
                  className="ws-edit-inline-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(false);
                    onEdit();
                  }}
                  type="button"
                >
                  Make changes
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div ref={sectionRef} className="ws-wrap" data-status="locked" data-section={id}>
        <div className="ws-locked-header">
          <p className="ws-locked-title">{title}</p>
        </div>
      </div>
    );
  }

  // active
  return (
    <div ref={sectionRef} className="ws-wrap" data-status="active" data-section={id}>
      {showHeader && (
        <div className="ws-header">
          <p className="ws-step-number">Step {stepNumber}</p>
          <h2 className="ws-title">
            {title}
            {aiEnhanced && (
              <span className={`hf-field-hint-ai${aiLoading ? " hf-field-hint-ai--loading" : ""}`} title="AI-enhanced — suggestions appear when you leave a field">
                <Sparkles size={15} />
              </span>
            )}
          </h2>
          {hint && <p className="ws-hint">{hint}</p>}
        </div>
      )}
      <div className="ws-body">{children}</div>
    </div>
  );
}
