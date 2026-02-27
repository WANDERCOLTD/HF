/**
 * Pipeline Icon System
 *
 * Provides consistent icons and colors for pipeline visualization.
 * Uses MUI icons (@mui/icons-material).
 */

import React from "react";
import {
  InsertDriveFile,
  Psychology,
  Storage,
  BarChart,
  EmojiEvents,
  Extension,
  Person,
  Phone,
  Timeline,
  Bookmark,
  GpsFixed,
  Straighten,
  Description,
  MenuBook,
  Settings,
  Code,
  MergeType,
  CheckCircle,
  Cancel,
  RemoveCircle,
  HourglassEmpty,
  RadioButtonUnchecked,
  History,
  School,
  RecordVoiceOver,
  ListAlt,
  Mic,
} from "@mui/icons-material";
import type { SvgIconProps } from "@mui/material/SvgIcon";

// =============================================================================
// TYPES
// =============================================================================

type IconConfig = {
  Icon: React.ComponentType<SvgIconProps>;
  color: string;
  bg: string;
};

type StatusConfig = IconConfig & {
  spin?: boolean;
};

// =============================================================================
// STEP ICONS
// =============================================================================

export const STEP_ICONS: Record<string, IconConfig> = {
  "transcripts:process": {
    Icon: InsertDriveFile,
    color: "#475569", // slate-600
    bg: "#f1f5f9", // slate-100
  },
  "personality:analyze": {
    Icon: Psychology,
    color: "#db2777", // pink-600
    bg: "#fce7f3", // pink-100
  },
  "personality:aggregate": {
    Icon: Psychology,
    color: "#db2777",
    bg: "#fce7f3",
  },
  "memory:extract": {
    Icon: Storage,
    color: "#d97706", // amber-600
    bg: "#fef3c7", // amber-100
  },
  "agent:measure": {
    Icon: BarChart,
    color: "#2563eb", // blue-600
    bg: "#dbeafe", // blue-100
  },
  "reward:compute": {
    Icon: EmojiEvents,
    color: "#059669", // emerald-600
    bg: "#d1fae5", // emerald-100
  },
  "prompt:compose": {
    Icon: Extension,
    color: "#7c3aed", // violet-600
    bg: "#ede9fe", // violet-100
  },
};

// =============================================================================
// ENTITY ICONS
// =============================================================================

export const ENTITY_ICONS: Record<string, IconConfig> = {
  Caller: { Icon: Person, color: "#475569", bg: "#f1f5f9" },
  Call: { Icon: Phone, color: "#2563eb", bg: "#dbeafe" },
  CallScore: { Icon: BarChart, color: "#4f46e5", bg: "#e0e7ff" },
  CallerPersonality: { Icon: Psychology, color: "#db2777", bg: "#fce7f3" },
  CallerMemory: { Icon: Bookmark, color: "#d97706", bg: "#fef3c7" },
  BehaviorTarget: { Icon: GpsFixed, color: "#ea580c", bg: "#ffedd5" },
  BehaviorMeasurement: { Icon: Straighten, color: "#0891b2", bg: "#cffafe" },
  RewardScore: { Icon: EmojiEvents, color: "#059669", bg: "#d1fae5" },
  ComposedPrompt: { Icon: Description, color: "#7c3aed", bg: "#ede9fe" },
  Playbook: { Icon: MenuBook, color: "#9333ea", bg: "#f3e8ff" },
  AnalysisSpec: { Icon: Settings, color: "#6b7280", bg: "#f3f4f6" },
};

// =============================================================================
// SECTION ICONS (for compose step)
// =============================================================================

export const SECTION_ICONS: Record<string, IconConfig> = {
  caller_info: { Icon: Person, color: "#475569", bg: "#f1f5f9" },
  personality: { Icon: Psychology, color: "#db2777", bg: "#fce7f3" },
  learner_profile: { Icon: School, color: "#7c3aed", bg: "#ede9fe" },
  memories: { Icon: Storage, color: "#d97706", bg: "#fef3c7" },
  behavior_targets: { Icon: GpsFixed, color: "#ea580c", bg: "#ffedd5" },
  call_history: { Icon: History, color: "#2563eb", bg: "#dbeafe" },
  curriculum: { Icon: School, color: "#059669", bg: "#d1fae5" },
  session_planning: { Icon: Timeline, color: "#0891b2", bg: "#cffafe" },
  learner_goals: { Icon: GpsFixed, color: "#ea580c", bg: "#ffedd5" },
  domain_context: { Icon: MenuBook, color: "#9333ea", bg: "#f3e8ff" },
  identity: { Icon: Person, color: "#475569", bg: "#f1f5f9" },
  content: { Icon: Description, color: "#059669", bg: "#d1fae5" },
  instructions_voice: { Icon: Mic, color: "#db2777", bg: "#fce7f3" },
  instructions_pedagogy: { Icon: School, color: "#7c3aed", bg: "#ede9fe" },
  instructions: { Icon: ListAlt, color: "#4f46e5", bg: "#e0e7ff" },
  quick_start: { Icon: Timeline, color: "#0891b2", bg: "#cffafe" },
  preamble: { Icon: RecordVoiceOver, color: "#475569", bg: "#f1f5f9" },
};

