"use client";

import React from "react";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "brand";

export type BadgeVariant = "solid" | "soft" | "outline";

export type BadgeSize = "sm" | "md";

export type BadgeProps = {
  /** Text displayed in the badge. */
  text: string;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  title?: string;
  /** Optional leading icon/element (e.g. a StatusDot). */
  leading?: React.ReactNode;
  /** Optional trailing icon/element (e.g. chevron). */
  trailing?: React.ReactNode;
  /** If provided, renders the badge as an interactive button-like element. */
  onClick?: () => void;
  /** Disabled state for interactive badges. */
  disabled?: boolean;
  /** Shows a small spinner before text. */
  loading?: boolean;
  style?: React.CSSProperties;
};

/**
 * Minimal design-system primitive.
 * - Use tone + variant for consistent status styling across the admin.
 * - Supports clickability and loading/saving style states.
 */
export function Badge({
  text,
  tone = "neutral",
  variant = "soft",
  size = "sm",
  title,
  leading,
  trailing,
  onClick,
  disabled,
  loading,
  style,
}: BadgeProps) {
  const t = toneStyles[tone];

  const pad = size === "md" ? "4px 10px" : "2px 8px";
  const fontSize = size === "md" ? 13 : 12;
  const lineHeight = size === "md" ? "18px" : "16px";

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: pad,
    borderRadius: 999,
    fontSize,
    lineHeight,
    fontWeight: 650,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: onClick && !disabled ? "pointer" : "default",
    opacity: disabled ? 0.6 : 1,
    transition: "transform 80ms ease, box-shadow 120ms ease, background-color 120ms ease",
    outline: "none",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.border,
  };

  const v: React.CSSProperties =
    variant === "solid"
      ? {
          backgroundColor: t.solidBg,
          color: t.solidFg,
          borderColor: t.solidBg,
        }
      : variant === "outline"
      ? {
          backgroundColor: "transparent",
          color: t.outlineFg,
          borderColor: t.border,
        }
      : {
          backgroundColor: t.softBg,
          color: t.softFg,
          borderColor: t.border,
        };

  const interactive: React.CSSProperties = onClick
    ? {
        boxShadow: "0 0 0 0 rgba(0,0,0,0)",
      }
    : {};

  const Comp: any = onClick ? "button" : "span";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      title={title}
      onClick={disabled ? undefined : onClick}
      style={{
        ...base,
        ...v,
        ...interactive,
        ...style,
        backgroundClip: "padding-box",
      }}
      onMouseDown={(e: any) => {
        // micro-press feedback for button-like badges
        if (!onClick || disabled) return;
        e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e: any) => {
        if (!onClick || disabled) return;
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e: any) => {
        if (!onClick || disabled) return;
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {loading ? <MiniSpinner tone={tone} /> : leading}
      <span>{text}</span>
      {trailing}
    </Comp>
  );
}

export type DotProps = {
  tone?: BadgeTone;
  title?: string;
  size?: number;
  /** Adds a subtle pulse animation (useful for "saving" states). */
  pulse?: boolean;
  style?: React.CSSProperties;
};

/**
 * Tiny status dot for tables.
 */
export function StatusDot({
  tone = "neutral",
  title,
  size = 8,
  pulse,
  style,
}: DotProps) {
  const t = toneStyles[tone];

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: t.dot,
        border: `1px solid ${t.dotBorder}`,
        boxShadow: pulse ? `0 0 0 0 ${t.dotGlow}` : undefined,
        animation: pulse ? "hfDotPulse 1.2s ease-in-out infinite" : undefined,
        ...style,
      }}
    />
  );
}

export type RowSaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at?: number }
  | { kind: "error"; message?: string };

/**
 * Opinionated helper for inline editing tables.
 * Use this to render consistent state cues (dirty/saving/saved/error).
 */
