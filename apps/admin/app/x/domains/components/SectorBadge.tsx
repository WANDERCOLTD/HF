"use client";

/**
 * SectorBadge — displays institution type as a colored pill badge.
 *
 * Uses the existing Badge component from the design system.
 * Each sector type gets a distinct color (from --badge-*-* CSS vars) and Lucide icon.
 * Rich hover tooltip explains how the sector affects the AI agent's personality.
 *
 * Returns null when no type is set (domains without an institution type show no badge).
 */

import {
  GraduationCap,
  Building2,
  Users,
  Target,
  Heart,
  Dumbbell,
} from "lucide-react";
import { Badge } from "@/src/components/shared/Badges";
import { getSectorDef, type SectorSlug } from "@/lib/institution-types/sector-config";

const ICON_MAP: Record<string, React.ReactNode> = {
  GraduationCap: <GraduationCap size={12} />,
  Building2: <Building2 size={12} />,
  Users: <Users size={12} />,
  Target: <Target size={12} />,
  Heart: <Heart size={12} />,
  Dumbbell: <Dumbbell size={12} />,
};

/** CSS var color overrides per sector color key */
const COLOR_STYLES: Record<string, React.CSSProperties> = {
  blue: {
    color: "var(--badge-blue-text)",
    backgroundColor: "var(--badge-blue-bg)",
    borderColor: "var(--badge-blue-border)",
  },
  amber: {
    color: "var(--badge-amber-text)",
    backgroundColor: "var(--badge-amber-bg)",
    borderColor: "var(--badge-amber-border)",
  },
  green: {
    color: "var(--badge-green-text)",
    backgroundColor: "var(--badge-green-bg)",
    borderColor: "var(--badge-green-border)",
  },
  purple: {
    color: "var(--badge-purple-text)",
    backgroundColor: "var(--badge-purple-bg)",
    borderColor: "var(--badge-purple-border)",
  },
  pink: {
    color: "var(--badge-pink-text)",
    backgroundColor: "var(--badge-pink-bg)",
    borderColor: "var(--badge-pink-border)",
  },
  cyan: {
    color: "var(--badge-cyan-text)",
    backgroundColor: "var(--badge-cyan-bg)",
    borderColor: "var(--badge-cyan-border)",
  },
};

interface SectorBadgeProps {
  /** Institution type slug (e.g., "school", "corporate") */
  typeSlug?: string | null;
  /** Display name override (falls back to sector config label) */
  typeName?: string | null;
  /** Badge size */
  size?: "sm" | "md";
}

export function SectorBadge({ typeSlug, typeName, size = "sm" }: SectorBadgeProps) {
  const def = getSectorDef(typeSlug);
  if (!def) return null;

  return (
    <Badge
      text={typeName || def.label}
      tone="neutral"
      variant="soft"
      size={size}
      title={def.tooltip}
      leading={ICON_MAP[def.icon]}
      style={COLOR_STYLES[def.colorKey]}
    />
  );
}
