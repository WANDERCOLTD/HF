"use client";

import React from "react";
import { dbTargetColor, useDbState } from "./EnvironmentBanner";

export const ROLE_COLORS: Record<string, string> = {
  SUPERADMIN: "var(--status-error-text)",
  ADMIN: "var(--badge-orange-text, #ea580c)",
  OPERATOR: "var(--accent-primary)",
  EDUCATOR: "var(--status-success-text)",
  SUPER_TESTER: "var(--accent-secondary, #8b5cf6)",
  TESTER: "var(--text-muted)",
  STUDENT: "var(--badge-cyan-text, #06b6d4)",
  DEMO: "var(--text-muted)",
  VIEWER: "var(--text-muted)",
};

export const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary, #8b5cf6))",
  "linear-gradient(135deg, var(--accent-primary), var(--badge-cyan-text, #06b6d4))",
  "linear-gradient(135deg, var(--badge-pink-text, #ec4899), var(--status-error-text, #f43f5e))",
  "linear-gradient(135deg, var(--status-warning-text), var(--status-error-text))",
  "linear-gradient(135deg, var(--status-success-text), var(--badge-cyan-text, #14b8a6))",
  "linear-gradient(135deg, var(--accent-secondary, #8b5cf6), var(--badge-pink-text, #ec4899))",
];

export function getAvatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

/** Compute default initials from a name (first letter of first + last word) */
export function computeInitials(name: string | null, maxChars: number = 2): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return parts
    .slice(0, maxChars)
    .map((p) => p[0].toUpperCase())
    .join("");
}

interface UserAvatarProps {
  name: string | null;
  initials?: string | null;
  role?: string;
  userId?: string;
  image?: string | null;
  size?: number;
  useGradient?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function UserAvatar({
  name,
  initials,
  role,
  userId,
  image,
  size = 32,
  useGradient,
  className,
  style,
}: UserAvatarProps) {
  const { dbTarget: liveDbTarget, isDbSwitched } = useDbState();

  // Custom initials take priority, then auto-compute from name
  const displayInitials = initials?.trim() || computeInitials(name);

  // Scale font size based on character count
  const charCount = displayInitials.length;
  const fontScale = charCount <= 1 ? 0.4 : charCount === 2 ? 0.34 : 0.28;
  const fontSize = Math.round(size * fontScale);

  const bg =
    useGradient && userId
      ? getAvatarGradient(userId)
      : role
        ? ROLE_COLORS[role] || "var(--text-muted)"
        : "var(--text-muted)";

  // DB-target ring: when sandbox VM is pointed at a non-sandbox DB (staging/pilot),
  // ring color matches that env. When DB matches env (default), no ring.
  // The ring is the loaded-gun guard — visible on every avatar instance, can't be missed.
  const ringTarget = isDbSwitched ? liveDbTarget : null;
  const ringColor = dbTargetColor(ringTarget);
  const ringShadow = ringColor
    ? `0 0 0 2px var(--surface-primary), 0 0 0 4px ${ringColor}`
    : undefined;

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...(ringShadow ? { boxShadow: ringShadow } : {}),
    ...style,
  };

  if (image) {
    return (
      <img
        src={image}
        alt={name || "User"}
        className={className}
        data-db-target={ringTarget || undefined}
        style={{ ...baseStyle, objectFit: "cover" }}
      />
    );
  }

  return (
    <div
      className={className}
      data-db-target={ringTarget || undefined}
      style={{
        ...baseStyle,
        background: bg,
        color: "var(--surface-primary)",
        fontSize,
        fontWeight: 700,
        letterSpacing: charCount > 1 ? "-0.02em" : undefined,
      }}
    >
      {displayInitials}
    </div>
  );
}