// =============================================================================
// CONFIG SOURCE BADGES
// =============================================================================

export const CONFIG_SOURCE_BADGES = {
  code: {
    Icon: Code,
    label: "Code",
    color: "#475569",
    bg: "#f1f5f9",
    border: "#cbd5e1",
  },
  spec: {
    Icon: Settings,
    label: "Spec",
    color: "#b45309",
    bg: "#fef3c7",
    border: "#fcd34d",
  },
  hybrid: {
    Icon: MergeType,
    label: "Both",
    color: "#7c3aed",
    bg: "#ede9fe",
    border: "#c4b5fd",
  },
} as const;

// =============================================================================
// STATUS ICONS
// =============================================================================

export const STATUS_ICONS: Record<string, StatusConfig> = {
  SUCCESS: {
    Icon: CheckCircle,
    color: "#10b981", // emerald-500
    bg: "#d1fae5",
  },
  FAILED: {
    Icon: Cancel,
    color: "#ef4444", // red-500
    bg: "#fee2e2",
  },
  SKIPPED: {
    Icon: RemoveCircle,
    color: "var(--text-muted)", // gray-400
    bg: "#f3f4f6",
  },
  RUNNING: {
    Icon: HourglassEmpty,
    color: "#3b82f6", // blue-500
    bg: "#dbeafe",
    spin: true,
  },
  PENDING: {
    Icon: RadioButtonUnchecked,
    color: "#d1d5db", // gray-300
    bg: "#f3f4f6",
  },
};

// =============================================================================
// COMPONENTS
// =============================================================================

interface StepIconProps {
  operation: string;
  size?: number;
}

export function StepIcon({ operation, size = 20 }: StepIconProps) {
  const config = STEP_ICONS[operation];
  if (!config) {
    return (
      <div
        style={{
          width: size + 16,
          height: size + 16,
          borderRadius: 8,
          background: "var(--surface-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Settings style={{ fontSize: size, color: "var(--text-muted)" }} />
      </div>
    );
  }

  const { Icon, color, bg } = config;
  return (
    <div
      style={{
        width: size + 16,
        height: size + 16,
        borderRadius: 8,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon style={{ fontSize: size, color }} />
    </div>
  );
}

interface EntityIconProps {
  type: string;
  size?: number;
}

export function EntityIcon({ type, size = 16 }: EntityIconProps) {
  const config = ENTITY_ICONS[type];
  if (!config) return null;

  const { Icon, color } = config;
  return <Icon style={{ fontSize: size, color }} />;
}

interface SectionIconProps {
  section: string;
  size?: number;
}

export function SectionIcon({ section, size = 16 }: SectionIconProps) {
  const config = SECTION_ICONS[section];
  if (!config) {
    return <Settings style={{ fontSize: size, color: "var(--text-muted)" }} />;
  }

  const { Icon, color } = config;
  return <Icon style={{ fontSize: size, color }} />;
}

interface StatusBadgeProps {
  status: string;
  size?: number;
}

export function StatusBadge({ status, size = 20 }: StatusBadgeProps) {
  const config = STATUS_ICONS[status] ?? STATUS_ICONS.PENDING;
  const { Icon, color, bg, spin } = config;

  return (
    <div
      style={{
        width: size + 8,
        height: size + 8,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon
        style={{
          fontSize: size,
          color,
          animation: spin ? "spin 1s linear infinite" : undefined,
        }}
      />
    </div>
  );
}

interface ConfigBadgeProps {
  source: "code" | "spec" | "hybrid";
}

export function ConfigBadge({ source }: ConfigBadgeProps) {
  const config = CONFIG_SOURCE_BADGES[source];
  const { Icon, label, color, bg, border } = config;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      <Icon style={{ fontSize: 12 }} />
      {label}
    </span>
  );
}

// =============================================================================
// CSS for spin animation (add to globals.css or use a style tag)
// =============================================================================

export const SPIN_KEYFRAMES = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
