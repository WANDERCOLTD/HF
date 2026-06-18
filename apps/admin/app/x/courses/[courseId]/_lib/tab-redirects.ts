/**
 * P5 (#1850) — Course Detail tab redirect table + initial-tab resolver.
 *
 * Extracted from `page.tsx` so it can be unit-tested without importing
 * the 'use client' page module (which pulls next/navigation, react-dom,
 * and 2000+ lines of UI in).
 *
 * Story: epic #1850 P5 retired the Design tab + CourseDesignConsole.
 * Every Design lens has a new home:
 *   - intake / onboarding / stops / offboarding / welcome → Journey tab
 *   - call1Mode / firstCallTargets / progressSignals       → Teaching tab
 *   - tolerances / skillBanding                             → Scoring tab
 *   - moduleVisibility                                      → Modules tab
 *   - Voice Flow lens (already retired in #1708)            → Voice tab
 *   - Preview lens                                          → Journey tab
 *   - agentTunerNlp                                         → placeholder
 *     (see #1276; standalone AgentTuner kept for wizard use)
 *
 * Deep links carrying `?tab=design` (or other historic ids) are routed
 * through `resolveInitialTab` so the educator lands on a real surface
 * instead of a blank panel.
 */

export const VALID_TABS = [
  // Active tabs
  'journey',
  'teaching',
  'scoring',
  'modules',
  'intelligence',
  'curriculum',
  'content',
  'learners',
  'proof',
  'goals',
  'skills',
  'voice',
  'settings',
  // Legacy tab IDs — redirected via LEGACY_TAB_REDIRECTS
  'design',
  'overview',
  'genome',
  'audience',
  'session-flow',
] as const;

export type TabId = (typeof VALID_TABS)[number];

/** Legacy tab id → destination on the post-P5 layout. */
export const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  // P5 (#1850) — Design tab + its aliases collapse into Journey.
  design: 'journey',
  sessions: 'journey',
  onboarding: 'journey',
  overview: 'journey',
  audience: 'journey',
  'session-flow': 'journey',
  // Pre-P5 aliases retained from CourseDesignTab era.
  genome: 'intelligence',
  content: 'intelligence',
};

/**
 * Resolve the active tab id for an arriving URL.
 *
 * Rules:
 *  1. No `?tab=` param → `journey` (default landing surface).
 *  2. Param is a legacy id → redirect target from `LEGACY_TAB_REDIRECTS`.
 *  3. Param is an active tab id → pass through.
 *  4. Unknown id → `journey` (safe fallback).
 */
export function resolveInitialTab(tabFromUrl: string | null | undefined): string {
  if (!tabFromUrl) return 'journey';
  if (LEGACY_TAB_REDIRECTS[tabFromUrl]) return LEGACY_TAB_REDIRECTS[tabFromUrl];
  return (VALID_TABS as readonly string[]).includes(tabFromUrl) ? tabFromUrl : 'journey';
}
