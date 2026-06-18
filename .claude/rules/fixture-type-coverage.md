# Fixture YAML ↔ AuthoredModuleSettings coverage (Lattice Coverage-pillar member)

> Every settings-block key in any `course-reference-ielts-v*.md` fixture
> under `apps/admin/lib/wizard/__tests__/fixtures/` MUST EITHER be a typed
> member of `AuthoredModuleSettings` OR be exempted in
> `FIXTURE_KEY_EXEMPT` with a documented reason. The wizard parser walks
> the type — silent drift is the failure mode this gate closes.
>
> Sibling Coverage-pillar tests:
> [`registry-schema-coverage.md`](./registry-schema-coverage.md),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md).
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you write or modify either side:

1. **Add a YAML key to a fixture** — the key MUST be a member of
   `AuthoredModuleSettings` in `apps/admin/lib/types/json-fields.ts`.
   If you can't ship the type addition in the same PR, add the key to
   `FIXTURE_KEY_EXEMPT` in
   `tests/lib/wizard/fixture-type-coverage.test.ts` with a one-line
   reason (≥10 chars) and bump `EXPECTED_FIXTURE_KEY_EXEMPT_COUNT`.

2. **Add a member to `AuthoredModuleSettings`** — at least one fixture
   file MUST exercise it. If the feature is shipped but no fixture
   yet exercises it, add to `TYPE_MEMBER_EXEMPT` with reason and bump
   `EXPECTED_TYPE_MEMBER_EXEMPT_COUNT`. Best path is to add a usage
   to the current `v*.md` fixture in the same PR.

## Why this exists

The 2026-06-18 #1903 / #1904 grooming audit surfaced 5 fixture YAML
keys present in `v2.3` (`prepSilenceSec`, `incompleteThresholdSec`,
`scoringCriteria`, `scoreReadoutMode`, `topicPool`) absent from the
TypeScript type. The wizard parser walks the type — these keys are
silently dropped. Without this gate the same shape of bug recurs each
time the course-ref doc revs (or a new doc for a new course lands).

The gate is **bidirectional** because one-way coverage is the failure
mode the 5th-pillar Lattice has documented:

- producer→consumer alone catches fixture keys without types
- consumer→producer alone catches type members without fixture exercises
- BOTH together catch the full drift class

## When NOT to apply

- Non-`AuthoredModuleSettings` keys in the fixture (e.g. `moduleId`,
  `appliesTo`, top-level YAML keys) — only `settings:` block contents
  are walked.
- Fixture files outside `lib/wizard/__tests__/fixtures/` (e.g. canonical
  seed at `tests/fixtures/`) — separate concern; future Lattice work.

## When adding a new fixture (e.g. `v2.4.md`)

Author checklist (same PR):

1. Drop the new file into `apps/admin/lib/wizard/__tests__/fixtures/`.
2. The test glob auto-picks it up — no test edit needed.
3. Run `npx vitest run tests/lib/wizard/fixture-type-coverage.test.ts`.
4. If green → ship. If any new YAML key fails, follow the
   author-checklist for the rule above.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/wizard/fixture-type-coverage.test.ts` (born 2026-06-18, this PR) | 9 vitests: parse sanity, bidirectional gap, ratchets, non-empty reasons, non-stale exempts, no contradiction | New fixture YAML keys silently dropped by the wizard parser; new type members orphaned without a usage example. |
| `apps/admin/lib/wizard/extract-per-module-settings.ts` (#1902) | Edit-time + runtime | Parses fixture YAML into `AuthoredModule.settings`. Walks the type at compile-time, ignores unknown keys at runtime. |
| `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing" | Author discipline | Catches what slips past the structural gate. |

## When NOT to apply (structural)

The vitest is structural — it ALWAYS applies. What's exempted is
specific YAML keys (via `FIXTURE_KEY_EXEMPT`) or type members (via
`TYPE_MEMBER_EXEMPT`) with documented reason.

## Related

- [`tests/lib/wizard/fixture-type-coverage.test.ts`](../../apps/admin/tests/lib/wizard/fixture-type-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — the type
- [`apps/admin/lib/wizard/__tests__/fixtures/`](../../apps/admin/lib/wizard/__tests__/fixtures/) — the fixtures
- Parent epic: [#1909](https://github.com/WANDERCOLTD/HF/issues/1909) — Lattice Coverage extensions
- Story: [#1910](https://github.com/WANDERCOLTD/HF/issues/1910) — this gate
- Sibling story: [#1903](https://github.com/WANDERCOLTD/HF/issues/1903) — surfaced the gap
