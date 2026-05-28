"use client";

import React from "react";
import { GoalsSection } from "../sections/GoalsSection";

type Props = {
  callerId: string;
};

/**
 * Goals lens — read-only educator view of every goal.
 *
 * Reuses Uplift v2's `GoalsSection`. Action chips (Confirm / Dismiss /
 * Adjust) route through the pending-changes tray per `ai-to-db-guard.md`
 * — those land in a follow-up PR once the tray API surface is confirmed.
 */
export function GoalsLens({ callerId }: Props): React.ReactElement {
  return (
    <div className="hf-progress-v2-lens">
      <GoalsSection callerId={callerId} />
    </div>
  );
}
