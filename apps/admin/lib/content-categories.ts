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
  // Literary / domain-specific categories
  character:            { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Characters',          icon: '👤' },
  theme:                { color: 'var(--login-navy)',                bg: 'color-mix(in srgb, var(--login-navy) 10%, transparent)',                label: 'Themes',              icon: '🎭' },
  setting:              { color: 'var(--status-success-text)',       bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',       label: 'Settings',            icon: '🌍' },
  key_event:            { color: 'var(--login-gold)',                bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',                label: 'Key Events',          icon: '⚡' },
  key_point:            { color: 'var(--login-gold)',                bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',                label: 'Key Points',          icon: '📌' },
  key_quote:            { color: 'var(--login-blue)',                bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',                label: 'Key Quotes',          icon: '💬' },
  language_feature:     { color: 'var(--login-blue)',                bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',                label: 'Language Features',   icon: '✏️' },
  vocabulary_highlight: { color: 'var(--login-navy)',                bg: 'color-mix(in srgb, var(--login-navy) 10%, transparent)',                label: 'Vocabulary',          icon: '📖' },
  overview:             { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Overview',            icon: '📋' },
  summary:              { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Summary',             icon: '📝' },
  principle:            { color: 'var(--accent-primary)',            bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',            label: 'Principles',          icon: '⚖️' },
  // Instruction categories (how to teach — from Teaching Guides)
  teaching_rule:        { color: 'var(--status-error-text)',              bg: 'color-mix(in srgb, var(--status-error-text) 10%, transparent)',         label: 'Teaching Rules',       icon: '📏' },
  session_flow:         { color: 'var(--badge-cyan-text, #0891b2)',       bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)', label: 'Session Flow',         icon: '🔄' },
  scaffolding_technique:{ color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Scaffolding',          icon: '🪜' },
  skill_framework:      { color: 'var(--login-navy)',                     bg: 'color-mix(in srgb, var(--login-navy) 10%, transparent)',               label: 'Skill Framework',      icon: '🎯' },
  communication_rule:   { color: 'var(--login-blue)',                     bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',               label: 'Communication',        icon: '💬' },
  assessment_approach:  { color: 'var(--badge-orange-text)',              bg: 'color-mix(in srgb, var(--badge-orange-text) 10%, transparent)',        label: 'Assessment Approach',  icon: '📋' },
  differentiation:      { color: 'var(--status-success-text)',            bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',      label: 'Differentiation',      icon: '🔀' },
  edge_case:            { color: 'var(--status-warning-text)',            bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',      label: 'Edge Cases',           icon: '⚠️' },
  learner_model:        { color: 'var(--badge-pink-text, #be185d)',       bg: 'color-mix(in srgb, var(--badge-pink-text, #be185d) 10%, transparent)',label: 'Learner Model',        icon: '🧠' },
  session_override:     { color: 'var(--status-error-text)',              bg: 'color-mix(in srgb, var(--status-error-text) 10%, transparent)',        label: 'Session Override',     icon: '🔧' },
  content_strategy:     { color: 'var(--login-gold)',                     bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',               label: 'Content Strategy',     icon: '📐' },
  session_metadata:     { color: 'var(--text-muted)',                     bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',               label: 'Session Metadata',     icon: '📄' },
  skill_description:    { color: 'var(--login-navy)',                     bg: 'color-mix(in srgb, var(--login-navy) 10%, transparent)',               label: 'Skill Description',    icon: '📝' },
  assessment_guidance:  { color: 'var(--badge-orange-text)',              bg: 'color-mix(in srgb, var(--badge-orange-text) 10%, transparent)',        label: 'Assessment Guidance',  icon: '📋' },
  // Lesson plan categories
  objective:            { color: 'var(--accent-primary)',                 bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',           label: 'Objectives',           icon: '🎯' },
  timing:               { color: 'var(--badge-cyan-text, #0891b2)',       bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)', label: 'Timing',              icon: '⏱️' },
  resource:             { color: 'var(--login-gold)',                     bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',               label: 'Resources',            icon: '📦' },
  assessment_opportunity:{ color: 'var(--badge-orange-text)',             bg: 'color-mix(in srgb, var(--badge-orange-text) 10%, transparent)',        label: 'Assessment Opp.',      icon: '✅' },
  plenary:              { color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Plenary',             icon: '🏁' },
  starter:              { color: 'var(--status-success-text)',            bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',      label: 'Starter',              icon: '🚀' },
  // Question bank categories
  tutor_question:       { color: 'var(--accent-primary)',                 bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',           label: 'Tutor Questions',      icon: '❓' },
  // Pattern supplementary categories
  dilemma:              { color: 'var(--status-warning-text)',            bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',      label: 'Dilemmas',             icon: '⚖️' },
  reflection_question:  { color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Reflection',          icon: '🪞' },
  narrative_prompt:     { color: 'var(--login-blue)',                     bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',               label: 'Narrative Prompts',    icon: '📖' },
  caveat:               { color: 'var(--status-warning-text)',            bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',      label: 'Caveats',              icon: '⚠️' },
  decision_framework:   { color: 'var(--login-navy)',                     bg: 'color-mix(in srgb, var(--login-navy) 10%, transparent)',               label: 'Decision Framework',   icon: '🗂️' },
  action_step:          { color: 'var(--status-success-text)',            bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',      label: 'Action Steps',         icon: '👣' },
  citation:             { color: 'var(--text-muted)',                     bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',               label: 'Citations',            icon: '📎' },
  normalising_statement:{ color: 'var(--login-blue)',                     bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',               label: 'Normalising',          icon: '🤝' },
  talking_point:        { color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Talking Points',       icon: '💬' },
  conversation_starter: { color: 'var(--badge-cyan-text, #0891b2)',       bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)', label: 'Conversation Starter', icon: '👋' },
  // Comprehension categories
  reading_passage:      { color: 'var(--accent-primary)',                 bg: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',           label: 'Reading Passage',      icon: '📄' },
  comprehension_question:{ color: 'var(--accent-secondary, #8b5cf6)',     bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Comprehension Q',      icon: '❓' },
  comprehension_task:   { color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Comprehension Task',   icon: '📝' },
  vocabulary_item:      { color: 'var(--badge-violet-text)',              bg: 'color-mix(in srgb, var(--badge-violet-text) 10%, transparent)',        label: 'Vocabulary',           icon: '📚' },
  key_fact:             { color: 'var(--login-gold)',                     bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',               label: 'Key Facts',            icon: '⭐' },
  // Policy document categories
  safety_point:         { color: 'var(--status-error-text)',              bg: 'color-mix(in srgb, var(--status-error-text) 10%, transparent)',        label: 'Safety Points',        icon: '🛑' },
  procedure:            { color: 'var(--badge-cyan-text, #0891b2)',       bg: 'color-mix(in srgb, var(--badge-cyan-text, #0891b2) 10%, transparent)', label: 'Procedures',          icon: '📋' },
  legal_requirement:    { color: 'var(--status-error-text)',              bg: 'color-mix(in srgb, var(--status-error-text) 10%, transparent)',        label: 'Legal Requirements',   icon: '⚖️' },
  hazard:               { color: 'var(--status-warning-text)',            bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',      label: 'Hazards',              icon: '☠️' },
  control_measure:      { color: 'var(--status-success-text)',            bg: 'color-mix(in srgb, var(--status-success-text) 10%, transparent)',      label: 'Control Measures',     icon: '🛡️' },
  record_requirement:   { color: 'var(--badge-orange-text)',              bg: 'color-mix(in srgb, var(--badge-orange-text) 10%, transparent)',        label: 'Record Requirements',  icon: '📝' },
  corrective_action:    { color: 'var(--status-warning-text)',            bg: 'color-mix(in srgb, var(--status-warning-text) 10%, transparent)',      label: 'Corrective Actions',   icon: '🔧' },
  // Generic / cross-type categories
  key_term:             { color: 'var(--badge-violet-text)',              bg: 'color-mix(in srgb, var(--badge-violet-text) 10%, transparent)',        label: 'Key Terms',            icon: '🔤' },
  vocabulary:           { color: 'var(--badge-violet-text)',              bg: 'color-mix(in srgb, var(--badge-violet-text) 10%, transparent)',        label: 'Vocabulary',           icon: '📚' },
  worksheet:            { color: 'var(--login-gold)',                     bg: 'color-mix(in srgb, var(--login-gold) 10%, transparent)',               label: 'Worksheet',            icon: '📝' },
  worked_example:       { color: 'var(--accent-secondary, #8b5cf6)',      bg: 'color-mix(in srgb, var(--accent-secondary, #8b5cf6) 10%, transparent)',label: 'Worked Examples',      icon: '✏️' },
  open_task:            { color: 'var(--login-blue)',                     bg: 'color-mix(in srgb, var(--login-blue) 10%, transparent)',               label: 'Open Tasks',           icon: '💭' },
};

export const CATEGORY_ORDER = ['fact', 'definition', 'rule', 'process', 'example', 'threshold'] as const;

// Palette for deterministic fallback colours (unknown/AI-invented categories)
const FALLBACK_PALETTE = [
  'var(--accent-primary)',
  'var(--accent-secondary, #8b5cf6)',
  'var(--badge-cyan-text, #0891b2)',
  'var(--login-gold)',
  'var(--login-blue)',
  'var(--login-navy)',
  'var(--status-success-text)',
  'var(--badge-pink-text, #be185d)',
  'var(--badge-orange-text)',
  'var(--status-warning-text)',
] as const;

/** Deterministic hash → palette index so unknown categories get a stable colour */
function hashToIndex(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % FALLBACK_PALETTE.length;
}

/** Safe lookup with fallback for unknown categories */
export function getCategoryStyle(category: string): CategoryStyle {
  if (CONTENT_CATEGORIES[category]) return CONTENT_CATEGORIES[category];
  const color = FALLBACK_PALETTE[hashToIndex(category)];
  return {
    color,
    bg: `color-mix(in srgb, ${color} 10%, transparent)`,
    label: category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  };
}

// ── Category helpers ────────────────────────────────────

/** Array form of CONTENT_CATEGORIES for iteration (value + style) */
export const CATEGORIES_ARRAY = Object.entries(CONTENT_CATEGORIES).map(
  ([value, style]) => ({ value, ...style }),
);

/** Core textbook categories — used for validation in assertion routes */
export const VALID_CATEGORIES = CATEGORY_ORDER as readonly string[];

// ── Trust Levels ────────────────────────────────────────

export type TrustLevel = { value: string; label: string; color: string; bg: string; level: number };

export const TRUST_LEVELS: TrustLevel[] = [
  { value: 'REGULATORY_STANDARD', label: 'L5 Regulatory Standard', color: 'var(--trust-l5-text)', bg: 'var(--trust-l5-bg)', level: 5 },
  { value: 'ACCREDITED_MATERIAL', label: 'L4 Accredited Material', color: 'var(--trust-l4-text)', bg: 'var(--trust-l4-bg)', level: 4 },
  { value: 'PUBLISHED_REFERENCE', label: 'L3 Published Reference', color: 'var(--trust-l3-text)', bg: 'var(--trust-l3-bg)', level: 3 },
  { value: 'EXPERT_CURATED',      label: 'L2 Expert Curated',      color: 'var(--trust-l2-text)', bg: 'var(--trust-l2-bg)', level: 2 },
  { value: 'AI_ASSISTED',         label: 'L1 AI Assisted',         color: 'var(--trust-l1-text)', bg: 'var(--trust-l1-bg)', level: 1 },
  { value: 'UNVERIFIED',          label: 'L0 Unverified',          color: 'var(--trust-l0-text)', bg: 'var(--trust-l0-bg)', level: 0 },
];

/** Lookup trust level by enum value */
export function getTrustLevel(value: string): TrustLevel | undefined {
  return TRUST_LEVELS.find(t => t.value === value);
}
