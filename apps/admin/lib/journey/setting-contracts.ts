/**
 * Journey Setting Contracts — Phase 0 of Epic #1675 (story #1676).
 *
 * Single source of truth for every setting that affects the learner
 * journey. Sibling to `docs/CHAIN-CONTRACTS.md` and
 * `docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`. See `docs/CONTRACTS-JOURNEY.md`
 * for the chain (setting → composer-section → preview-bubble).
 *
 * Architectural pins (from Tech Lead review 2026-06-15, captured in ADR):
 *
 *  1. `StoragePath` is optionally structured — arrays with discriminated
 *     unions (`sessionFlow.stops[]`) and id-keyed lists
 *     (`Playbook.config.modules[]`) cannot compress to bare dot-paths.
 *     The structured form carries `arrayKey` + optional `selectorValue` +
 *     optional `writeMode`. Bare-string remains valid for the simple case.
 *
 *  2. This registry is the SINGLE source of truth for
 *     `lib/compose/section-staleness.ts`. The staleness layer should
 *     derive `SECTION_INPUTS_BY_KEY` from this registry, not maintain
 *     its own parallel map. Migration is Phase 2 work.
 *
 *  3. `autoEnableLinks` are enforced SERVER-SIDE in the PATCH handler
 *     within a single `$transaction`. UI graying-out is cosmetic. A
 *     "Decouple" toggle clears the auto-written value AND removes the
 *     link from the in-memory model.
 *
 *  4. Entries are hand-curated — TypeScript types can give us the
 *     storage shape but cannot supply educatorLabel / group / control
 *     kind / preview locators / educator-facing impact classification.
 *     The `JOURNEY_SETTINGS_BY_ID` map enforces unique ids at compile
 *     time via duplicate-key detection.
 *
 *  5. `writeGate: "operator-only"` marks a setting that the pipeline
 *     must never mutate (chain-contract boundary protection — see
 *     `docs/CHAIN-CONTRACTS.md`). The completeness vitest pins that
 *     `writeGate === "operator-only"` implies `requiresReprompt: true`.
 */

import type { ComposeSectionKey } from "@/lib/compose";
import type { JourneyGroup } from "./setting-groups";

/** Forward-declared union for the cross-tab group field — kept here so
 *  `lib/journey/` doesn't import from `lib/settings/` (Settings depends
 *  on Journey, not the other way around). The completeness vitest checks
 *  that this set agrees with `SETTINGS_GROUPS` in
 *  `lib/settings/voice-setting-contracts.ts`. */
type SettingsGroupKey = "S1_voice" | "S2_integration" | "S3_demo" | "S4_access";

// =============================================================
// StoragePath — where a setting binds in the DB
// =============================================================

/** Bare dot-path is the common case. Structured form handles array
 *  addressing and write semantics. */
export type StoragePath = string | StoragePathStruct;

export interface StoragePathStruct {
  /** Dot path from the root model. Use `[]` placeholder for array slots
   *  e.g. `"playbook.config.sessionFlow.stops[]"`. */
  path: string;

  /** Required when `path` traverses an array — the field on each item that
   *  identifies the right element. Examples: `"id"` for AuthoredModule,
   *  `"kind"` for JourneyStop's discriminated union. */
  arrayKey?: string;

  /** Optional fixed selector — when array element is identified by a
   *  literal value (e.g. JourneyStop where `kind === "pre_test"`). The
   *  PATCH handler picks the element whose `[arrayKey] === selectorValue`. */
  selectorValue?: string;

  /** How the write should apply at the target.
   *   - `"replace"` (default): write the whole sub-object
   *   - `"merge"`: shallow-merge into the parent object */
  writeMode?: "merge" | "replace";
}

// =============================================================
// Control vocabulary — Phase 1 control library dispatches on this
// =============================================================

export const CONTROL_TYPES = [
  "toggle",         // boolean
  "select",         // one-of (single-select)
  "multi-select",   // many-of
  "text",           // single-line + textarea (renderer handles long)
  "number",         // numeric input
  "slider",         // bounded numeric
  "duration",       // duration value (ms / sec / min — UI-formatted)
  "json-fallback",  // power-user JSON editor for opaque sub-objects
  "phases",         // compound: phase-list editor (onboarding/offboarding)
  "targets",        // compound: per-parameter slider repeater
  "banding",        // BandingPicker wrap
  "voice-picker",   // (Settings-tab only — provider + voiceId combo)
  "stop",           // compound: JourneyStop with discriminated trigger
  // #1752 — Theme 1b Inspector primitives.
  "min-target",     // {min: number, target: number} pair
  "array-editor",   // array-of-structs editor with per-id row schemas
] as const;

