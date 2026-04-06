/**
 * Shared category + trust level metadata for ContentAssertion display.
 * Single source of truth — import from here, not local consts.
 *
 * Used by: ExtractionSummary, ScaffoldPanel, CourseWhatTab,
 *   AssertionDetailDrawer, ModuleDetailPanel, content-sources detail page.
 */

// ── Category Colors + Labels ────────────────────────────

export type CategoryStyle = { color: string; bg: string; label: string; icon?: string };

export const CONTENT_CATEGORIES: Record<string, CategoryStyle> = {
  // Textbook categories (core 6)
  fact:       { color: 'var(--accent-primary)',              bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',              label: 'Facts',       icon: 'ℹ️' },
  definition: { color: 'var(--badge-cyan-text, #0891b2)',    bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)',    label: 'Definitions', icon: '📖' },
  rule:       { color: 'var(--status-warning-text)',          bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',          label: 'Rules',       icon: '⚠️' },
  process:    { color: 'var(--accent-secondary, #8b5cf6)',   bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',   label: 'Processes',   icon: '⚙️' },
  example:    { color: 'var(--status-success-text)',          bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',          label: 'Examples',    icon: '📄' },
  threshold:  { color: 'var(--badge-pink-text, #be185d)',    bg: 'color-mix(in srgb, var(--badge-pink-text, #be185d) 10%, transparent)',    label: 'Thresholds',  icon: '📏' },
  // Worksheet categories
  question:            { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Questions',      icon: '❓' },
  true_false:          { color: 'var(--badge-cyan-text, #0891b2)',  bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)',  label: 'True/False',     icon: '⚖️' },
  matching_exercise:   { color: 'var(--accent-secondary, #8b5cf6)',bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Matching',       icon: '🔗' },
  vocabulary_exercise: { color: 'var(--badge-violet-text)',         bg: 'color-mix(in srgb, var(--badge-violet-text) 10%, transparent)',         label: 'Vocabulary',     icon: '📚' },
  discussion_prompt:   { color: 'var(--badge-pink-text, #be185d)', bg: 'color-mix(in srgb, var(--badge-pink-text, #be185d) 10%, transparent)', label: 'Discussion',     icon: '💬' },
  activity:            { color: 'var(--status-success-text)',       bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Activities',     icon: '✍️' },
  information:         { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Information',    icon: '📖' },
  reference:           { color: 'var(--status-warning-text)',       bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',       label: 'References',     icon: '📑' },
  answer_key_item:     { color: 'var(--status-success-text)',       bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Answer Key',     icon: '🔑' },
  // Curriculum categories
  learning_outcome:     { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Learning Outcome',     icon: '🎯' },
  assessment_criterion: { color: 'var(--status-success-text)',       bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Assessment Criterion', icon: '📋' },
  range:                { color: 'var(--status-warning-text)',       bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',       label: 'Range/Scope',          icon: '📏' },
  // Assessment categories
  answer:        { color: 'var(--status-success-text)',            bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Answers',        icon: '✅' },
  matching_item: { color: 'var(--accent-secondary, #8b5cf6)',     bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Matching Item',  icon: '🔗' },
  misconception: { color: 'var(--status-error-text)',              bg: 'color-mix(in srgb, var(--status-error-text) 10%, transparent)',         label: 'Misconceptions', icon: '❌' },
  mark_scheme:   { color: 'var(--badge-orange-text)',              bg: 'color-mix(in srgb, var(--badge-orange-text) 10%, transparent)',         label: 'Mark Scheme',    icon: '📝' },
  // Example/observation categories
  concept:          { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Concepts',         icon: '💡' },
  observation:      { color: 'var(--status-success-text)',       bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Observations',     icon: '👁️' },
  discussion_point: { color: 'var(--accent-secondary, #8b5cf6)',bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Discussion Point', icon: '💬' },
  context:          { color: 'var(--text-muted)',                bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',                label: 'Context',          icon: '📄' },
};

export const CATEGORY_ORDER = ['fact', 'definition', 'rule', 'process', 'example', 'threshold'] as const;

/** Safe lookup with fallback for unknown categories */
export function getCategoryStyle(category: string): CategoryStyle {
  return CONTENT_CATEGORIES[category] ?? {
    color: 'var(--text-muted)',
    bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
    label: category,
  };
}

// ── Trust Levels ────────────────────────────────────────

export type TrustLevel = { value: string; label: string; color: string; bg: string };

export const TRUST_LEVELS: TrustLevel[] = [
  { value: 'REGULATORY_STANDARD', label: 'L5 Regulatory Standard', color: 'var(--trust-l5-text)', bg: 'var(--trust-l5-bg)' },
  { value: 'ACCREDITED_MATERIAL', label: 'L4 Accredited Material', color: 'var(--trust-l4-text)', bg: 'var(--trust-l4-bg)' },
  { value: 'PUBLISHED_REFERENCE', label: 'L3 Published Reference', color: 'var(--trust-l3-text)', bg: 'var(--trust-l3-bg)' },
  { value: 'EXPERT_CURATED',      label: 'L2 Expert Curated',      color: 'var(--trust-l2-text)', bg: 'var(--trust-l2-bg)' },
  { value: 'AI_ASSISTED',         label: 'L1 AI Assisted',         color: 'var(--trust-l1-text)', bg: 'var(--trust-l1-bg)' },
  { value: 'UNVERIFIED',          label: 'L0 Unverified',          color: 'var(--trust-l0-text)', bg: 'var(--trust-l0-bg)' },
];

/** Lookup trust level by enum value */
export function getTrustLevel(value: string): TrustLevel | undefined {
  return TRUST_LEVELS.find(t => t.value === value);
}
