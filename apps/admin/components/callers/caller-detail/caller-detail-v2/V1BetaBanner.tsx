"use client";

import React, { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import "./v1-beta-banner.css";

type Props = {
  /** Which v1 surface we're on — drives copy + link. */
  surface: "uplift" | "progress" | "overview";
  callerId: string;
};

const V2_TAB: Record<Props["surface"], string> = {
  uplift: "uplift-v2",
  progress: "progress-v2",
  overview: "overview-v2",
};

const SURFACE_LABEL: Record<Props["surface"], string> = {
  uplift: "Uplift",
  progress: "Progress",
  overview: "Overview",
};

/**
 * Small in-app banner shown above the v1 Uplift and Progress tabs during the
 * v1 → v2 build window. Dismiss persists in localStorage per surface.
 *
 * Renders via the design-system `hf-banner hf-banner-info` pair; a small
 * companion stylesheet adds the inline link and dismiss button styling.
 */
export function V1BetaBanner({ surface, callerId }: Props): React.ReactElement | null {
  const storageKey = `hf.v2-banner-dismissed.${surface}`;
  const [dismissed, setDismissed] = useState(true); // SSR-safe default

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  const v2Tab = V2_TAB[surface];
  const surfaceLabel = SURFACE_LABEL[surface];
  const v2Href = `/x/callers/${callerId}?tab=${v2Tab}`;

  const handleDismiss = (): void => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  return (
    <div className="hf-banner hf-banner-info hf-v1-beta-banner" role="status">
      <span className="hf-v1-beta-banner-body">
        An improved version is in preview —
        <a href={v2Href} className="hf-v1-beta-banner-link">
          try {surfaceLabel} BETA
          <ArrowRight size={12} />
        </a>
      </span>
      <button
        type="button"
        className="hf-v1-beta-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
