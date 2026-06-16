# Registry ↔ Schema Coverage (5th Lattice piece)

> Every educator-facing field in `PlaybookConfig` (+ its sub-interfaces)
> MUST be either covered by a `JourneySettingContract.storagePath` in
> `JOURNEY_SETTINGS` / `VOICE_SETTINGS`, OR explicitly listed in
> `REGISTRY_EXEMPT_PATHS` with a documented reason.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (write-side
> validate-before-execute), [`ai-read-grounding.md`](./ai-read-grounding.md)
> (AI-side verify-before-claim), [`verify-before-fix.md`](./verify-before-fix.md)
> (developer-side symptom-then-cite), [`cascade-reuse.md`](./cascade-reuse.md)
> (read-side cascade discipline), [`response-redaction.md`](./response-redaction.md)
> (read-side role-tier discipline).
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md).

## Rule: schema-vs-registry coverage is part of the Lattice

The 4 original Lattice pillars (Chain Contracts, Guards, Cascade, Rules)
prevent INTEGRITY problems WITHIN structures already built. None of
them catch the case where the structure itself is incomplete relative
to its target. This was the BA failure that produced Slice C: the
LH menu reshape (#1721), cascade-honesty (#1737), guards + ADR (#1738)
all shipped while the registry was ~20 entries short of the schema
it was supposed to cover. The shortfall surfaced only when an
operator clicked on the "AI Intro Call" preview bubble and got an
Inspector with no control for it.

This rule + the paired vitest is the structural fix. Coverage is now
the 5th Lattice piece.

```
PlaybookConfig schema → registry coverage check → registry entries
                              ↓
                  REGISTRY_EXEMPT_PATHS (intentional exclusions)
```

## When this applies

Any PR that touches:
- `apps/admin/lib/types/json-fields.ts::PlaybookConfig` (or any nested
  interface that reaches it — `IntakeConfig`, `NpsConfig`,
  `OffboardingConfig`, etc.)
- `apps/admin/lib/journey/setting-contracts.entries.ts`
- `apps/admin/lib/settings/voice-setting-contracts.ts`

## Required actions when this test fails

| Failure shape | Fix |
|---|---|
| "Schema paths with no registry contract and no exempt entry" | Add a `JourneySettingContract` for the path with the right control type + bucket + previewLocators. Best path. |
| Path is intentionally excluded (wizard-owned, internal, derived, AI-only) | Add to `REGISTRY_EXEMPT_PATHS` with a one-line reason. Acceptable path. |
| "Exempt paths no longer in EXPECTED_SCHEMA_PATHS" | A field was renamed or removed. Update `EXPECTED_SCHEMA_PATHS` and the exempt entry. |
| "Paths covered by registry AND in REGISTRY_EXEMPT_PATHS" | Drift between covered and exempt — the contract shipped but the exempt entry wasn't removed. Delete the exempt entry. |
| "catch-up exempt count went UP" | Someone added a new schema field and exempted it instead of adding a contract. Add the contract. |

Never: skip the test. The failure IS the discipline.

## When adding a new `PlaybookConfig` field

Author checklist — must be satisfied in the SAME PR:

1. Add the field to `lib/types/json-fields.ts` with `@bucket` tag (per
   tolerance-placement ADR) and JSDoc explaining the educator effect.
2. **Add the path to `EXPECTED_SCHEMA_PATHS` in
   `tests/lib/journey/registry-schema-coverage.test.ts`.** Same PR. No
   exceptions.
3. Decide: contract (preferred) or exempt (acceptable).
   - **Contract** — add a `JourneySettingContract` in
     `setting-contracts.entries.ts` with `menuGroupKey` for the right
     bucket, `control` (toggle / select / slider / text / etc.),
     `composeImpact.sections[]`, `previewLocators[]`. The bucket
     ESLint rule (`hf-journey/no-bucketless-journey-setting`) will
     fail CI if you forget `menuGroupKey`.
   - **Exempt** — add to `REGISTRY_EXEMPT_PATHS` with a one-line
     reason. Use ONLY for:
     - `wizard-owned`: the wizard captures this; never edited
       standalone in the journey Inspector.
     - `internal`: engine config, never surfaced to operators.
     - `derived`: computed at read time, never written by an editor.
     - `ai-only`: only AI tools write this (with the AI-to-DB-guard
       validation contract).

## When deleting a `PlaybookConfig` field

1. Remove the contract entry (or the exempt entry).
2. Remove the path from `EXPECTED_SCHEMA_PATHS`.
3. Run the test — it should still be green. The "stale exempt" guard
   catches the case where you forget step 1 or 2.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/registry-schema-coverage.test.ts` (born 2026-06-16) | 6 vitests: covered-or-exempt; non-stale exempt; no double; non-empty reasons; sentinel count; catch-up ratchet | The drift class that produced the 20-entry Slice C shortfall (the "AI Intro Call" fingerprint — user opened the Inspector, no control was there) |
| `eslint-rules/no-bucketless-journey-setting.mjs` (#1738) | Edit-time | Adding a contract WITHOUT a bucket |
| `tests/lib/journey/registry-completeness.test.ts` | Integrity within registry | Existing-entry shape problems |

## When NOT to apply

The vitest is structural — it ALWAYS applies. No PR exempts it.

What's exempted is individual schema paths (via `REGISTRY_EXEMPT_PATHS`
with documented reason).

## Escalation

If you're adding a new `PlaybookConfig` field and can't immediately
decide between contract and exempt:

- Default: **contract**. The cost of adding a contract is low; the
  benefit is the field is reachable from the educator surface day 1.
- If you genuinely can't bucket it: add to exempt with reason
  `"catch-up: <contract name> contract pending (<bucket> bucket)"`
  and file a follow-on issue. The catch-up ratchet test will surface
  the debt at PR time.

## Related

- [`docs/decisions/2026-06-16-registry-schema-coverage.md`](../../docs/decisions/2026-06-16-registry-schema-coverage.md) — ADR + post-mortem
- [`docs/CONTRACTS-JOURNEY.md`](../../docs/CONTRACTS-JOURNEY.md) §17 — bucket model
- [`docs/kb/guard-registry.md#guard-registry-schema-coverage`](../../docs/kb/guard-registry.md) — registry row
- Memory: [feedback_lattice_guard_umbrella.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_lattice_guard_umbrella.md) — the 4-pillar Lattice this rule extends to 5
