# Contracts — Journey Editor Setting Registry

> Sister to [`CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) (pipeline stage
> boundaries) and [`CONTRACTS-PLAYBOOK-CURRICULUM.md`](./CONTRACTS-PLAYBOOK-CURRICULUM.md)
> (model integrity).
>
> Ships in epic [#1675](https://github.com/WANDERCOLTD/HF/issues/1675) /
> story [#1676](https://github.com/WANDERCOLTD/HF/issues/1676).

## §1 — Purpose & scope

The Journey Editor refactor (epic #1675) replaces a fragmented editing
UX (3 surfaces, ~22 settings inline + 15 lens-only + 12 no-UI) with one
tri-pane editor where every journey-affecting setting is editable
through a typed control library. The registry codified in this contract
is the **single source of truth** for:

| Consumer | Reads from registry |
|---|---|
| Phase 1 control library | `control` field → renders correct `<JourneyField>` primitive |
| Phase 2 Inspector renderer refactor | `group` + `composeImpact` → groups settings into Inspector panels |
| Phase 2 `section-staleness.ts` migration | `composeImpact.sections` → derive `SECTION_INPUTS_BY_KEY` |
| Phase 3 gap-fill audit | "every entry without a renderer file" = remaining work |
| Phase 4 bidirectional Preview ↔ Inspector sync | `previewLocators` → hover/click highlight map |
| Phase 4 PATCH route | `autoEnableLinks` + `writeGate` → server-side atomic enforcement |
| Phase 5 Cmd+K | `educatorLabel` → fuzzy search corpus |
| Phase 5 Edit-as-JSON | `jsonFallbackPath` → opens JSON editor at right path |
| Phase 6 Voice migration | sibling `VOICE_SETTINGS` registry uses same shape |

**In scope:** every setting whose value changes (a) what the AI says or
does during any call, (b) which calls happen and when, (c) how learner
progress is measured.

**Out of scope:** integration credentials, debug flags, RBAC overrides,
non-journey demo flags. These live on the Settings tab under
`SETTINGS_GROUPS.S2_integration / S3_demo / S4_access` (future
registries, post-Phase-0).

## §2 — Registry structure

The full type set lives in
[`apps/admin/lib/journey/setting-contracts.ts`](../apps/admin/lib/journey/setting-contracts.ts).

```ts
interface JourneySettingContract {
  id: string;                                  // stable camelCase slug
  group: JourneyGroup | SettingsGroupKey;      // G1..G7 or S1_voice
  educatorLabel: string;
  helpText?: string;
  storagePath: StoragePath;                    // string | StoragePathStruct
  control: ControlType;                        // 13-kind vocabulary
  cascadeSources: readonly CascadeSource[];
  composeImpact: ComposeImpact;                // sections + kinds + requiresReprompt
  previewLocators: readonly PreviewLocator[];  // for Inspector ↔ Preview sync
  autoEnableLinks?: readonly AutoEnableLink[]; // hard parent/child coupling
  writeGate?: "operator-only";                 // pipeline-boundary protection
  jsonFallbackPath?: string;                   // power-user JSON editor anchor
}
```

`StoragePath` is **optionally structured** — a bare string is the common
case; the structured form carries `arrayKey`, `selectorValue`, and
`writeMode` to address discriminated-union arrays (`sessionFlow.stops[]`)
and id-keyed lists (`Playbook.config.modules[]`). See Tech Lead review
2026-06-15 in the ADR (§ "Structured StoragePath") for rationale.

The registry index exports:

| Symbol | Shape | Use |
|---|---|---|
| `JOURNEY_SETTINGS` | `readonly JourneySettingContract[]` | Ordered list — Inspector LH menu source-of-truth |
| `JOURNEY_SETTINGS_BY_ID` | `Record<string, JourneySettingContract>` | O(1) lookup; autoEnableLinks resolution |
| `JOURNEY_SETTINGS_BY_GROUP` | `Record<JourneyGroup, ...>` | Inspector group panels |
| `VOICE_SETTINGS` | `readonly JourneySettingContract[]` | Settings-tab Voice lens |
| `VOICE_SETTINGS_BY_ID` | `Record<string, ...>` | Cross-registry lookups |

## §3 — Group map (G1..G7)

Groups are **ordered by journey time**, not by config category. Scrolling
the Inspector LH menu reads as the learner's flow.

| Group | Label | Anchored at | Count |
|---|---|---|---|
| **G1** | Sign-up & Intake | Pre-call | 5 |
| **G2** | Call 1 — opening & assessment | Call 1 start | 6 |
| **G3** | Call 1 — teaching | Call 1 middle | 4 |
| **G4** | Every call — teaching style | Calls 2+ | 17 |
| **G5** | Mid-journey stops | Between calls 2+ | 3 |
| **G6** | End of course / offboarding | Final call | 4 |
| **G7** | Scoring & sequencing | Cross-cutting | 6 |
| | | **Total** | **45** |

The phase-filter chip row (`JOURNEY_PHASE_FILTERS`) collapses G2/G3 under
a single "Call 1" filter (chronologically adjacent + the same educator
mental scope), yielding 6 phase chips + "All" = 7 chips total.

Per-group authoritative entries are listed in the issue #1676 audit
table; the canonical source is
[`apps/admin/lib/journey/setting-contracts.entries.ts`](../apps/admin/lib/journey/setting-contracts.entries.ts).

## §4 — composeImpact contract

Every entry declares both the **sections** it touches and the **kinds**
of impact.

```ts
interface ComposeImpact {
  sections: readonly ComposeSectionKey[];
  kinds: readonly ComposeImpactKind[];
  requiresReprompt: boolean;
}
```

### The 7 impact kinds

| Kind | Means | Treatment in Inspector |
|---|---|---|
| `section-content` | Setting feeds bubble text | Show live diff under field |
| `section-enable` | Setting toggles whether the bubble exists | Show "Section will appear / disappear" preview |
| `cascade-override` | Course-level override of a Domain default | "Reset to default" affordance |
| `stop-timing` | Setting changes when a journey stop fires | Render under the stop's mini-timeline |
| `scoring-weight` | Setting affects score / mastery thresholds | "Show downstream Goals impact" link |
| `persona-style` | Setting changes tone without section swap | No preview diff (style is verbal, hard to render) |
| `sequence-policy` | Setting changes module/LO ordering | "Recompute journey order" CTA |

### `requiresReprompt: boolean`

- **`false` (default)**: Inspector shows a live diff. The Preview redraws
  on every edit (debounced 300ms). Used for `section-content` /
  `section-enable` settings whose effect is deterministic.
- **`true`**: Inspector shows a "Save & reprompt" CTA. The Preview stays
  on the *prior* snapshot until the educator commits. Required for
  AI-touching sections (`priorCallFeedback` with synthesis on) because
  a fresh AI synthesis would fire on every keystroke (cost + latency).
  Also required for `operator-only` settings with section impact — see §6.

The completeness vitest pins:
- `requiresReprompt === true` → `sections.length ≥ 1` (no reprompt without impact)
- `writeGate === "operator-only"` AND `sections.length ≥ 1` → `requiresReprompt === true`

## §5 — cascadeSources precedence

Effective value resolves bottom-up:

```
group (Playbook.config)  ─▶  domain (Domain.*)  ─▶  system (static default)
        winning value
```

`CascadeSource[].level` declares which roots contribute. Empty array
means the setting is course-only (no inherited default). The Inspector
shows the effective value with a `LayerBadge` ("from Domain" /
"course override"); clicking the badge opens the cascade trace.

The Caller level is **NOT** in scope for the Journey Editor — per-learner
ad-hoc adjustments live in **adaptations**, not the course config. If a
setting needs a learner-level override, it gets a separate
`AdaptationContract` in a later epic.

## §6 — writeGate contract — pipeline-boundary protection

`writeGate: "operator-only"` declares that the setting must never be
mutated inside the adaptive loop (EXTRACT / AGGREGATE / REWARD / ADAPT /
SUPERVISE / COMPOSE). The pipeline stages can READ these settings; they
cannot WRITE.

Settings marked `operator-only`:

| Setting | Why |
|---|---|
| `intakeSpecId` | IntakeSpec versioning is human-authored; pipeline must never swap mid-flight |
| `intakeConsentFlow` | Legal/compliance flow; only operators may change |
| `agentTunerNlpEnabled` | Toggles the operator-only AgentTuner side panel |
| `rewardStrategy` | The optimisation target. Pipeline reading is fine; writing would self-reference |
| `maxCallDuration` (voice) | Cost / safety cap; pipeline-level write would create feedback loop |
| `phoneNumber` (voice) | Provider config — runtime mutation is unsafe |
| `vapiAssistantId` (voice) | Provider config — runtime mutation is unsafe |

Phase 2 wires a runtime check in the PATCH route that rejects writes
originating from a pipeline service-token (the existing
`isPipelineActor` discriminator). The check fails closed.

Cross-reference: [`CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) §3
"Pipeline-boundary write protections" already names this pattern for
the prompt + transcript chain; `writeGate` extends it to the
setting-registry boundary.