export type ControlType = (typeof CONTROL_TYPES)[number];

// =============================================================
// Compose impact — how the setting touches the prompt pipeline
// =============================================================

export const COMPOSE_IMPACT_KINDS = [
  "section-content",   // changes the text of a compose section
  "section-enable",    // toggles a section on/off
  "cascade-override",  // overrides a domain/group-level cascade value
  "stop-timing",       // changes when a journey stop fires
  "scoring-weight",    // affects how scores are computed
  "persona-style",     // changes tone/style without section swap
  "sequence-policy",   // changes which module/LO is selected next
] as const;

export type ComposeImpactKind = (typeof COMPOSE_IMPACT_KINDS)[number];

export interface ComposeImpact {
  /** Composer sections this setting feeds. Reads in this list make the
   *  Inspector show "↳ affects N section(s)" chip; writes bump those
   *  sections' staleness hash. */
  sections: readonly ComposeSectionKey[];

  /** Coarse classification driving icon + colour + ordering. */
  kinds: readonly ComposeImpactKind[];

  /** When true, the Inspector shows a "Save & reprompt" CTA instead of
   *  a live diff (used for AI-touching sections that recompose lazily). */
  requiresReprompt: boolean;
}

// =============================================================
// Cascade source — where the effective value resolves from
// =============================================================

/** Where the effective value resolves from. `system` is the static
 *  default; `domain` is the Domain-level override; `group` is the
 *  Playbook (course) level override. Caller-level overrides are NOT
 *  in scope for the Journey Editor (per-learner ad-hoc adjustments live
 *  in adaptations, not the course config). */
export interface CascadeSource {
  level: "group" | "domain" | "system";
  storagePath: string;
}

// =============================================================
// Preview locator — how the setting appears in the Preview canvas
// =============================================================

export interface PreviewLocator {
  /** ComposeSectionKey of the bubble in the Preview canvas. */
  section: ComposeSectionKey;
  /** Optional human hint for the highlight ("first paragraph",
   *  "module list", …). Used by Phase 4's bidirectional sync. */
  hint?: string;
}

// =============================================================
// Auto-enable link — hard parent/child coupling, server-enforced
// =============================================================

/** Declarative coupling: when THIS setting takes `whenValue`, `targetId`
 *  is auto-forced to `enforce` server-side in the same `$transaction`.
 *  The Inspector grays out `targetId` and exposes a "Decouple" toggle
 *  if `decoupleAllowed`. See `docs/CONTRACTS-JOURNEY.md` §6. */
export interface AutoEnableLink {
  targetId: string;
  whenValue: unknown;
  enforce: unknown;
  decoupleAllowed: boolean;
  /** Educator-facing explanation in the gray-out tooltip. */
  reason: string;
}

// =============================================================
// Slice C (#1721) — menu buckets
// =============================================================

/** The 14 educator-intent buckets, chronological by session moment.
 *  Authored against `docs/draft-issues/ielts-pre-voice-gap-analysis.md` —
 *  the IELTS spec organises by *what happens in a session* rather than
 *  by which DB column the value lives in. See `lib/journey/menu-items.ts`
 *  for the labels + captions + journey-group dividers.
 *
 *  `N_voice` is the cross-call exception — voice provider / id / speed
 *  / interruption tolerance affect every call uniformly rather than a
 *  specific session moment. It surfaces in the Journey LH (and Cmd+K)
 *  alongside the chronological buckets so the educator has one
 *  navigation index, not two. The 11 voice settings ALSO appear in the
 *  Settings tab under S1_voice — same registry entries, two surfaces. */
export type JourneyMenuBucketId =
  | "A_intake"
  | "B_call1_opening"
  | "C_teaching_style"
  | "D_question_flow"
  | "E_learner_visual"
  | "F_stall_recovery"
  | "G_session_length"
  | "H_closing"
  | "I_scoring"
  | "J_feedback"
  | "K_between_calls"
  | "L_mid_journey"
  | "M_end_of_course"
  | "N_voice";

