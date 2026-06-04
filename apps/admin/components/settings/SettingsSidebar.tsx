"use client";

import {
  Sun, Activity, Brain, Target, ShieldCheck, Sparkles, Search,
  Gauge, Shield, Camera, Mail, Lock, Phone, PhoneCall, Building2, LayoutGrid, Zap, Braces,
} from "lucide-react";
import {
  type SettingsPanel,
  type SettingsCategory,
  CATEGORY_META,
  groupByCategory,
} from "@/lib/settings-panels";

// ── Icon lookup ─────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  Sun, Activity, Brain, Target, ShieldCheck, Sparkles, Search,
  Gauge, Shield, Camera, Mail, Lock, Phone, PhoneCall, Building2, LayoutGrid, Zap, Braces,
};

// ── Props ───────────────────────────────────────────

interface SettingsSidebarProps {
  panels: SettingsPanel[];
  activeId: string;
  onSelect: (id: string) => void;
  matchingPanelIds?: Set<string>;
  isSearching: boolean;
}

// ── Component ───────────────────────────────────────

export function SettingsSidebar({
  panels,
  activeId,
  onSelect,
  matchingPanelIds,
  isSearching,
}: SettingsSidebarProps) {
  const grouped = groupByCategory(panels);

  // Sort categories by order
  const sortedCategories = [...grouped.entries()].sort(
    ([a], [b]) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
  );

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {sortedCategories.map(([category, categoryPanels]) => {
        const meta = CATEGORY_META[category as SettingsCategory];
        // When searching, hide entire categories if no panels match
        const hasMatch = !isSearching || categoryPanels.some((p) => matchingPanelIds?.has(p.id));
        if (!hasMatch) return null;

        return (
          <div key={category}>
            {/* Category header */}
            <div
              style={{
                padding: "16px 16px 4px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {meta?.label ?? category}
            </div>

            {/* Nav items */}
            {categoryPanels.map((panel) => {
              const isActive = panel.id === activeId;
              const dimmed = isSearching && !matchingPanelIds?.has(panel.id);
              const Icon = ICON_MAP[panel.icon];

              return (
                <button
                  key={panel.id}
                  onClick={() => onSelect(panel.id)}
                  title={panel.description}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                    background: isActive
                      ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)"
                      : "transparent",
                    border: "none",
                    borderLeft: isActive
                      ? "3px solid var(--accent-primary)"
                      : "3px solid transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    opacity: dimmed ? 0.3 : 1,
                  }}
                >
                  {Icon && (
                    <span style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)", display: "flex", flexShrink: 0 }}>
                      <Icon size={15} strokeWidth={1.5} />
                    </span>
                  )}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {panel.label}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