## §7 — Voice registry cross-reference

The Voice registry
([`lib/settings/voice-setting-contracts.ts`](../apps/admin/lib/settings/voice-setting-contracts.ts))
is a sibling using the same `JourneySettingContract` type. 11 entries
under `group: "S1_voice"`. Phase 6 of the epic migrates the existing
Voice Flow lens (currently on the Design tab) and the Settings > Voice
Providers page into a single Voice lens on the Settings tab.

### The `interruptSensitivity` cross-registration

ONE id appears in both registries: `interruptSensitivity`. The journey
registry surfaces it under G4 (every-call teaching style — affects how
the AI yields conversationally); the voice registry surfaces it under
S1_voice (engineers diagnosing call-pause behaviour need to find it in
the Voice tab).

Both entries:
- Share the same `id` (`interruptSensitivity`)
- Share the same `storagePath` (`config.interruptSensitivity`)
- Differ in `group` (G4 vs S1_voice) and `educatorLabel` ("Interrupt
  sensitivity" vs "Interrupt sensitivity (voice copy)")
- Differ in `helpText` (educator-framing vs engineer-framing)

The completeness vitest pins `storagePath` equality. If a future PR
changes one side's path without the other, CI fails before merge.

The author of any new cross-registered setting MUST:
1. Use the same `id` and same `storagePath` in both registries
2. Use distinct `educatorLabel` + `helpText` reflecting each tab's audience
3. Add a row to this section documenting the cross-reference

## §8 — Landmines

### L1 — Storage paths discovered during implementation

The 45 paths in this Phase 0 PR were captured from the live audit but a
few will mismatch the actual `PlaybookConfig` shape (e.g. nested
optional objects with non-obvious default semantics). The Phase 1 PR
that wires the typed control library will be the first time we
runtime-probe these paths. **Update the registry in the same PR as the
discovery** — silent divergence is the failure mode. Document each
correction in this section.

| Discovered in PR | Setting | Original path | Corrected path | Why |
|---|---|---|---|---|
| _(placeholder — entries land as we go)_ | | | | |

### L2 — `interruptSensitivity` divergence

If Phase 6 changes how voice-side `interruptSensitivity` is stored, the
completeness vitest catches it BEFORE merge. Do NOT manually sync the
two registries — the test owns this invariant.

### L3 — `autoEnableLinks` cascade

A future setting might chain through multiple auto-enable hops (A
enforces B which enforces C). The registry can express it, but the
PATCH handler must walk the chain in a single transaction without
infinite loops. Phase 4 will add a cycle-detection check; until then,
keep auto-enable chains shallow (≤ 1 hop).

### L4 — section-staleness migration

Phase 2 will migrate `section-staleness.ts::SECTION_INPUTS_BY_KEY` to
derive from this registry. During the migration, both sources must
agree exactly. Do NOT delete the existing map until the migration PR
lands and the existing `affecting-keys.test.ts` assertions pin the
derived equivalent.

### L5 — adding NEW journey settings post-Phase-0

When a new journey-affecting setting is introduced:
1. Add an entry to `setting-contracts.entries.ts` BEFORE the read/write
   code lands. The registry is the contract.
2. Update the per-group exact-count assertion in
   `registry-completeness.test.ts` (a `46` from `45`).
3. If the setting maps onto a NEW `ComposeSectionKey`, add the key to
   `lib/compose/section.ts` (existing rule). The completeness test
   catches references to non-existent section keys.
4. **(Slice C, §17)** Assign a `menuGroupKey` from the 13 buckets in
   `lib/journey/menu-items.ts::JOURNEY_MENU_BUCKET_IDS`. The
   `hf-journey/no-bucketless-journey-setting` ESLint rule blocks the
   entry from landing without it.

## §17 — Slice C bucket model (#1721)

The Slice C LH menu reshape replaced the 45-row "one setting per row"
shape with **13 educator-intent buckets** organised by *session
moment*. The bucket model is the operator's mental model (per the
IELTS pre-voice gap analysis); the registry remains the storage-entity
truth.