// =============================================================
// JourneySettingContract — the registry entry
// =============================================================

export interface JourneySettingContract {
  /** Stable camelCase slug — used in URL params, Inspector routing,
   *  autoEnableLinks references. Unique across both journey + voice
   *  registries except for the documented `interruptSensitivity`
   *  cross-reference (see `docs/CONTRACTS-JOURNEY.md` §7). */
  id: string;

  /** Which Inspector group the setting belongs to. Journey-tab entries
   *  use `JourneyGroup` (G1..G7); Settings-tab voice entries use
   *  `SettingsGroup` (S1_voice). The completeness vitest pins that
   *  entries in `JOURNEY_SETTINGS` use only `JourneyGroup` keys. */
  group: JourneyGroup | SettingsGroupKey;

  /** Educator-facing label in the LH menu + Inspector header + Cmd+K. */
  educatorLabel: string;

  /** Optional one-line helper. Shown in FieldHint. */
  helpText?: string;

  /** Where the value lives in the DB. */
  storagePath: StoragePath;

  /** Which control to render. */
  control: ControlType;

  /** Resolve-cascade roots that contribute to the effective value.
   *  Empty `[]` means the setting has no cascade (course-only). */
  cascadeSources: readonly CascadeSource[];

  /** The CHAIN-contract link to compose pipeline + Preview bubbles. */
  composeImpact: ComposeImpact;

  /** Bidirectional Preview ↔ Inspector sync.
   *  - Hover setting in Inspector → Preview bubble pulses
   *  - Click bubble in Preview → Inspector scrolls to setting
   *  Empty `[]` when the setting has no visible Preview affordance
   *  (e.g. runtime / post-call / sequence-policy settings). */
  previewLocators: readonly PreviewLocator[];

  /** Hard auto-enable couplings — see `AutoEnableLink`. Optional. */
  autoEnableLinks?: readonly AutoEnableLink[];

  /** Pipeline-boundary guard. `"operator-only"` declares the setting
   *  must never be mutated inside the adaptive loop (per
   *  `docs/CHAIN-CONTRACTS.md`). Phase 2 writes a server-side check
   *  that rejects pipeline-originated writes when this is set. */
  writeGate?: "operator-only";

  /** Power-user only — JSON path the "Edit as JSON" fallback opens to.
   *  Defaults to `storagePath` when omitted. */
  jsonFallbackPath?: string;

  /** Enum values for `select` / `multi-select` / `radio` controls.
   *  When present, the Inspector mounts these as the dropdown options.
   *  Absent for free-form selects whose options come from a runtime
   *  fetch (e.g. voiceId — needs the provider's voice catalog). */
  options?: ReadonlyArray<{ value: string; label: string }>;

  /** Slice C (#1721) — which menu bucket this setting belongs to. Buckets
   *  are organised by *session moment* (the educator's mental model from
   *  the IELTS pre-voice gap analysis) rather than by storage entity. See
   *  `lib/journey/menu-items.ts` for the 13 bucket ids. Required — the
   *  completeness vitest fails CI if missing. */
  menuGroupKey?: JourneyMenuBucketId;

  /** Slice C (#1721) — scope of the setting. Default `"course"` for
   *  settings stored on `PlaybookConfig`. Module-scoped settings (G8 /
   *  IELTS Theme 1) use `"module"` and store on `AuthoredModule.settings`.
   *  Inspector renders mixed-scope buckets with nested sub-groups
   *  ("Course defaults" / "This module: Assessment"). */
  scope?: "course" | "module";

  /** Slice C (#1721) — knob key for the `lib/cascade/effective-value.ts`
   *  resolver. When set, `useEffectiveValue` calls `resolveEffective()`
   *  to get the layered cascade envelope (System → Domain → Course →
   *  effective). When absent, the Inspector reads via snapshot
   *  (`resolveValueAtPath`) and CascadeTraceBreadcrumb hides.
   *
   *  Defaults to `id` when omitted — used for the few entries where
   *  the cascade family key differs (e.g. `skillScoringEmaHalfLife`
   *  contract id resolves through `skillScoringEmaHalfLifeDays` knob).
   *  `isResolvableKnob(cascadeKnobKey)` is the runtime gate. */
  cascadeKnobKey?: string;
}

// Re-export for sibling registries (Settings tab Voice subset).
export type { JourneyGroup } from "./setting-groups";
