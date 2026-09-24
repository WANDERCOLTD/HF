# Wizard Enum Coverage — chat-tool merge-path validation

> Every chat-tool wizard input field that carries a value drawn from a
> registered union type MUST be validated by a runtime type guard
> before being written to `Playbook.config`. The validator lives at
> `apps/admin/lib/content-trust/resolve-config.ts` (`isTeachingMode`,
> `isInteractionPattern`, …); the canonical SET data it reads lives at
> `apps/admin/lib/wizard/enum-sets.ts`.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (the
> WRITE-side validate-before-execute pattern this rule extends to the
> wizard merge surface), [`spec-readonly-boundary.md`](./spec-readonly-boundary.md)
> (HF-canonical IP boundary), and [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (registry storagePath → transform reader, same Coverage pattern).
> Part of the Coverage pillar of HF Lattice (Chain Contracts × Guards
> × Cascade × Rules × Coverage).
>
> Story: [#1995](https://github.com/WANDERCOLTD/HF/issues/1995). Born
> of the live IELTS Speaking Practice incident on hf_sandbox 2026-06-18
> — `Playbook.config.teachingMode = "directive"` shipped to production
> via the chat-wizard's `create_course` merge path. PR #1993 added
> read-side defensive fallback; this rule closes the write-side reuse
> gap.

## Rule

When you write a new chat-tool field that accepts an enum value, OR
modify an existing one, EVERY layer below must be aligned:

1. **Source of truth** — the canonical SET lives at
   [`apps/admin/lib/wizard/enum-sets.ts`](../../apps/admin/lib/wizard/enum-sets.ts).
   Import the SET; do not inline a copy. Pre-existing inline whitelists
   in `lib/wizard/detect-course-config.ts` were migrated to this
   module in #1995.

2. **Runtime type guard** — every SET has a sibling guard in
   [`apps/admin/lib/content-trust/resolve-config.ts`](../../apps/admin/lib/content-trust/resolve-config.ts)
   (`isTeachingMode`, `isInteractionPattern`, `isAudience`,
   `isPlanEmphasis`, `isLessonPlanModel`, `isFirstCallMode`,
   `isProgressionMode`). Adding a new enum-bearing field requires
   landing a guard in the same PR.

3. **Chat-tool merge path** — every chat-tool executor that writes the
   field MUST route through the matching guard. The four call sites
   today:

   - `apps/admin/lib/chat/wizard-tool-executor/tools/create_course/_new-config-merge.ts`
   - `apps/admin/lib/chat/wizard-tool-executor/tools/create_course/_reuse-config-merge.ts`
   - `apps/admin/lib/chat/admin-tool-handlers.ts::handleUpdatePlaybookConfig`
     (via `filterEnumBearingUpdates`)
   - Any new chat tool that mutates `Playbook.config.<enum>` lands a
     guard call too.

   The pattern: invalid value → log + skip the field. The merge
   proceeds for valid fields so the operator's other edits land.

4. **AI tool input schema** — the field's schema in
   `apps/admin/lib/chat/conversational-wizard-tools.ts` (and any
   sibling tool catalogue) MUST declare `enum: [...]` with all
   canonical values. Anthropic's tool-use validator enforces JSON
   Schema enums; the structural enum prevents the AI from emitting
   the wrong-union value in the first place. This is the
   defence-in-depth layer.

5. **`PlaybookConfig` type** — the field in
   `apps/admin/lib/types/json-fields.ts::PlaybookConfig` MUST be typed
   to the union, not bare `string`. A `string` typing lets a future
   `as string` cast at the merge site succeed at compile time; the
   union typing makes the cast a tsc error.

6. **ESLint chokepoint** —
   [`apps/admin/eslint-rules/no-untyped-enum-write-in-wizard.mjs`](../../apps/admin/eslint-rules/no-untyped-enum-write-in-wizard.mjs)
   blocks `as string` casts on enum-bearing fields inside the guarded
   surface (`lib/chat/wizard-tool-executor/**`, `lib/chat/admin-tools.ts`,
   `lib/chat/admin-tool-handlers.ts`). Severity `error` from day 1.

7. **Coverage vitest** —
   [`apps/admin/tests/lib/chat/wizard-enum-validation.test.ts`](../../apps/admin/tests/lib/chat/wizard-enum-validation.test.ts)
   walks every enum-bearing field and asserts: SET exists, guard
   accepts canonical values, guard REJECTS wrong-union samples
   (specifically pinning the `isTeachingMode("directive")` rejection
   that the live #1995 incident produced), schema declares the enum.

## Why this exists

Pre-#1995 the chat-wizard had FOUR layers that all failed:

| Layer | Why it didn't catch the live IELTS Speaking Practice bug |
|---|---|
| AI tool input schema | `teachingMode: { type: "string" }` — no `enum` array; Anthropic's validator had nothing to check against |
| AI tool prose | Valid values enumerated in description prose only; AI was asked to comply but nothing structural enforced it |
| Executor merge | `const newTeachingMode = (input.teachingMode as string) \|\| ...` — bare cast, no enum check, straight to DB |
| Type def | `teachingMode?: string` — typed as bare string so the cast was a no-op at compile time |

The wizard's `lib/wizard/detect-course-config.ts:43-51` ALREADY had a
deterministic whitelist validator — it just wasn't reused on the
chat-tool merge path. This rule is the structural fix for that reuse
gap. Same module, plumbed correctly.

## When this applies

Any PR that touches:

- `lib/wizard/enum-sets.ts` (the SET source of truth)
- `lib/content-trust/resolve-config.ts` (the guard surface — only the
  `is*` exports added in #1995)
- `lib/chat/wizard-tool-executor/tools/create_course/_new-config-merge.ts`
- `lib/chat/wizard-tool-executor/tools/create_course/_reuse-config-merge.ts`
- `lib/chat/admin-tool-handlers.ts::handleUpdatePlaybookConfig` /
  `filterEnumBearingUpdates`
- `lib/chat/conversational-wizard-tools.ts` `create_course` schema
- `lib/chat/admin-tools.ts` `update_playbook_config` schema
- `lib/types/json-fields.ts::PlaybookConfig` (the `interactionPattern`
  / `teachingMode` / `audience` / `planEmphasis` / `lessonPlanModel`
  fields)
- A new chat-wizard tool that writes a `Playbook.config.<enum>` value

## When NOT to apply

Free-form string fields that intentionally take operator-typed prose
(`welcomeMessage`, `subjectDiscipline`, `courseContext`,
`physicalMaterials`) are deliberately NOT enum-validated. The ESLint
rule's field allow-list and the vitest's `FREE_FORM_STRING_FIELDS`
constant pin this exemption — tightening one of them into an enum
requires updating all three layers.

Single-line typos / comment-only edits in the guarded files do not
trigger this rule's discipline.

## When adding a new enum-bearing field

Author checklist — same PR:

1. Define the canonical SET in `lib/wizard/enum-sets.ts` with a
   `*_ORDER` array + `VALID_*` Set + (optionally) a union type
   `export type *`.
2. Land the runtime type guard `is<Field>` in
   `lib/content-trust/resolve-config.ts` next to the union type.
3. Wire the guard into the chat-tool merge paths in the same PR (the
   four call sites listed in §3 above).
4. Tighten the field's typing in `lib/types/json-fields.ts::PlaybookConfig`
   to the union type (not `string`).
5. Add the `enum: [...]` array to the AI tool schemas
   (`conversational-wizard-tools.ts` for `create_course`,
   `admin-tools.ts` for `update_playbook_config`).
6. Add the field to `FIELDS` in
   `tests/lib/chat/wizard-enum-validation.test.ts` (the ratchet).
7. Add the field to `ENUM_BEARING_FIELDS` in
   `eslint-rules/no-untyped-enum-write-in-wizard.mjs`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/wizard/enum-sets.ts` (#1995) | Single source of truth for canonical SETs | Drift between inline whitelists in `detect-course-config.ts` and the chat-tool merge paths |
| `lib/content-trust/resolve-config.ts` `is*` guards (#1995) | Runtime type guards | Wrong-union values reaching the DB via a string cast |
| `eslint-rules/no-untyped-enum-write-in-wizard.mjs` (#1995, error severity) | Edit-time block on `as string` casts | The pre-#1995 idiom `(input.teachingMode as string)` re-entering the codebase |
| `tests/lib/chat/wizard-enum-validation.test.ts` (#1995) | Coverage ratchet | New enum-bearing fields landed without one of the 7 layers; specifically pins `isTeachingMode("directive") === false` (the live #1995 fingerprint) |
| `tests/eslint-rules/no-untyped-enum-write-in-wizard.test.ts` (#1995) | RuleTester behavioural pin | Future refactor weakening the rule's pattern detection |
| Read-side fallback in `lib/prompt/composition/transforms/preamble.ts` (PR #1993) | Defensive `RETURNING_CALLER_BY_MODE[teachingMode] ?? RETURNING_CALLER_BY_MODE.recall` | Read-side resilience to stale DB rows that pre-date the write-side guard |

## When the layers disagree (debugging)

| Symptom | Likely cause | Where to look |
|---|---|---|
| AI sends bad value, ESLint passes, runtime rejects | Schema `enum` missing → AI got no validation upstream | `conversational-wizard-tools.ts` field schema |
| AI sends valid value, runtime rejects | Guard SET diverged from canonical | `lib/wizard/enum-sets.ts` + the type union source |
| AI sends bad value, runtime accepts, ComposedPrompt crashes | Guard not wired at the merge path | The four call sites in §3 above |
| Coverage vitest fails after adding a field | Author missed step 6 or 7 in the checklist | Run the test; the failure message names the missing layer |

## Related

- [`tests/lib/chat/wizard-enum-validation.test.ts`](../../apps/admin/tests/lib/chat/wizard-enum-validation.test.ts) — the ratchet vitest
- [`eslint-rules/no-untyped-enum-write-in-wizard.mjs`](../../apps/admin/eslint-rules/no-untyped-enum-write-in-wizard.mjs) — the ESLint rule
- [`tests/eslint-rules/no-untyped-enum-write-in-wizard.test.ts`](../../apps/admin/tests/eslint-rules/no-untyped-enum-write-in-wizard.test.ts) — the rule's behavioural test
- [`lib/wizard/enum-sets.ts`](../../apps/admin/lib/wizard/enum-sets.ts) — canonical SETs
- [`lib/content-trust/resolve-config.ts`](../../apps/admin/lib/content-trust/resolve-config.ts) — type guards
- [`.claude/rules/ai-to-db-guard.md`](./ai-to-db-guard.md) — parent pattern (validate-then-write)
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test
- [`docs/CHAIN-CONTRACTS.md#wizard-config-write-invariant`](../../docs/CHAIN-CONTRACTS.md) — chain-contract row
- PR [#1993](https://github.com/WANDERCOLTD/HF/pull/1993) — read-side defensive fallback (live incident response)
- Story [#1995](https://github.com/WANDERCOLTD/HF/issues/1995) — this story
