/**
 * Session type visual configuration — contract-backed with hardcoded fallback.
 *
 * Source of truth: SESSION_TYPES_V1 contract (DB-seeded).
 * Sync helpers use the fallback constant for client components.
 * Async helpers load from the contract for API routes / server code.
 */

import {
  Sparkles, BookOpen, Layers, RotateCcw, Target, CheckCircle, Flag,
  ClipboardList,
} from 'lucide-react';
import { config } from "@/lib/config";
import { ContractRegistry } from "@/lib/contracts/registry";

// ── Types ──────────────────────────────────────────────

export interface SessionTypeEntry {
  value: string;
  label: string;
  educatorLabel: string;
  category: "survey" | "structural" | "teaching";
  color: string;
  icon: string;
  autoInclude: "before_first" | "first" | "last" | "after_last" | null;
  canSkip: boolean;
  sortOrder: number;
}

export interface EducatorType {
  educatorLabel: string;
  dbTypes: string[];
  icon: string;
  category: string;
}

export interface SessionTypeConfig {
  types: SessionTypeEntry[];
  educatorTypes: EducatorType[];
}

// ── Hardcoded fallback (kept for client components + safety) ──

/** @deprecated Use getSessionTypeConfig() for contract-backed types */
export const SESSION_TYPES = [
  { value: 'pre_survey', label: 'Pre-Survey', color: 'var(--login-blue)' },
  { value: 'onboarding', label: 'First Call', color: 'var(--accent-primary)' },
  { value: 'introduce', label: 'Introduce', color: 'var(--status-info-text)' },
  { value: 'deepen', label: 'Deepen', color: 'var(--status-info-text)' },
  { value: 'review', label: 'Review', color: 'var(--status-warning-text)' },
  { value: 'assess', label: 'Assess', color: 'var(--status-error-text)' },
  { value: 'consolidate', label: 'Consolidate', color: 'var(--status-success-text)' },
  { value: 'mid_survey', label: 'Mid-Survey', color: 'var(--login-blue)' },
  { value: 'offboarding', label: 'Last Call', color: 'var(--login-gold)' },
  { value: 'post_survey', label: 'Post-Survey', color: 'var(--login-blue)' },
] as const;

/** Teaching session type entries with labels/colors — for educator type dropdowns */
export const TEACHING_SESSION_TYPE_ENTRIES = SESSION_TYPES.filter(
  (t) => !['pre_survey', 'mid_survey', 'post_survey', 'onboarding', 'offboarding'].includes(t.value),
);

export const SESSION_TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>> = {
  pre_survey: ClipboardList,
  onboarding: Sparkles,
  introduce: BookOpen,
  deepen: Layers,
  review: RotateCcw,
  assess: Target,
  consolidate: CheckCircle,
  mid_survey: ClipboardList,
  offboarding: Flag,
  post_survey: ClipboardList,
};

// ── Contract-backed loader (async — API routes, server code) ──

let _cachedConfig: SessionTypeConfig | null = null;

/** Load session type config from SESSION_TYPES_V1 contract. Falls back to hardcoded types. */
export async function getSessionTypeConfig(): Promise<SessionTypeConfig> {
  if (_cachedConfig) return _cachedConfig;

  try {
    const contract = await ContractRegistry.getContract(config.specs.sessionTypes);
    if (contract?.config?.types) {
      _cachedConfig = contract.config as SessionTypeConfig;
      return _cachedConfig;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: build from hardcoded constant
  _cachedConfig = {
    types: SESSION_TYPES.map((t, i) => ({
      value: t.value,
      label: t.label,
      educatorLabel: t.label,
      category: (['pre_survey', 'mid_survey', 'post_survey'].includes(t.value) ? 'survey' :
        ['onboarding', 'offboarding'].includes(t.value) ? 'structural' : 'teaching') as SessionTypeEntry["category"],
      color: t.color,
      icon: 'BookOpen',
      autoInclude: null,
      canSkip: !['onboarding', 'offboarding'].includes(t.value),
      sortOrder: i,
    })),
    educatorTypes: [
      { educatorLabel: 'Learn', dbTypes: ['introduce', 'deepen'], icon: 'BookOpen', category: 'teaching' },
      { educatorLabel: 'Review', dbTypes: ['review', 'consolidate'], icon: 'RotateCcw', category: 'teaching' },
      { educatorLabel: 'Assess', dbTypes: ['assess'], icon: 'Target', category: 'teaching' },
      { educatorLabel: 'Survey', dbTypes: ['pre_survey', 'mid_survey', 'post_survey'], icon: 'ClipboardList', category: 'survey' },
    ],
  };
  return _cachedConfig;
}

/** Get valid type values from contract (async). */
export async function getValidSessionTypes(): Promise<string[]> {
  const cfg = await getSessionTypeConfig();
  return cfg.types.map((t) => t.value);
}

/** Get educator-facing type groups from contract (async). */
export async function getEducatorTypes(): Promise<EducatorType[]> {
  const cfg = await getSessionTypeConfig();
  return cfg.educatorTypes;
}

// ── Sync helpers (work with fallback or optional loaded config) ──

export function getSessionTypeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color || 'var(--text-muted)';
}

export function getSessionTypeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label || type;
}

const SHORT_LABELS: Record<string, string> = {
  pre_survey: "PR",
  onboarding: "OB",
  introduce: "IN",
  deepen: "DP",
  review: "RV",
  assess: "AS",
  consolidate: "CO",
  mid_survey: "MS",
  offboarding: "OF",
  post_survey: "PO",
};

/** 2-letter abbreviation for session type (for compact visualizations like genome browser). */
export function getSessionTypeShortLabel(type: string): string {
  return SHORT_LABELS[type] || type.slice(0, 2).toUpperCase();
}

/** Is this a form stop (survey category)? */
export function isFormStop(type: string): boolean {
  return ['pre_survey', 'mid_survey', 'post_survey'].includes(type);
}

/** Is this a voice stop (structural or teaching)? */
export function isVoiceStop(type: string): boolean {
  return !isFormStop(type);
}

// ── Teaching session helpers ──

/** Session types that directly teach content (excludes structural + survey) */
export const TEACHING_SESSION_TYPES = ['introduce', 'deepen', 'review', 'assess'] as const;

export function isTeachingSession(type: string): boolean {
  return (TEACHING_SESSION_TYPES as readonly string[]).includes(type);
}

/**
 * Estimate teaching session count from a total session target.
 * Before a lesson plan exists, assumes 1 onboarding + 1 offboarding
 * for courses with >2 sessions (per generation rules).
 */
export function estimateTeachingSessions(sessionCount: number): number {
  if (sessionCount <= 2) return sessionCount;
  if (sessionCount <= 4) return sessionCount - 1;
  return sessionCount - 2;
}
