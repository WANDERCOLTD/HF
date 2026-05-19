# Mastery Store Migration (#494 E2 Slice 2.1)

## Why this doc exists

Two stores currently hold per-module mastery for a `(callerId, moduleId)` pair:

| Store | Shape | Status |
|-------|-------|--------|
| `CallerModuleProgress.mastery` | First-class relational field | **Canonical** since Slice 2.2 (`writeModuleMastery` in `app/api/calls/[callId]/pipeline/route.ts`). |
| `CallerAttribute` (scope=`CURRICULUM`, key=`curriculum:<slug>:mastery:<moduleId>` / legacy `mastery_<slug>`) | Generic attribute bag | **Deprecated** — frozen write surface, redirected reads. Removal in Slice 2.1.b. |

Slice 2.1 consolidates the read/write surface on the canonical store and flag-gates the legacy paths so we can roll back without redeploying if something breaks in production.

## The two flags

| Env var | Default | Effect when on (`= "true"`) | Effect when off (default) |
|---------|---------|----------------------------|---------------------------|
| `LEGACY_MASTERY_WRITES_ENABLED` | off | `updateCurriculumProgress` writes legacy `CallerAttribute` `mastery:<moduleId>` rows AND logs `[mastery-legacy] writing legacy CallerAttribute mastery:*` at info level on every call. Used only for emergency rollback during the transition. | The `CallerAttribute` write is a no-op. `CallerModuleProgress.mastery` (the canonical store, written by Slice 2.2) is unaffected. |
| `LEGACY_MASTERY_FALLBACK_ENABLED` | off | When a redirected read against `CallerModuleProgress` throws (DB connectivity, missing table on a stale runner, etc.), each read site falls through to the legacy `CallerAttribute` `mastery:*` scan and logs a warning. Emergency-only escape hatch. | A failed `CallerModuleProgress` read surfaces as an exception (write site) or as an empty mastery map (read sites where the fallback was previously the only path). |

**Both flags default to off.** After merge, only `CallerModuleProgress.mastery` is read or written — no env tweak required.

## Redirected sites (slice 2.1)

| Layer | File | Before slice 2.1 | After slice 2.1 |
|-------|------|------------------|-----------------|
| Write | `lib/curriculum/track-progress.ts::updateCurriculumProgress` | Unconditionally upserted `CallerAttribute mastery:<moduleId>` per supplied module. | Upsert flag-gated on `LEGACY_MASTERY_WRITES_ENABLED`. `CallerModuleProgress` dual-write (slice 2.2) is unaffected by the flag — it always runs. |
| Read | `lib/curriculum/track-progress.ts::getCurriculumProgress` | Filled `progress.modulesMastery` from `CallerAttribute mastery:*` keys. | Sources `modulesMastery` from `CurriculumModule.callerProgress[0].mastery`, keyed by module slug. Legacy keys are ignored unless `LEGACY_MASTERY_FALLBACK_ENABLED=true` AND the DB read throws. |
| Read | `lib/prompt/compose-content-section.ts::loadCallerProgress` | Same legacy reader, called by `composeContentSection`. | Same redirect contract as above. |
| Read | `lib/prompt/composition/transforms/modules.ts::computeSharedState` | Built `completedModules` set from any `CallerAttribute` key containing `mastery_` / `completed_` / `curriculum:<slug>:mastery:`. | Builds the set from `CallerModuleProgress` filtered by `mastery >= masteryThreshold`. Legacy scan runs only when `LEGACY_MASTERY_FALLBACK_ENABLED=true` AND the DB read failed. |
| Read | `app/api/vapi/tools/route.ts::handleCheckMastery` (VAPI `check_mastery` tool) | Loose `CallerAttribute` key match on `mastery_<slug>` / `contains slug`. | Reads from `CallerModuleProgress` joined to `CurriculumModule` by `slug` / `title`. Legacy fuzzy match runs only when `LEGACY_MASTERY_FALLBACK_ENABLED=true`. |

## Operational notes

- **Both authored and AI-generated courses** populate `CurriculumModule` + `CallerModuleProgress` rows. The redirect works identically for both.
- **The legacy `lo_mastery:*` and `tp_mastery:*` `CallerAttribute` keys are NOT touched by this slice.** They live on separate keys, drive working-set selection / retrieval practice, and remain the canonical store for per-LO and per-TP mastery. Module-level mastery is the only surface migrating.
- **`trust_progress:*` keys (scope=`TRUST_PROGRESS`) are out of scope** — they hold trust-weighted aggregates derived from module mastery and are written via `storeTrustWeightedProgress`.
- The `current_module` and `last_accessed` keys on `CallerAttribute` (scope=`CURRICULUM`) remain authoritative — they hold orthogonal data, not mastery.

## Future cleanup (Slice 2.1.b)

Once a production traffic window confirms zero need to flip either flag back on, Slice 2.1.b will:

1. Delete the flag-gated legacy `CallerAttribute mastery:*` write block in `updateCurriculumProgress`.
2. Delete the `LEGACY_MASTERY_FALLBACK_ENABLED` branches in each redirected reader.
3. Remove the legacy `mastery:<moduleId>` row purge from `resetCurriculumProgress` once a backfill / delete-once script confirms zero rows remain on prod.
4. Drop the two env vars and update this doc to "completed".

Until then, the flags stay where they are — both off by default, both available for one-line incident response.

## Related issues

- `#494` E2 epic — module-mastery first-class store.
- Slice 2.2 — `writeModuleMastery` writes `CallerModuleProgress.mastery` (canonical).
- Slice 2.1 (this doc) — consolidate readers + freeze legacy writes.
- Slice 2.1.b — delete the legacy code paths once flags are confirmed stale.

## See also

- `lib/curriculum/track-progress.ts` — `updateCurriculumProgress`, `getCurriculumProgress`, `updateModuleMastery`.
- `lib/curriculum/compute-mastery.ts` — deterministic EMA over `CallScore` rows (canonical mastery computation).
- `app/api/calls/[callId]/pipeline/route.ts::writeModuleMastery` — pipeline integration that writes `CallerModuleProgress.mastery`.
- `tests/lib/mastery-store-consolidation.test.ts` — flag-gate and redirect-target invariants.