See [`docs/decisions/2026-06-16-journey-bucket-shape.md`](./decisions/2026-06-16-journey-bucket-shape.md)
for the rationale + alternatives considered.

### §17.1 — The 13 buckets

Authored in `lib/journey/menu-items.ts::JOURNEY_MENU_ITEMS`. Each bucket
declares `id`, `label`, `caption`, `parentGroup` (visual G1..G7
section header), and optional `emptyReservation` linking unpopulated
buckets to a future IELTS theme (#1700).

```ts
type JourneyMenuBucketId =
  | "A_intake"
  | "B_call1_opening"
  | "C_teaching_style"
  | "D_question_flow"
  | "E_learner_visual"      // reserved for IELTS Theme 3
  | "F_stall_recovery"      // reserved for IELTS Theme 2 / 7
  | "G_session_length"
  | "H_closing"
  | "I_scoring"
  | "J_feedback"
  | "K_between_calls"
  | "L_mid_journey"
  | "M_end_of_course";
```

### §17.2 — Registry additions (additive)

Three optional fields on `JourneySettingContract`:

| Field | Type | Purpose |
|---|---|---|
| `menuGroupKey` | `JourneyMenuBucketId` | Which bucket the setting appears under in the LH. Pinned by `registry-completeness.test.ts` and `hf-journey/no-bucketless-journey-setting`. |
| `scope` | `"course" \| "module"` | Default `"course"`. `"module"` for G8 / IELTS Theme 1 settings stored on `AuthoredModule.settings`. Mixed-scope buckets render two sub-groups in the Inspector. |
| `cascadeKnobKey` | `string` | When set, `useEffectiveValue` (Slice C2) uses this as the knob-key for cascade resolution. Defaults to `id` when omitted. |

### §17.3 — Bucket relations (derived)

`lib/journey/bucket-relations.ts` exposes pure N-to-N derivers — never
written to, never cached:

| Function | Returns |
|---|---|
| `getSettingsForBucket(id)` | Every setting whose `menuGroupKey` matches |
| `getSectionsForBucket(id)` | Every `ComposeSectionKey` the bucket's settings touch (multi-pulse source) |
| `getBucketsForSection(key)` | Every bucket that touches the section (pick-strip source) |
| `splitBucketByScope(id)` | `{ course[], module[] }` split for mixed-scope buckets |

### §17.4 — UI chain

```
LH bucket click
  → useJourneySelection.setBucketId(id) writes ?j_bucket=<id> to URL
  → JourneyInspectorPanel mounts every setting in getSettingsForBucket(id)
  → useBubblePulse adds .hf-preview-pulse to every bubble whose
    data-compose-section appears in getSectionsForBucket(id)
    (persistent — Slice C3 #1738 changed this from a 1.8s flash to an
    infinite pulse held for the lifetime of the LH selection)

Preview bubble click
  → CourseJourneyTab.handlePreviewSectionSelect(section)
  → getBucketsForSection(section) returns ordered list
  → if 1 bucket: select it
  → if 2+: select the first chronologically AND render PreviewLocatorHint
    pick-strip so the operator can switch buckets without scrolling LH

Cmd+K palette
  → search "<query>" over JOURNEY_SETTINGS + VOICE_SETTINGS
  → Enter selects a setting → look up owner.menuGroupKey →
    selection.setBucketId(owner.menuGroupKey)
  → placeholder copy shows derived counts: "Search N settings across
    13 buckets…" (Slice C3 #1738)
```

### §17.5 — writeGate UI signal (Slice C3 #1738)

When a contract carries `writeGate: "operator-only"`, the Inspector
renders an `<WriteGateLockChip>` above the row — a non-interactive
status chip with a lock glyph and "Operator-only" label. The chip is
the educator-visible mirror of the chain-contract boundary documented
at `docs/CHAIN-CONTRACTS.md` (the adaptive pipeline must never mutate
these settings). The chip is cosmetic — the structural protection is
the pipeline-side check; the chip exists so operators see at a glance
which settings the loop won't touch.

### §17.6 — Guards (Lattice Guards pillar)

| Guard | Where | What it blocks |
|---|---|---|
| `hf-journey/no-bucketless-journey-setting` | `eslint-rules/no-bucketless-journey-setting.mjs` (#1738) | A new `JOURNEY_SETTINGS` entry without `menuGroupKey`. Error severity from day 1. Allow-list: `lib/settings/voice-setting-contracts.ts` + test files. |
| `registry-completeness.test.ts` | `tests/lib/journey/registry-completeness.test.ts` | Same invariant at test time + per-group counts + Compose section reference integrity. |
| `.claude/rules/cascade-reuse.md` | rule doc (#1737) | Snapshot-read anti-pattern for cascade-resolvable values. Names `useEffectiveValue` + `<CascadeValue>` + `<LayerBadge>` as the canonical read-side path. |

## See also

- [`docs/CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) — original pipeline-stage chain-contract pattern
- [`docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`](./CONTRACTS-PLAYBOOK-CURRICULUM.md) — model integrity chain-contract
- [`docs/decisions/2026-06-15-journey-setting-contracts.md`](./decisions/2026-06-15-journey-setting-contracts.md) — ADR
- [`apps/admin/lib/journey/setting-contracts.ts`](../apps/admin/lib/journey/setting-contracts.ts) — types
- [`apps/admin/lib/journey/setting-groups.ts`](../apps/admin/lib/journey/setting-groups.ts) — G1..G7 enum
- [`apps/admin/lib/journey/setting-contracts.entries.ts`](../apps/admin/lib/journey/setting-contracts.entries.ts) — 45 entries
- [`apps/admin/lib/settings/voice-setting-contracts.ts`](../apps/admin/lib/settings/voice-setting-contracts.ts) — 11 voice entries
- [`apps/admin/tests/lib/journey/registry-completeness.test.ts`](../apps/admin/tests/lib/journey/registry-completeness.test.ts) — 15 integrity pins
