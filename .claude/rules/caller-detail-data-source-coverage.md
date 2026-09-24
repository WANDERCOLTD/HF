# Caller-detail data-source coverage — route ↔ data-store pairing

> Every route under `apps/admin/app/api/callers/[callerId]/**/route.ts`
> MUST read the data store its purpose implies. Routes surfacing
> engine-derived learner state read `CallerTarget` / `CallScore`
> (score-store). Routes surfacing operator tuning read `BehaviorTarget`
> cascade / `getEffectiveBehaviorTargetsForCaller` (target-store).
> A route claiming "learner state" but reading only `BehaviorTarget`
> cascade is the drift class this gate catches.
>
> Sibling Coverage-pillar gates:
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (`SessionKindString` writer + reader pairing),
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (`AuthoredModuleMode`
> value → 3-axis UI consumer),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (storagePath → transform reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter row →
> runtime consumer).
>
> Read-side mirror of
> [`calltarget-produced-consumed-coverage.md`](./calltarget-produced-consumed-coverage.md)
> — that gate pins the write side (ADAPT writer → compose reader loop);
> this gate pins the read side (route intent → correct store).
>
> Born of the 2026-07-02 hf_staging incident: Judy Leigh
> (`callerId=71af017e-9964-4a21-ad6c-f860eaccd736`) had 8 CallScores +
> fresh CallerTarget rows on `IELTS Speaking Practice`, but the
> Adaptations tab rendered `PLAYBOOK × default 50%` for every skill.
> Root cause: `adaptations/route.ts` header docs at line 14 promised
> "`CallerTarget` overrides vs PLAYBOOK default" but the code called
> only `getEffectiveBehaviorTargetsForCaller` (BT cascade). Fixed on
> `fix/adaptations-tab-caller-target-visible` commit `885974ad`. A
> sibling bug surfaced during the audit in
> `uplift/route.ts::adaptationEvidence` (reads `CallerTarget.targetValue`
> where SKILL-AGG-001 seeds `1.0` → every scored skill reported a fake
> `+0.5` delta). Both incidents catchable by this gate.

## Rule

When you add or modify a route under
`app/api/callers/[callerId]/**/route.ts`:

1. **Declare the route's data-store intent** in
   `apps/admin/tests/api/caller-detail-data-source-coverage.test.ts` —
   either add to `ROUTE_DATA_SOURCE` with `class` set to
   `"score-store" | "target-store" | "both"` + a `>20-char reason`, OR
   add to `ROUTE_EXEMPT` with a `>20-char reason` (routes without a
   scoring/tuning surface — actions, memories, artifacts, etc.).
2. **Reference the declared store's Prisma model or resolver in the
   route source**. Classifier scans for concrete code signals, NOT
   JSDoc keywords (per TL Concern 1 during grooming — "adaptation" is
   polysemous in HF).
3. **New routes must be declared consciously** — the "no silent
   additions" test rejects any `[callerId]/**/route.ts` file not in
   either the classified or exempt list.

## How matching works

For each route in `ROUTE_DATA_SOURCE`:

- Read the route source file.
- Verify at least one required pattern is present:
  - `score-store` → `prisma.callerTarget`, `prisma.callScore`,
    `callerTarget.findMany/findUnique`
  - `target-store` → `getEffectiveBehaviorTargetsForCaller`,
    `prisma.behaviorTarget`
  - `both` → at least one from each set
- If a required pattern is missing → **gap** (fails CI).

Golden pins on the two live-incident routes (TL Concern 2 — protect
the current post-fix state, not a pre-fix synthetic fixture):

- `adaptations/route.ts` MUST reference both
  `prisma.callerTarget.findMany` AND
  `getEffectiveBehaviorTargetsForCaller`.
- `uplift/route.ts` MUST branch `parameterId.startsWith("skill_")` AND
  reference `.currentScore` in the `adaptationEvidence` block.

## Ratchets

- `EXPECTED_UNCLASSIFIED_COUNT = 0` — every route in
  `[callerId]/**/route.ts` MUST be in ROUTE_DATA_SOURCE OR ROUTE_EXEMPT.
- `EXPECTED_GAP_COUNT = 0` — every classified route MUST read the
  store(s) it declares.
- `EXPECTED_EXEMPT_COUNT` — pins the exempt list size. Drift requires
  a conscious bump.

## When the test fails

| Failure | Fix |
|---|---|
| `New caller-detail routes NOT declared…` | Add the new route to `ROUTE_DATA_SOURCE` (with a data-source class) OR to `ROUTE_EXEMPT` (with a `>20-char reason`). |
| `Data-source drift — route claims one store but doesn't read it` | Either wire the missing read OR reclassify + document the intent shift. |
| `Stale ROUTE_DATA_SOURCE / ROUTE_EXEMPT entries` | The file was renamed or deleted — remove the entry. |
| `Exempt list drifted from EXPECTED_EXEMPT_COUNT` | Consciously bump the ratchet or restore the exempted route. |
| Golden pin fails on `adaptations/route.ts` | Fix commit `885974ad` has regressed — restore the `CallerTarget` read. |
| Golden pin fails on `uplift/route.ts` | The `parameterId.startsWith("skill_") ? currentScore : targetValue` branch has been removed. Restore it — the pre-fix pattern reported fake `+0.5` deltas for every scored skill. |

## What this gate does NOT cover

- **Routes outside `[callerId]/**`** — the gate is scoped to
  learner-detail routes specifically. Course-scoped / cohort-scoped
  routes use different semantic patterns.
- **JSDoc-vs-code alignment** — deliberately NOT enforced (per TL
  Concern 1). "Adaptation" appears legitimately in both stores' docs.
- **CallerAttribute-family routes** — `lo-mastery`, `personality`,
  `insights`, `memories`, `survey`, `trust-progress` read
  `CallerAttribute` (different store family). If a similar drift class
  emerges on that family, add a sibling gate.

## Related

- [`tests/api/caller-detail-data-source-coverage.test.ts`](../../apps/admin/tests/api/caller-detail-data-source-coverage.test.ts) — the test
- [`fix/adaptations-tab-caller-target-visible`](https://github.com/WANDERCOLTD/HF/commits/fix/adaptations-tab-caller-target-visible) — the live-incident fix this rule protects
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage-pillar test
- [`.claude/rules/calltarget-produced-consumed-coverage.md`](./calltarget-produced-consumed-coverage.md) — sibling write-side gate
- Memory: `feedback_lattice_5th_pillar_coverage.md` — Coverage pillar framing
