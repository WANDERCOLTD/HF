"use client";

import React from "react";
import { ModulesSection } from "../sections/ModulesSection";

type Props = {
  callerId: string;
};

/**
 * Modules lens — Progress v2 view of module mastery.
 *
 * Reuses the read-only `ModulesSection` from Uplift v2. The heatmap
 * already routes clicks to the existing `ModuleDetailPanel`, so educator
 * drilldown works for free.
 */
export function ModulesLens({ callerId }: Props): React.ReactElement {
  return (
    <div className="hf-progress-v2-lens">
      <ModulesSection callerId={callerId} />
    </div>
  );
}
