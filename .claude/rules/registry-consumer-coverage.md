# Registry ↔ Consumer Coverage (Lattice 5th-pillar member)

> A `JourneySettingContract` (or `VoiceSettingsContract`) with non-empty
> `composeImpact.sections[]` MUST have a transform / resolver / loader that
> actually reads its `storagePath`. The setting is producer-only otherwise
> — the educator edits it, the Inspector shows "✓ Saved", but the composed
> prompt is byte-identical before and after.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (WRITE-side
> validate-before-execute), [`ai-read-grounding.md`](./ai-read-grounding.md)
> (CHAT-side verify-before-claim), [`verify-before-fix.md`](./verify-before-fix.md)
> (DEVELOPER-side symptom-then-cite), [`cascade-reuse.md`](./cascade-reuse.md)
> (READ-side cascade discipline), [`response-redaction.md`](./response-redaction.md)
> (READ-side role-tier discipline), and the new
> [`lattice-survey.md`](./lattice-survey.md) "Producer ↔ consumer pairing"
> section. This rule structurally enforces the upper-layer pairing the
> survey rule documented — registry storagePath ↔ transform reader.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule: every registry entry with compose impact has a consumer

When a setting lands in `JOURNEY_SETTINGS` or `VOICE_SETTINGS` with a
non-empty `composeImpact.sections[]`, the SAME PR MUST land a
transform / resolver / loader that READS the setting's `storagePath`
— OR add the contract id to
`tests/lib/journey/registry-consumer-coverage.test.ts::REGISTRY_CONSUMER_EXEMPT_PATHS`
with a one-line reason AND bump `EXPECTED_EXEMPT_COUNT`.

```
Author adds registry entry → vitest checks transform reads it →
  if yes, ship
  if no, exempt-with-reason + ratchet bump (forces a conscious choice)
```

## Why this exists

The producer-only failure mode lived as DOCUMENTED CONVENTION in
[`lattice-survey.md`](./lattice-survey.md) for the entire 2026
journey-tab build-out:

> A setting that has a registry entry but no consuming transform is a
> producer-only Lattice entry.

