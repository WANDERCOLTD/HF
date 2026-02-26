"use client";

import { ReactNode } from "react";

type ExploreLensProps = {
  /** The existing tab bar + content from CallerDetailPage */
  children: ReactNode;
};

/**
 * ExploreLens wraps the existing 5-tab layout as-is.
 * This is a thin wrapper — the tabs, SectionSelectors, and content
 * are all the same as the current CallerDetailPage.
 *
 * In Phase 3, this lens will be enhanced with new sections:
 * - Memory Health (decay visualization)
 * - Behaviour Targets (with reasoning)
 * - Prompt Audit
 * - Onboarding State
 * - Messages (inbound WhatsApp/SMS)
 * - Confidence Scores
 */
export function ExploreLens({ children }: ExploreLensProps) {
  return <div className="hf-explore-lens">{children}</div>;
}
