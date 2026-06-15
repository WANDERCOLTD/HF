# ADR: Journey setting registry as single source of truth

**Date:** 2026-06-15
**Status:** Accepted
**Context:** Epic [#1675](https://github.com/WANDERCOLTD/HF/issues/1675) Phase 0 / story [#1676](https://github.com/WANDERCOLTD/HF/issues/1676)

## Context

The Course Design tab edits 61 settings that affect the learner journey,
spread across:
- 11 lenses on the Design tab `ConsoleShell`
- 6 chip-row entries on the new DesignerShell Inspector
- 22 sidetray editors (different save semantics)
- ~15 lens-only settings that require leaving the Preview entirely
- ~12 settings with no UI at all (only changeable via direct DB edits)

The relationship between an educator setting and what the AI says was
undocumented. `lib/compose/section-staleness.ts` maintained its own
`SECTION_INPUTS_BY_KEY` map; loaders maintained another; the Inspector
renderers each held a third (implicit) map of "what does this setting
change?". Drift between any two produced stale ComposedPrompts.

Epic #1675 introduces a new Journey tab as the first tab of the Course
Design page — tri-pane (LH grouped menu / Preview canvas / RH Inspector
typed-form editors). The architectural foundation it needs is a
**single source of truth for setting metadata** before any UI work
starts.

This ADR records the choice of that foundation.

## Decision

Introduce `lib/journey/setting-contracts.ts` + 45-entry registry as the
authoritative source of truth for every journey-affecting setting. A
sibling `lib/settings/voice-setting-contracts.ts` carries the 11 voice
settings that move out of Design tab to Settings tab in Phase 6.

The registry is hand-curated. Each entry is a
`JourneySettingContract` carrying: id, group, educatorLabel, storagePath
(optionally structured), control (13-kind vocabulary), cascadeSources,
composeImpact (sections + 7 impact kinds + requiresReprompt boolean),
previewLocators (Inspector ↔ Preview sync), optional autoEnableLinks
(server-enforced parent/child coupling), optional writeGate
("operator-only" pipeline-boundary protection).

Five decision points, captured below.

## Decision 1 — Single registry over per-lens hardcoding

**Why this matters:** the per-lens approach (existing) duplicates
metadata across 11 renderers and `section-staleness.ts`. Drift = stale
ComposedPrompts.

**Alternatives considered:**
- **(a) Generate the registry from `PlaybookConfig` types.** Rejected.
  Types cannot supply `educatorLabel`, `group`, `control`, or
  `previewLocators` — those are semantic claims the schema doesn't
  encode. Code-generation gives us the path and TypeScript type but a
  human still has to assign the rest. Hand-curated with a `satisfies`
  scaffold is the tradeoff that compiles correctness while leaving
  authorship to the educator-facing decisions.
- **(b) Keep per-lens hardcoding; document the chain externally.**
  Rejected. Documentation drifts; types don't. The point of the
  registry IS to make drift a compile error.

**Chosen:** Single hand-curated registry with `JOURNEY_SETTINGS_BY_ID`
unique-key enforcement and a completeness vitest covering 15 invariants
(per AC §6 of story #1676).

## Decision 2 — Journey-time ordering for groups, not config-category

**Why this matters:** educators don't think in config categories. They
think "what happens at the top of Call 1?". When the group ordering
mirrors the journey, scrolling the Inspector menu IS walking the journey.

**Alternatives considered:**
- **(a) Group by config category** (e.g. "Session flow" / "Scoring" /
  "Voice" / "Tolerances"). Rejected — that's what the existing
  ConsoleShell does and it's the UX we're replacing.
- **(b) No groups; flat list filtered by phase-filter chips.**
  Rejected — 45 settings without grouping is overwhelming on first
  load. Filters help power users; groups help first-time educators.
  We keep both.
- **(c) Allow cross-listing (one setting in multiple groups).**
  Considered, deferred. Editor-time confusion ("which copy is the real
  one?") outweighs discoverability benefit. The cross-registry
  `interruptSensitivity` is the one approved cross-listing — both
  copies share storagePath, the completeness vitest pins it. Future
  cross-listings need explicit ADR follow-up.

**Chosen:** 7 groups (G1..G7) ordered chronologically; G2 (Call 1
opening & assessment) anchors `firstCallMode + welcomeMessage +
preTestStop` together — answering operator's "where does first-call
assessment live?" question that surfaced 2026-06-15.

## Decision 3 — Voice moves to Settings tab (not Journey)

**Why this matters:** voice settings (provider, voiceId, transcriber,
timeouts, cost cap) change the call engine, not the prompt text. They
have no `composeImpact.sections`. Putting them in the Journey tab would
require Inspector renderers for settings that don't affect the journey
they're sitting next to.

The current Design tab Voice Flow lens AND the Settings > Voice
Providers page already split voice in two — duplicate edit surfaces
with overlapping fields. The Journey Editor migration is the right
moment to consolidate.

**Alternatives considered:**
- **(a) Keep voice on Journey tab as G8** (the earlier 8-group draft).
  Rejected per operator decision 2026-06-15 — voice belongs with other
  cross-cutting Settings (integration, demo, access).
- **(b) Keep two split surfaces (Design Voice Flow + Settings Voice
  Providers).** Rejected — the duplication is the problem, not the
  solution.

**Chosen:** Voice moves to Settings tab as `SETTINGS_GROUPS.S1_voice`,
11 entries in `VOICE_SETTINGS`. Phase 6 ships the migration in parallel
with phases 1–5; merges after Phase 4 to avoid the DesignerShell CSS
conflict (see Tech Lead Q6 in epic #1675).

The single shared id (`interruptSensitivity`) appears in both
registries — see CONTRACTS-JOURNEY.md §7.

## Decision 4 — `requiresReprompt` split: live diff vs Save & reprompt

**Why this matters:** the bidirectional Preview ↔ Inspector sync (Phase
4) wants to redraw the Preview canvas on every edit so educators see
cause→effect immediately. But some settings feed AI-touching compose
steps (e.g. `priorCallFeedback` with synthesis on). Live-redrawing those
would fire a fresh AI synthesis on every keystroke — cost + latency
prohibitive.

**Alternatives considered:**
- **(a) Live diff for everything; cache aggressively.** Rejected —
  cache invalidation on AI sections is fragile.
- **(b) Skip live diff entirely; "Save" button only.** Rejected — kills
  the killer feature (educator sees impact before commit).
- **(c) Skip live diff only for AI-touching sections; show "Save &
  reprompt" CTA.** Chosen.

**Chosen:** `composeImpact.requiresReprompt: boolean` per entry. Default
`false` (live diff). Set `true` for AI-touching sections. The
completeness vitest pins that operator-only settings with section
impact MUST be `requiresReprompt: true` (operator-driven changes are
intentional, batchable, and worth the AI cost on commit).

## Decision 5 — `writeGate` extends the CHAIN-CONTRACTS pipeline-boundary pattern

**Why this matters:** `docs/CHAIN-CONTRACTS.md` already names the
"pipeline-boundary write protection" pattern for the prompt + transcript
chain. The Journey Editor introduces a parallel boundary: settings that
the educator owns and the pipeline must never mutate (e.g.
`rewardStrategy` — pipeline reading it is fine, pipeline writing it
would self-reference).

**Alternatives considered:**
- **(a) Inline check in each PATCH route.** Rejected — repeating the
  check across 45 routes is the same problem the registry is solving.
- **(b) Single registry-derived check in the PATCH handler.** Chosen.

**Chosen:** `writeGate?: "operator-only"` on each contract. Phase 2
wires a runtime check in the PATCH route that rejects writes from a
pipeline service-token. The check fails closed. Settings carrying
`writeGate` today: 7 entries (intakeSpecId, intakeConsentFlow,
agentTunerNlpEnabled, rewardStrategy, maxCallDuration, phoneNumber,
vapiAssistantId).

Sister pattern: `CHAIN-CONTRACTS.md` §3.

## Tech Lead delta (folded in)

Three revisions from Tech Lead review 2026-06-15 that didn't appear in
the BA-authored issue body but landed in the implementation:

1. **Structured StoragePath.** Bare-string `storagePath` cannot address
   `sessionFlow.stops[]` (discriminated-union array) or
   `Playbook.config.modules[]` (id-keyed). `StoragePath = string |
   StoragePathStruct` where the struct carries `arrayKey`,
   `selectorValue`, and `writeMode`. Tested: G2 `firstCallTargets` and
   G2 `preTestStop` exercise the structured form.

2. **`autoEnableLinks` are server-enforced atomically.** Cosmetic
   gray-out alone leaves the DB in a coupled-by-UI-but-decoupled-by-API
   state when the parent is mutated outside the Journey Editor (CLI,
   service token, second tab). PATCH handler reads `autoEnableLinks`
   and applies linked writes in the same `$transaction` as the parent
   write. UI gray-out + "Decouple" toggle remain cosmetic.

3. **Registry is THE source of truth for `section-staleness.ts`.**
   Phase 2 deletes `SECTION_INPUTS_BY_KEY` and derives the same map
   from `JOURNEY_SETTINGS`. Sole authoring path. `affecting-keys.test.ts`
   asserts the derived equivalent during the migration.

## Consequences

**Positive:**
- One file lists every journey setting. New phases derive from it.
- Compile-time drift detection: removing a `ComposeSectionKey` breaks
  the vitest before merge.
- Educator-facing labels live with the storage path; no more "what does
  the toggle in lens X actually write?" archaeology.
- Server-side auto-enable + writeGate kill two real bug classes
  (UI-only state divergence; pipeline-self-mutation feedback loops).

**Negative:**
- Adding a new journey setting now requires updating the registry
  AND the per-group exact-count assertion in the completeness vitest.
  Friction by design — we want every new entry curated.
- Hand-curation took ~5 hours for Phase 0. Each Phase 1–6 PR
  authors more entries as the system grows; estimated +5min/entry.

**Neutral:**
- The 7-group ordering pins us to a specific journey mental model.
  If the model changes (e.g. introducing a new journey phase like
  "post-course follow-up"), we add G8 + a phase filter. Cheap.
- `interruptSensitivity` is the one approved cross-registered id.
  Future cross-registrations need ADR follow-up.

## Out of scope for Phase 0

- Any UI (tri-pane, Inspector, control library) — Phase 1+
- Typed control primitives — Phase 1
- Converting existing renderers — Phase 2
- `section-staleness.ts` migration — Phase 2
- Voice tab migration — Phase 6
- API routes for setting writes — Phase 2
- ESLint rule blocking new `prisma.playbook.update({data: {config: {...}}})` outside the registry — Phase 5

## References

- Epic: [#1675](https://github.com/WANDERCOLTD/HF/issues/1675)
- Story: [#1676](https://github.com/WANDERCOLTD/HF/issues/1676)
- Sister contracts:
  [`CHAIN-CONTRACTS.md`](../CHAIN-CONTRACTS.md),
  [`CONTRACTS-PLAYBOOK-CURRICULUM.md`](../CONTRACTS-PLAYBOOK-CURRICULUM.md)
- This contract: [`CONTRACTS-JOURNEY.md`](../CONTRACTS-JOURNEY.md)
- Reuse-finder report (2026-06-15) — existing primitives the Phase 1
  control library will wrap (BandingPicker, VoiceConfigSection,
  CascadeValue + LayerBadge, FancySelect, FieldHint)
- Tech Lead review (2026-06-15) — structural revisions in
  Decisions 4 + 5 + "Tech Lead delta" section above
- Sibling registry pattern: `lib/goals/strategies/types.ts` + custom
  ESLint rule `no-bare-strategy-key.mjs` (PR #1603)
