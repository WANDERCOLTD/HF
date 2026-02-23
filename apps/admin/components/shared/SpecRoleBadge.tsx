/**
 * SpecRoleBadge Component
 *
 * Displays a visual badge for spec roles with appropriate styling and icons.
 * Used in spec lists, detail pages, and anywhere spec classification is shown.
 */

import React from "react";

type SpecRole =
  | "ORCHESTRATE"
  | "EXTRACT"
  | "SYNTHESISE"
  | "CONSTRAIN"
  | "OBSERVE"
  | "IDENTITY"
  | "CONTENT"
  | "VOICE"
  | "MEASURE"      // Deprecated
  | "ADAPT"        // Deprecated
  | "REWARD"       // Deprecated
  | "GUARDRAIL"    // Deprecated
  | "BOOTSTRAP";   // Deprecated

interface SpecRoleBadgeProps {
  role: SpecRole | string | null;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  showTooltip?: boolean;
  className?: string;
}

const ROLE_CONFIG: Record<
  string,
  {
    label: string;
    icon: string;
    bg: string;
    text: string;
    description: string;
    uiEditor?: string;
  }
> = {
  ORCHESTRATE: {
    label: "Orchestrate",
    icon: "🎯",
    bg: "var(--badge-blue-bg, #dbeafe)",
    text: "var(--badge-blue-text, #1e40af)",
    description: "Flow/sequence control → Flow Builder UI",
    uiEditor: "Flow Builder",
  },
  EXTRACT: {
    label: "Extract",
    icon: "🔍",
    bg: "var(--badge-green-bg, #dcfce7)",
    text: "var(--badge-green-text, #166534)",
    description: "Measurement/learning → Standard spec editor",
    uiEditor: "Standard Editor",
  },
  SYNTHESISE: {
    label: "Synthesise",
    icon: "🧮",
    bg: "var(--badge-amber-bg, #fef3c7)",
    text: "var(--badge-amber-text, #92400e)",
    description: "Combine/transform → Formula Builder UI",
    uiEditor: "Formula Builder",
  },
  CONSTRAIN: {
    label: "Constrain",
    icon: "📏",
    bg: "var(--badge-red-bg, #fee2e2)",
    text: "var(--badge-red-text, #991b1b)",
    description: "Bounds/guards → Rule Editor UI",
    uiEditor: "Rule Editor",
  },
  IDENTITY: {
    label: "Identity",
    icon: "👤",
    bg: "var(--badge-indigo-bg, #e0e7ff)",
    text: "var(--badge-indigo-text, #4338ca)",
    description: "Agent personas → Standard spec editor",
    uiEditor: "Standard Editor",
  },
  CONTENT: {
    label: "Content",
    icon: "📚",
    bg: "var(--badge-pink-bg, #fce7f3)",
    text: "var(--badge-pink-text, #be185d)",
    description: "Curriculum → Standard spec editor",
    uiEditor: "Standard Editor",
  },
  VOICE: {
    label: "Voice",
    icon: "🎙️",
    bg: "var(--badge-indigo-bg, #e0e7ff)",
    text: "var(--badge-indigo-text, #4338ca)",
    description: "Voice guidance → Standard spec editor",
    uiEditor: "Standard Editor",
  },
  OBSERVE: {
    label: "Observe",
    icon: "📡",
    bg: "var(--badge-purple-bg, #f3e8ff)",
    text: "var(--badge-purple-text, #7c3aed)",
    description: "System health/metrics → Dashboard UI",
    uiEditor: "Dashboard",
  },
  // Deprecated roles (legacy support)
  MEASURE: {
    label: "Measure (deprecated)",
    icon: "📊",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "DEPRECATED: Use EXTRACT instead",
    uiEditor: "Standard Editor",
  },
  ADAPT: {
    label: "Adapt (deprecated)",
    icon: "🔄",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "DEPRECATED: Use SYNTHESISE instead",
    uiEditor: "Standard Editor",
  },
  REWARD: {
    label: "Reward (deprecated)",
    icon: "⭐",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "DEPRECATED: Use SYNTHESISE instead",
    uiEditor: "Standard Editor",
  },
  GUARDRAIL: {
    label: "Guardrail (deprecated)",
    icon: "🛡️",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "DEPRECATED: Use CONSTRAIN instead",
    uiEditor: "Standard Editor",
  },
  BOOTSTRAP: {
    label: "Bootstrap (deprecated)",
    icon: "🔄",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "DEPRECATED: Use ORCHESTRATE instead",
    uiEditor: "Standard Editor",
  },
};

export function SpecRoleBadge({
  role,
  size = "md",
  showIcon = true,
  showTooltip = true,
  className = "",
}: SpecRoleBadgeProps) {
  if (!role) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 ${className}`}
        title="No role assigned"
      >
        <span>—</span>
      </span>
    );
  }

  const config = ROLE_CONFIG[role] || {
    label: role,
    icon: "❓",
    bg: "var(--surface-secondary)",
    text: "var(--text-muted)",
    description: "Unknown role",
  };

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-0.5",
    lg: "text-sm px-2.5 py-1",
  };

  const isDeprecated = role.includes("DEPRECATED") ||
    ["MEASURE", "ADAPT", "REWARD", "GUARDRAIL", "BOOTSTRAP"].includes(role);

  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClasses[size]} rounded font-medium ${className}`}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        opacity: isDeprecated ? 0.6 : 1,
      }}
      title={showTooltip ? `${config.description}${config.uiEditor ? `\nEditor: ${config.uiEditor}` : ""}` : undefined}
    >
      {showIcon && <span>{config.icon}</span>}
      <span>{config.label}</span>
    </span>
  );
}

/**
 * Helper function to get spec role config
 * Useful for conditional rendering based on role
 */
export function getSpecRoleConfig(role: string | null) {
  if (!role) return null;
  return ROLE_CONFIG[role] || null;
}

/**
 * Check if a spec role requires a special editor
 */
export function requiresSpecialEditor(role: string | null): boolean {
  if (!role) return false;
  return role === "ORCHESTRATE";
}

/**
 * Get the editor route for a spec based on its role.
 * ORCHESTRATE specs go to the Orchestrator Designer.
 */
export function getSpecEditorRoute(specId: string, role: string | null): string {
  if (role === "ORCHESTRATE") return `/x/flows?id=${specId}`;

  // TODO: Implement special editors for these roles:
  // - SYNTHESISE: formula builder
  // - CONSTRAIN: rule editor

  return `/x/specs/${specId}`;
}
