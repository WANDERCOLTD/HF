// Constants and helper components for domains page

import { TRUST_LEVELS } from "@/lib/content-categories";

export const statusColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  active: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", icon: "✅", desc: "Currently active domains" },
  inactive: { bg: "var(--status-error-bg)", text: "var(--status-error-text)", icon: "⏸️", desc: "Inactive domains" },
};

export const playbookStatusMap: Record<string, "draft" | "active" | "archived"> = {
  DRAFT: "draft",
  PUBLISHED: "active",
  ARCHIVED: "archived",
};

// Re-export for consumers that imported from constants
export { TRUST_LEVELS };

export function TrustBadge({ level }: { level: string }) {
  const config = TRUST_LEVELS.find((t) => t.value === level) || TRUST_LEVELS[5];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid color-mix(in srgb, ${config.color} 20%, transparent)`,
      }}
    >
      {config.label}
    </span>
  );
}

// Re-export from shared badges — single source of truth for doc type display
export { DocTypeBadge } from "@/app/x/content-sources/_components/shared/badges";