export function SaveStateBadge({ state }: { state: RowSaveState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "dirty") {
    return <Badge text="Dirty" tone="warning" variant="soft" leading={<StatusDot tone="warning" />} />;
  }

  if (state.kind === "saving") {
    return <Badge text="Saving" tone="info" variant="soft" loading />;
  }

  if (state.kind === "saved") {
    return <Badge text="Saved" tone="success" variant="soft" leading={<StatusDot tone="success" />} />;
  }

  // error
  return (
    <Badge
      text="Error"
      tone="danger"
      variant="soft"
      leading={<StatusDot tone="danger" />}
      title={state.message || "Save failed"}
    />
  );
}

function MiniSpinner({ tone }: { tone: BadgeTone }) {
  const t = toneStyles[tone];
  // SVG SMIL keeps us self-contained (no global CSS needed).
  return (
    <svg width="12" height="12" viewBox="0 0 50 50" aria-hidden="true" focusable="false">
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke={t.spinner}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="31.4 31.4"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 25 25"
          to="360 25 25"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

/**
 * Inject a tiny keyframe for pulsing dots.
 * Safe to render multiple times.
 */
export function BadgeGlobalStyles() {
  return (
    <style
      // SECURITY: inline <style> body is a static CSS keyframes string literal
      // — no external input flows in. Audit HF-O/HF-P, "what other checks" sweep.
      dangerouslySetInnerHTML={{
        __html: `@keyframes hfDotPulse { 0% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } 70% { box-shadow: 0 0 0 6px rgba(0,0,0,0); } 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } }`,
      }}
    />
  );
}

const toneStyles: Record<
  BadgeTone,
  {
    softBg: string;
    softFg: string;
    border: string;
    solidBg: string;
    solidFg: string;
    outlineFg: string;
    dot: string;
    dotBorder: string;
    dotGlow: string;
    spinner: string;
  }
> = {
  neutral: {
    softBg: "#f3f4f6",
    softFg: "#111827",
    border: "#e5e7eb",
    solidBg: "#111827",
    solidFg: "#ffffff",
    outlineFg: "#111827",
    dot: "#9ca3af",
    dotBorder: "#d1d5db",
    dotGlow: "rgba(156,163,175,0.35)",
    spinner: "#6b7280",
  },
  info: {
    softBg: "#eff6ff",
    softFg: "#1e40af",
    border: "#bfdbfe",
    solidBg: "#2563eb",
    solidFg: "#ffffff",
    outlineFg: "#1e40af",
    dot: "#3b82f6",
    dotBorder: "#bfdbfe",
    dotGlow: "rgba(59,130,246,0.35)",
    spinner: "#2563eb",
  },
  success: {
    softBg: "#ecfdf5",
    softFg: "#065f46",
    border: "#a7f3d0",
    solidBg: "#059669",
    solidFg: "#ffffff",
    outlineFg: "#065f46",
    dot: "#10b981",
    dotBorder: "#a7f3d0",
    dotGlow: "rgba(16,185,129,0.35)",
    spinner: "#059669",
  },
  warning: {
    softBg: "#fffbeb",
    softFg: "#92400e",
    border: "#fde68a",
    solidBg: "#d97706",
    solidFg: "#ffffff",
    outlineFg: "#92400e",
    dot: "#f59e0b",
    dotBorder: "#fde68a",
    dotGlow: "rgba(245,158,11,0.35)",
    spinner: "#d97706",
  },
  danger: {
    softBg: "#fef2f2",
    softFg: "#991b1b",
    border: "#fecaca",
    solidBg: "#dc2626",
    solidFg: "#ffffff",
    outlineFg: "#991b1b",
    dot: "#ef4444",
    dotBorder: "#fecaca",
    dotGlow: "rgba(239,68,68,0.35)",
    spinner: "#dc2626",
  },
  brand: {
    // matches the sidebar active background (#eef2ff)
    softBg: "#eef2ff",
    softFg: "#3730a3",
    border: "#c7d2fe",
    solidBg: "#4338ca",
    solidFg: "#ffffff",
    outlineFg: "#3730a3",
    dot: "#6366f1",
    dotBorder: "#c7d2fe",
    dotGlow: "rgba(99,102,241,0.35)",
    spinner: "#4338ca",
  },
};