/**
 * Shared session type visual configuration.
 * Used by course detail page and session detail page.
 */

import {
  Sparkles, BookOpen, Layers, RotateCcw, Target, CheckCircle, Flag,
} from 'lucide-react';

export const SESSION_TYPES = [
  { value: 'onboarding', label: 'Onboarding', color: 'var(--accent-primary)' },
  { value: 'introduce', label: 'Introduce', color: 'var(--status-info-text)' },
  { value: 'deepen', label: 'Deepen', color: 'var(--status-info-text)' },
  { value: 'review', label: 'Review', color: 'var(--status-warning-text)' },
  { value: 'assess', label: 'Assess', color: 'var(--status-error-text)' },
  { value: 'consolidate', label: 'Consolidate', color: 'var(--status-success-text)' },
  { value: 'offboarding', label: 'Offboarding', color: 'var(--login-gold)' },
] as const;

export const SESSION_TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>> = {
  onboarding: Sparkles,
  introduce: BookOpen,
  deepen: Layers,
  review: RotateCcw,
  assess: Target,
  consolidate: CheckCircle,
  offboarding: Flag,
};

export function getSessionTypeColor(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.color || 'var(--text-muted)';
}

export function getSessionTypeLabel(type: string): string {
  return SESSION_TYPES.find((t) => t.value === type)?.label || type;
}

/** Session types that directly teach content (excludes onboarding + consolidate) */
export const TEACHING_SESSION_TYPES = ['introduce', 'deepen', 'review', 'assess'] as const;

export function isTeachingSession(type: string): boolean {
  return (TEACHING_SESSION_TYPES as readonly string[]).includes(type);
}

/**
 * Estimate teaching session count from a total session target.
 * Before a lesson plan exists, assumes 1 onboarding + 1 consolidate
 * for courses with >2 sessions (per generation rules).
 */
export function estimateTeachingSessions(sessionCount: number): number {
  if (sessionCount <= 2) return sessionCount; // all teaching, no structural sessions
  if (sessionCount <= 4) return sessionCount - 1; // 1 onboarding, no consolidate
  return sessionCount - 2; // 1 onboarding + 1 offboarding
}
