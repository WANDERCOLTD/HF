"use client";

import React from "react";
import {
  EQMixer,
  type EQBand,
  type EQTrack,
} from "@/components/shared/display-primitives";
import { useUpliftData } from "../useUpliftData";
import type { AdaptationItem } from "../../types";
import "./adaptation-section.css";

type Props = {
  callerId: string;
};

/**
 * Adaptation EQ — "How we adapted for you" on the Learner Proof Report.
 *
 * Groups the personalised CallerTarget rows into category bands (using the
 * `parameterType` / `sectionId` metadata added to `/uplift` in PR 2) and
 * renders each as a vertical mixer track via the `EQMixer` primitive. Hover
 * surfaces the parameter's plain-English definition.
 *
 * Read-only celebratory framing — no narrative invention of *why* a param
 * was tuned, just the shape of the personalisation signature.
 */
export function AdaptationSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-uplift-v2-adaptation-loading" role="status">
        Loading adaptations…
      </div>
    );
  }

  const items = data?.adaptationEvidence ?? [];
  const bands = bandize(items);
  const amplified = items.filter((i) => i.delta > 0.01).length;
  const dampened = items.filter((i) => i.delta < -0.01).length;

  return (
    <div className="hf-uplift-v2-adaptation">
      <div className="hf-uplift-v2-adaptation-head">
        <h3 className="hf-uplift-v2-adaptation-title">How we adapted for you</h3>
        {items.length > 0 && (
          <span className="hf-uplift-v2-adaptation-sub">
            {items.length} params · {amplified} amplified · {dampened} dampened
          </span>
        )}
      </div>
      <EQMixer bands={bands} />
    </div>
  );
}

/** Human-readable band labels. New parameterType values surface as-is. */
const BAND_LABELS: Record<string, string> = {
  BEHAVIOR: "Behaviour",
  TRAIT: "Trait",
  STATE: "State",
  OTHER: "Other",
};

/**
 * Group adaptation items into bands by `parameterType`. Items without a
 * type fall into "Other" (rendered last). Empty bands self-hide.
 */
function bandize(items: AdaptationItem[]): EQBand[] {
  const buckets = new Map<string, EQTrack[]>();

  for (const item of items) {
    const bandId = (item.parameterType ?? "OTHER").toUpperCase();
    const track: EQTrack = {
      id: `${bandId}::${item.parameterName}`,
      label: item.parameterName,
      current: item.currentValue,
      default: item.defaultValue,
      definition: item.definition ?? undefined,
    };
    if (!buckets.has(bandId)) buckets.set(bandId, []);
    buckets.get(bandId)!.push(track);
  }

  const knownOrder = ["BEHAVIOR", "TRAIT", "STATE"];
  const bands: EQBand[] = [];

  // Known categories first, in their canonical order.
  for (const id of knownOrder) {
    const tracks = buckets.get(id);
    if (tracks && tracks.length > 0) {
      bands.push({ id, label: BAND_LABELS[id] ?? id, tracks });
      buckets.delete(id);
    }
  }
  // Anything else (including OTHER) in insertion order.
  for (const [id, tracks] of buckets) {
    if (tracks.length === 0) continue;
    bands.push({ id, label: BAND_LABELS[id] ?? id, tracks });
  }

  return bands;
}
