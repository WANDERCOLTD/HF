"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import "./tooltip.css";

interface TooltipProps {
  /** Tooltip body — string or arbitrary node. */
  content: React.ReactNode;
  /** Delay before showing on hover. Default 500ms — matches the Linear pattern. */
  delayMs?: number;
  /** Side-effect-free wrap around any single child element. */
  children: React.ReactNode;
}

/**
 * Canonical delayed-hover tooltip primitive (#689).
 *
 * 500ms delay before show prevents flicker on quick mouse-overs; disappears
 * immediately on mouse-leave. Pure CSS positioning + animation. Uses CSS
 * vars only — no hardcoded hex, no inline styles for static properties.
 *
 * Replaces ad-hoc tooltip impls in AIConfigButton.tsx and SpecRoleBadge.tsx
 * (their migration is out of scope per the #689 spec).
 */
export function Tooltip({ content, delayMs = 500, children }: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelShow = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    cancelShow();
    showTimerRef.current = setTimeout(() => setVisible(true), delayMs);
  }, [cancelShow, delayMs]);

  const handleLeave = useCallback(() => {
    cancelShow();
    setVisible(false);
  }, [cancelShow]);

  // Clean up on unmount.
  useEffect(() => cancelShow, [cancelShow]);

  // Render nothing extra when content is empty — keeps DOM tidy for
  // tabs with no registry entry (#689 AC: "Tabs with no registry entry
  // show no tooltip").
  const hasContent = content !== null && content !== undefined && content !== "";

  return (
    <span
      className="hf-tooltip-wrap"
      onMouseEnter={hasContent ? handleEnter : undefined}
      onMouseLeave={hasContent ? handleLeave : undefined}
      onFocus={hasContent ? handleEnter : undefined}
      onBlur={hasContent ? handleLeave : undefined}
    >
      {children}
      {hasContent && visible && (
        <span className="hf-tooltip-bubble" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