The convention was trust-based — no structural gate enforced it. Lane 3
catch-up PRs (#1780-series) prioritised closing Inspector visibility
gaps; the corresponding transform reads were deferred or forgotten on a
case-by-case basis. By 2026-06-17 there were **15 producer-only settings
in the registry** — operators editing them, "✓ Saved" appearing, prompt
unchanged.

The 2026-06-17 audit surfaced the drift. This rule + its paired vitest
make the producer↔consumer pairing structurally enforceable for the
first time at this layer.

## When this applies

Any PR that touches:

- `apps/admin/lib/journey/setting-contracts.entries.ts` (adds / changes
  / removes a `JourneySettingContract` entry)
- `apps/admin/lib/settings/voice-setting-contracts.ts` (same for
  `VoiceSettingsContract`)
- A transform that previously read a setting AND the read is being
  removed (the exempt list contradiction-check fires)

## The check

The vitest classifies each `JOURNEY_SETTINGS` + `VOICE_SETTINGS` entry:

| Classification | Meaning |
|---|---|
| `no-compose-impact` | `composeImpact.sections.length === 0` — operator-only, no consumer needed |
| `family-shortcut` | `storagePath` under `sessionFlow.*` / `playbook.voiceConfig.*` / `behaviorTargets*` / `domain.*` — covered by canonical resolver (which IS in `CONSUMER_DIRS`) |
| `family-shortcut` (module) | `scope === "module"` — the G8 IELTS cohort intentionally landed producer-only per epic #1700 decision 5; `HF_FLAG_IELTS_MODULE_SETTINGS` tracks the operator surface |
| `covered` | Substring of the distinctive path segment found at word-boundary in concat'd consumer source |
| `exempt` | In `REGISTRY_CONSUMER_EXEMPT_PATHS` with a documented one-line reason |
| `gap` | None of the above — fails the test |

## Required actions when this test fails

| Failure shape | Fix |
|---|---|
| "Producer-only settings (no transform / resolver / loader reads their storagePath)" | Best: land the transform read in the same PR. Acceptable: add to `REGISTRY_CONSUMER_EXEMPT_PATHS` with a one-line reason, bump `EXPECTED_EXEMPT_COUNT`. |
| "Exempt-list size drifted" | Either you wired a consumer + need to REMOVE an exempt entry (drop `EXPECTED_EXEMPT_COUNT`) OR you added an entry without bumping (force a conscious decision). |
| "Exempt entries with no matching registry contract" | A setting was deleted; remove the stale exempt entry. |
| "Exempt entries that now have consumer reads" | The wiring shipped; remove from the exempt list. |
| "empty reason" | Each exempt entry needs a >10-char justification. Write one. |

Never: lower the bar by widening `CONSUMER_DIRS` to cover an unrelated
file. That defeats the audit.

## When adding a new JourneySettingContract / VoiceSettingsContract

Author checklist — satisfied in the same PR:

1. Is `composeImpact.sections.length > 0`?
   - **No** → operator-only. Test classifies as `no-compose-impact`, no action.
   - **Yes** → continue.
2. Is the `storagePath` root one of the cascade families
   (`sessionFlow.*`, `playbook.voiceConfig.*`, `behaviorTargets*`,
   `domain.*`)?
   - **Yes** → test classifies as `family-shortcut`. No action.
   - **No** (root is `config.*` or `tolerances.*`) → continue.
3. Will the matching transform / resolver / loader be in the same PR?
   - **Yes** → land both; test classifies as `covered`. Done.
   - **No, deferred** → add to `REGISTRY_CONSUMER_EXEMPT_PATHS` with a
     reason describing what's deferred + bump `EXPECTED_EXEMPT_COUNT`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/registry-consumer-coverage.test.ts` (born 2026-06-17, this PR) | 6 vitests: gap-check, ratchet, non-empty-reason, non-stale-exempt, no-contradiction, distribution-sanity | The Lane 3 catch-up regression class — registry entry without consumer (the 2026-06-17 fingerprint: 15 producer-only settings). |
| `tests/lib/prompt/composition/coverage-producer-consumer.test.ts` (#1848) | Static manifest + sweep at the transform↔renderer layer | The #1768 regression class — transform output lacks a renderer push (the 2026-06-17 IELTS Mock fingerprint). |
| `eslint-rules/composition-directive-needs-renderer.mjs` (#1848) | Edit-time, error severity | Adding a `directive:` field to a transform without registering it in `coverage-producer-consumer.test.ts`. |
| `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing" + "deeper layer" | Author discipline | Catches what slips past (1) + (2). |
| `tests/lib/journey/registry-completeness.test.ts` | Existing shape checks | Adjacent shape problems (invalid section keys, kind mismatches) — independent of consumer pairing. |

## When NOT to apply

This rule applies to any setting with `composeImpact.sections.length > 0`.
It does NOT apply to:

- Settings whose effect is enforced outside compose (e.g. RBAC writeGates,
  audit-only metadata) — those naturally have `composeImpact.sections: []`.
- Module-scoped settings (`scope === "module"`) — the G8 IELTS cohort
  intentionally landed producer-only. The `family-shortcut` classification
  in the test covers this without needing exemption entries per setting.

## Related

- [`tests/lib/journey/registry-consumer-coverage.test.ts`](../../apps/admin/tests/lib/journey/registry-consumer-coverage.test.ts) — the test
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — the convention this rule structurally enforces
- [`docs/decisions/2026-06-16-registry-schema-coverage.md`](../../docs/decisions/2026-06-16-registry-schema-coverage.md) — sibling pattern (Lane 1)
- Memory: feedback_lattice_guard_umbrella.md — the 4-pillar Lattice this rule extends to 5
