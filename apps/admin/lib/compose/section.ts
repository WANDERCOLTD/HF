/**
 * Compose Section taxonomy — #1556 (Story 1 of EPIC #1555).
 *
 * Canonical map of every region of the composed prompt the educator might
 * touch. Two foundational concerns are routed through this taxonomy:
 *
 *   1. Field-level staleness (Story 2 #1557) — a write to a key in section X
 *      bumps section X's hash without invalidating siblings.
 *   2. Section-scoped incremental regen (Story 3 #1558) — recompose just the
 *      sections affected by a single field write.
 *
 * Each `ComposeSection` carries a `kind` discriminator:
 *   - `"config"` — read directly from `Playbook.config`; no loader at compose
 *     time. Today: `firstCallMode`, `modePolicy`. These keys are intentionally
 *     self-referential in `affecting-keys.ts` (the Playbook.config key maps to
 *     a section that reads from the same Playbook.config).
 *   - `"runtime"` — emitted by the composer pipeline (loader + transform).
 *     `PIPELINE_STATE_SECTION_LOADERS` declares which loaders each section
 *     depends on; Story 3's ADR uses this to scope partial recompose.
 *
 * Authored against the live SectionDataLoader registrations + getDefaultSections()
 * `outputKey` values; cross-checked by `affecting-keys.test.ts`. TL Q4 ruled
 * STANDALONE CONST (do not derive from `getDefaultSections()`); manual sync at
 * implementation time is the safeguard. If you add a new loader / outputKey /
 * pipeline section, extend this union AND the matching loader map below.
 *
 * Caller-scoped sections (staleness via `bumpCallerComposeTimestamp`, NOT
 * `PlaybookSectionStaleness` — playbook-grain would mark every caller stale
 * on every other caller's call):
 *   - `conversationArtifacts` — #1642 (Group A.5)
 *   - `memoryDeltas` — #1644 (Group A.5)
 *
 * Group A.5 is structurally complete; renderer sides ship as #1643 + #1645.
 */

export type ComposeSection =
  | { kind: "config"; section: "firstCallMode" | "modePolicy" }
  | {
      kind: "runtime";
      section:
        | "intake"
        | "welcome"
        | "onboarding"
        | "offboarding"
        | "nps"
        | "modulesGate"
        | "instructions"
        | "moduleMastery"
        | "loMastery"
        | "behaviorTargets"
        | "personality"
        | "contentTrust"
        | "carryOverActions"
        | "priorCallFeedback"
        | "conversationArtifacts"
        | "memoryDeltas";
    };

/**
 * The bare `section` string value — used as map keys in
 * `PIPELINE_STATE_SECTION_LOADERS`, the three `*_KEY_SECTIONS` maps, and
 * `ComposeTrace.sectionsAffectedByKey`. Derive new code from this, not
 * from the discriminated union, when you need a string discriminant.
 */
export type ComposeSectionKey = ComposeSection["section"];

/**
 * Exhaustive list of `ComposeSectionKey` values. The `satisfies` clause
 * enforces that this array stays in sync with the union — adding a new
 * section to the union without adding it here is a compile error.
 */
export const COMPOSE_SECTION_KEYS = [
  // kind: "config"
  "firstCallMode",
  "modePolicy",
  // kind: "runtime" — config-sourced (no loader at compose time)
  "intake",
  "welcome",
  "onboarding",
  "offboarding",
  "nps",
  // kind: "runtime" — pipeline-state
  "modulesGate",
  "instructions",
  "moduleMastery",
  "loMastery",
  "behaviorTargets",
  "personality",
  "contentTrust",
  "carryOverActions",
  "priorCallFeedback",
  "conversationArtifacts",
  "memoryDeltas",
] as const satisfies readonly ComposeSectionKey[];

/**
 * For each `ComposeSection`, the loader names (as registered in
 * `SectionDataLoader.ts::registerLoader(name, …)`) that must run when this
 * section is recomposed in isolation. Empty arrays mean "no loader at compose
 * time" — either a config-kind section (read from `Playbook.config`) or a
 * runtime section that is config-sourced (no per-call state).
 *
 * Consumed by Story 3 (#1558) — the ADR's loader-dependency graph derives
 * from this map. If a section's transform changes its loader dependencies,
 * update this map in the same PR or section-scoped regen for that section
 * will silently use stale data.
 *
 * TL correction: `loMastery` loader is `["callerAttributes"]` only —
 * `curriculumAssertions` feeds teaching content, NOT mastery state. Per-LO
 * mastery comes exclusively from `lo_mastery:{moduleId}:{loRef}` CallerAttribute
 * keys (read at `transforms/progress-narrative.ts:64-91` and
 * `transforms/modules.ts:804`).
 */
export const PIPELINE_STATE_SECTION_LOADERS: Record<
  ComposeSectionKey,
  readonly string[]
> = {
  // kind: "config" — read from Playbook.config directly; no loader
  firstCallMode: [],
  modePolicy: [],
  // kind: "runtime", config-sourced — no loader at compose time
  intake: [],
  welcome: [],
  onboarding: [],
  offboarding: [],
  nps: [],
  // kind: "runtime", pipeline-state — names match registered loaders
  modulesGate: ["curriculumAssertions"],
  instructions: ["goals"], // for goalAdaptationGuidance sub-field
  moduleMastery: ["callerAttributes"],
  loMastery: ["callerAttributes"], // NOT curriculumAssertions — see TL note above
  behaviorTargets: ["callerTargets"],
  personality: ["personality"],
  contentTrust: ["subjectSources"], // checkFreshness runs at compose time via transforms/trust.ts
  carryOverActions: ["openActions"],
  priorCallFeedback: ["priorCallFeedback"],
  conversationArtifacts: ["conversationArtifacts"], // #1642 — staleness via bumpCallerComposeTimestamp (caller-scoped)
  memoryDeltas: ["memoryDeltas"], // #1644 — caller-scoped, same staleness contract
};
