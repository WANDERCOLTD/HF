"use client";

import React, { useState } from "react";
import { HeatmapStrip } from "@/components/shared/display-primitives";
import { count } from "@/lib/caller-insights/formatNum";
import { ModuleDetailPanel } from "../../cards/ModuleDetailPanel";
import { useUpliftData } from "../useUpliftData";
import "./modules-section.css";

type Props = {
  callerId: string;
};

type DrilldownTarget = {
  moduleSlug: string;
  moduleTitle: string;
  moduleMastery: number;
};

/**
 * Module Heatmap — one cell per module in `sortOrder`, fill intensity =
 * mastery. Tooltip surfaces title + mastery% + callCount. Cells reuse the
 * existing `ModuleDetailPanel` drilldown via `moduleSlug`.
 *
 * Reads `moduleProgress[]` from the shared `useUpliftData` hook — no extra
 * network call.
 */
export function ModulesSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);
  const [drilldown, setDrilldown] = useState<DrilldownTarget | null>(null);

  if (loading) {
    return (
      <div className="hf-uplift-v2-modules-loading" role="status">
        Loading module mastery…
      </div>
    );
  }

  const modules = data?.moduleProgress ?? [];
  const sorted = [...modules].sort((a, b) => a.sortOrder - b.sortOrder);

  const cells = sorted.map((mod) => ({
    key: mod.moduleId,
    label: mod.title,
    value: mod.mastery,
    sub: count(mod.callCount, "calls"),
    tooltip: (
      <div>
        <div className="hf-uplift-v2-modules-tip-title">{mod.title}</div>
        <div className="hf-uplift-v2-modules-tip-row">
          mastery {Math.round(mod.mastery * 100)}% · {mod.callCount} calls
        </div>
      </div>
    ),
    onClick: () =>
      setDrilldown({
        moduleSlug: mod.slug,
        moduleTitle: mod.title,
        moduleMastery: mod.mastery,
      }),
  }));

  return (
    <div className="hf-uplift-v2-modules">
      <div className="hf-uplift-v2-modules-head">
        <h3 className="hf-uplift-v2-modules-title">Module mastery</h3>
        {modules.length > 0 && (
          <span className="hf-uplift-v2-modules-sub">
            {modules.filter((m) => m.status === "COMPLETED").length} of{" "}
            {modules.length} complete
          </span>
        )}
      </div>
      <HeatmapStrip cells={cells} emptyText="No module progress yet." />
      {drilldown && (
        <ModuleDetailPanel
          callerId={callerId}
          moduleSlug={drilldown.moduleSlug}
          moduleTitle={drilldown.moduleTitle}
          moduleMastery={drilldown.moduleMastery}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
