# arrayKey ↔ writer surface coverage (Lattice Coverage-pillar member)

> Every `JOURNEY_SETTINGS` / `VOICE_SETTINGS` contract whose `storagePath`
> declares `arrayKey: "..."` MUST be writable through a route surface —
> either implicitly (the contract carries a fixed `selectorValue` baked
> in) or via a `arraySelector` field on the writer route's body Zod
> schema (#1888 P3c shipped this on the `journey-setting` PATCH route).
> Conversely, every route that accepts `arraySelector` MUST resolve to
> contracts whose `storagePath` declares `arrayKey`.
>
> Sibling Coverage-pillar gates:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (registry → transform reader),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md) (route
> auth + Zod), [`tier-visibility-coverage.md`](./tier-visibility-coverage.md)
> (response redaction), [`parameter-coverage.md`](./parameter-coverage.md)
> (parameter → runtime consumer),
> [`fixture-type-coverage.md`](./fixture-type-coverage.md) (fixture YAML
> ↔ AuthoredModuleSettings). Same generic enumerate→classify→ratchet
> pattern, applied bidirectionally to the array-element addressing surface.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you add or modify either side of the array-element addressing
surface:

1. **New contract with `arrayKey`** — same PR MUST either:
   - Bake in a fixed `selectorValue` (e.g. `arrayKey: "kind"` +
     `selectorValue: "pre_test"` for the JourneyStop dispatch), OR
   - Confirm the writer route's body schema accepts `arraySelector`
     (today the only writer is the `journey-setting` PATCH route at
     `app/api/courses/[courseId]/journey-setting/route.ts`; the body
     schema accepted `arraySelector` after #1888 P3c).
2. **Modification of an existing writer route** — when refactoring the
   `journey-setting` PATCH body schema (or shipping a new write surface
   that consumes `arrayKey` contracts), do NOT drop `arraySelector`
   from the body without also retiring every `arrayKey`-only contract
   it serves. The test catches the drift in either direction.
3. **New write surface for arrayKey contracts** — register the route
   path in `ARRAYSELECTOR_ROUTES` in
   `apps/admin/tests/lib/journey/arraykey-writer-coverage.test.ts` AND
   confirm the handler references both `arrayKey` and `selectorValue`
   in its dispatch (so the consumer-side gate's source check passes).

If a future contract intentionally lands as producer-only (e.g.
seeded for a Phase 2 wiring that hasn't yet shipped the runtime route),
add to `ARRAYKEY_WRITER_EXEMPT` in the test file with a one-line reason
and bump `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.

## Why this exists

#1888 P3c (#1850 closeout) added `arraySelector?: string` to the
`journey-setting` PATCH route body schema specifically so the G8
module-scoped settings (9 contracts: `moduleQuestionTarget`,
`moduleMinSpeakingSec`, `moduleCueCardPool`, `moduleTopicPool`,
`moduleClosingLine`, `moduleFirstTimeOrientationLine`,
`moduleScheduledCues`, `moduleScaffoldPool`, `moduleProfileFieldsToCapture`)
become writable — each is keyed on the per-instance `AuthoredModule.id`,
which the contract can't know at definition time.

Without a structural gate the pairing was convention-only: a future
contract that declares `arrayKey: "id"` without `selectorValue` would
silently be unwritable (the PATCH route would return 400
`ARRAY_SELECTOR_REQUIRED` for every save attempt) and the failure mode
would surface as "operator's edits aren't saving" rather than a CI
red. Equally, a future refactor that drops `arraySelector` from the
PATCH route schema would silently break every G8 module-scoped write.

This gate makes both directions structural — drift fires CI before
reaching hf_sandbox.

## How matching works

The producer-side classifier walks every contract in
`[...JOURNEY_SETTINGS, ...VOICE_SETTINGS]`. For each contract whose
`storagePath.arrayKey` is non-null:

| Classification | Meaning |
|---|---|
| `covered-fixed-selector` | Contract carries `selectorValue` — array slot baked in at definition time; no body field needed |
| `covered-runtime-selector` | Contract carries `arrayKey` only — at least one registered writer route's body schema accepts `arraySelector` |
| `exempt` | Listed in `ARRAYKEY_WRITER_EXEMPT` with a documented reason |
| `gap` | Contract carries `arrayKey` only and NO writer route accepts `arraySelector` — fails the test |

The consumer-side classifier walks `ARRAYSELECTOR_ROUTES`. For each
route source that declares `arraySelector` in its Zod body schema, the
gate asserts the handler also references both `arrayKey` and
`selectorValue` — i.e. the route dispatches via the contract's
structured-path declaration rather than a parallel mechanism.

## When NOT to apply

- Contracts whose `storagePath` is a bare string (no array traversal)
  — no `arrayKey` to enforce.
- Contracts with `arrayKey` AND fixed `selectorValue` — implicitly
  covered; no runtime selector needed.
- Routes that don't write to `JOURNEY_SETTINGS` / `VOICE_SETTINGS`
  contracts — no `arrayKey` surface to enforce.

## When adding a new arrayKey contract

Author checklist (same PR):

1. Add the `JourneySettingContract` / `VoiceSettingsContract` to
   `setting-contracts.entries.ts` / `voice-setting-contracts.ts`.
2. Decide: fixed selector OR runtime selector.
   - **Fixed selector**: include `selectorValue: "..."` in the
     `storagePath`. The applier resolves the slot from the contract;
     no body field needed. Pattern: JourneyStop dispatch.
   - **Runtime selector**: declare only `arrayKey: "..."`. The PATCH
     route requires `arraySelector` in the body. Pattern: G8
     module-scoped settings keyed on AuthoredModule id.
3. Run `npx vitest run tests/lib/journey/arraykey-writer-coverage.test.ts`.
4. If green → ship. If `gap` → wire OR add to `ARRAYKEY_WRITER_EXEMPT`
   with reason + bump `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.

## When adding a new writer route for arrayKey contracts

Author checklist (same PR):

1. Add the route path to `ARRAYSELECTOR_ROUTES` in the test file.
2. Confirm the route's body Zod schema declares
   `arraySelector: z.string()...`.
3. Confirm the handler references both `arrayKey` and `selectorValue`
   in its dispatch (so the consumer-side gate's source check passes).
4. Run the test — `consumer→producer` gate will fire if either
   `arrayKey` or `selectorValue` is missing from the handler source.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/arraykey-writer-coverage.test.ts` (born 2026-06-18, this PR) | 7 vitests: producer-side gap, consumer-side handler reference, exempt ratchet, non-empty reason, non-stale exempt, no contradiction, distribution sanity | (a) New `arrayKey`-only contract shipping without a writer surface; (b) future refactor dropping `arraySelector` from the PATCH route silently breaking G8 module-scoped writes; (c) drift between contract storagePath structure and the route's dispatch logic. |
| `app/api/courses/[courseId]/journey-setting/route.ts` (#1888 P3c) | Body schema accepts `arraySelector`; handler resolves contract storagePath at `arrayKey + selectorValue ?? body.arraySelector`; returns 400 `ARRAY_SELECTOR_REQUIRED` when both are absent | Silent index-0 writes when the operator forgets to supply the selector. |
| `lib/journey/storage-path-applier.ts:54-56` | `arraySelector = isStruct(storage) && storage.arrayKey && storage.selectorValue !== undefined ? {...} : null` resolves the runtime slot | Drift between contract structure and apply-time slot resolution. |
| `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing" | Author discipline | Catches what slips past the test (regex-based source check has limits). |

## When NOT to apply

The vitest is structural — it ALWAYS applies. What's exempted are
individual contracts via `ARRAYKEY_WRITER_EXEMPT` with documented
reason (empty at launch — every known `arrayKey` contract is `covered`).

## Future hardening

When a second writer route lands (e.g. a domain-level
`/api/domains/[id]/journey-setting` route), add to
`ARRAYSELECTOR_ROUTES` in the test file. The bidirectional gate
extends without code change — the same classification logic applies.

If the `arraySelector` field name ever changes (rename / refactor),
update both the test's source-detection regex (`/arraySelector\s*:\s*z\./`)
AND the rule file in the same PR — they're paired by convention.

## Related

- [`tests/lib/journey/arraykey-writer-coverage.test.ts`](../../apps/admin/tests/lib/journey/arraykey-writer-coverage.test.ts) — the test
- [`app/api/courses/[courseId]/journey-setting/route.ts`](../../apps/admin/app/api/courses/[courseId]/journey-setting/route.ts) — the only writer today
- [`lib/journey/storage-path-applier.ts`](../../apps/admin/lib/journey/storage-path-applier.ts) — the apply-time resolver
- [`lib/journey/setting-contracts.ts`](../../apps/admin/lib/journey/setting-contracts.ts) — the `StoragePath` + `StoragePathStruct` types
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- Parent epic: [#1909](https://github.com/WANDERCOLTD/HF/issues/1909) — Lattice Coverage extensions
- Story: [#1912](https://github.com/WANDERCOLTD/HF/issues/1912) — this gate
- Sibling story: [#1888](https://github.com/WANDERCOLTD/HF/issues/1888) — P3c added `arraySelector` to the PATCH route
