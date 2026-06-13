"use client";

// WILL_RETIRE — covered by Adaptations (SP5-A/B/C/D): see docs/retirement-audit/adaptations-sp5e.md

import React from "react";
import { AdaptationSection } from "../sections/AdaptationSection";

type Props = {
  callerId: string;
};

/**
 * Adaptation lens — Progress v2 view of "How we adapted for you".
 *
 * Reuses the read-only `AdaptationSection` from Uplift v2; PR 7 layers
 * action chips on top to route adjustments through the pending-changes
 * tray (`ai-to-db-guard.md`).
 */
export function AdaptationLens({ callerId }: Props): React.ReactElement {
  return (
    <div className="hf-progress-v2-lens">
      <AdaptationSection callerId={callerId} />
    </div>
  );
}
