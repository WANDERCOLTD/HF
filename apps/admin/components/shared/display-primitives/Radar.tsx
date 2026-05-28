"use client";

import React from "react";
import {
  PersonalityRadar,
  type RadarTrait,
} from "@/components/shared/PersonalityRadar";

type RadarDim = {
  id: string;
  label: string;
  /** Current value 0–1. */
  value: number;
  /** Optional target value 0–1 (renders as dotted overlay). */
  target?: number;
  /** Optional explicit colour. */
  color?: string;
};

type RadarProps = {
  dimensions: RadarDim[];
  size?: number;
  compact?: boolean;
};

const DEFAULT_COLOR = "var(--accent-primary)";

/**
 * Thin adapter over `PersonalityRadar` so caller surfaces can pass a simple
 * `{ id, label, value, target? }` shape without juggling the radar's
 * `traits` + `targetTraits` dual arrays.
 *
 * Empty `dimensions` renders nothing (caller decides whether to wrap with
 * an empty-state surround).
 */
export function Radar({
  dimensions,
  size = 280,
  compact = false,
}: RadarProps): React.ReactElement | null {
  if (dimensions.length < 3) return null;

  const traits: RadarTrait[] = dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    value: d.value,
    color: d.color ?? DEFAULT_COLOR,
  }));

  const targets = dimensions
    .filter((d) => typeof d.target === "number")
    .map<RadarTrait>((d) => ({
      id: `${d.id}-target`,
      label: d.label,
      value: d.target as number,
      color: "var(--text-muted)",
    }));

  return (
    <PersonalityRadar
      traits={traits}
      targetTraits={targets.length > 0 ? targets : undefined}
      size={size}
      compact={compact}
    />
  );
}
