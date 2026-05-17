"use client";

/**
 * BandPill — tier + band number pill for SKILL-NN ACHIEVE goals.
 *
 * Reads `Goal.progressMetrics.progress.{tier, band}` written by
 * `trackGoalProgress` (lib/goals/track-progress.ts) and renders a small
 * IELTS-style pill alongside the existing ProgressRing.
 *
 * Tier-to-status mapping is the IELTS-default. Non-IELTS labels (CEFR /
 * 5-Level / custom — Story C #439) fall through to the neutral accent
 * style so the pill stays meaningful when the contract is overridden.
 */

import type { CSSProperties } from "react";

export type BandPillSize = "compact" | "default";

const IELTS_TIER_STATUS: Record<string, "success" | "info" | "warning" | "muted"> = {
  Secure: "success",
  Developing: "info",
  Emerging: "warning",
  "Approaching Emerging": "muted",
};

const statusTokens: Record<
  "success" | "info" | "warning" | "muted" | "accent",
  { bg: string; text: string; border: string }
> = {
  success: {
    bg: "var(--status-success-bg, color-mix(in srgb, var(--status-success-text) 10%, transparent))",
    text: "var(--status-success-text)",
    border: "var(--status-success-border, color-mix(in srgb, var(--status-success-text) 30%, transparent))",
  },
  info: {
    bg: "var(--status-info-bg, color-mix(in srgb, var(--accent-primary) 10%, transparent))",
    text: "var(--status-info-text, var(--accent-primary))",
    border: "var(--status-info-border, color-mix(in srgb, var(--accent-primary) 30%, transparent))",
  },
  warning: {
    bg: "var(--status-warning-bg, color-mix(in srgb, var(--status-warning-text) 12%, transparent))",
    text: "var(--status-warning-text)",
    border: "var(--status-warning-border, color-mix(in srgb, var(--status-warning-text) 35%, transparent))",
  },
  muted: {
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    border: "var(--border-default)",
  },
  accent: {
    bg: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
    text: "var(--accent-primary)",
    border: "color-mix(in srgb, var(--accent-primary) 30%, transparent)",
  },
};

export function BandPill({
  tier,
  band,
  size = "default",
  title,
}: {
  tier: string;
  band?: number;
  size?: BandPillSize;
  title?: string;
}) {
  const status = IELTS_TIER_STATUS[tier] ?? "accent";
  const tokens = statusTokens[status];

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: size === "compact" ? "2px 8px" : "3px 10px",
    fontSize: size === "compact" ? 11 : 12,
    fontWeight: 600,
    lineHeight: 1.4,
    borderRadius: 999,
    backgroundColor: tokens.bg,
    color: tokens.text,
    border: `1px solid ${tokens.border}`,
    whiteSpace: "nowrap",
  };

  return (
    <span style={style} title={title ?? (band !== undefined ? `Band ${band}` : tier)}>
      <span>{tier}</span>
      {band !== undefined && (
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            opacity: 0.8,
            fontWeight: 500,
          }}
        >
          {Number.isInteger(band) ? band : band.toFixed(1)}
        </span>
      )}
    </span>
  );
}
