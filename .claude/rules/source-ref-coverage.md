# Soft source-ref → ContentSource Coverage

> Every soft source-reference declared in a published course-reference
> fixture (`*.course-ref.md` or `course-reference-*.md`) MUST resolve
> against a content source the fixture itself declares. Two ref shapes
> are walked: YAML-block refs (`cueCardPool: source:<slug>`,
> `topicPool: source:<slug>`, `scaffoldPool: source:<slug>`,
> `profileFieldsToCapture: source:<slug>`) and catalogue-table
> `contentSourceRef` labels (`Source N — Title`).
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (type-union value →
> 3-axis UI consumer),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (registry storagePath → transform reader),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (SessionKindString → writer + reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter row →
> runtime consumer).
>
> Born of the 2026-06-20 BIG LATTICE MISS #2 audit (epic #2166).
> Live evidence (hf_sandbox): 5/5 IELTS Speaking Practice modules
> declare `contentSourceRef: "Source N — …"` against `Playbook.config`
> but zero matching `ContentSource` rows exist. Runtime resolvers
> (`selectPinnedCardForModule`, `resolveModuleSourceRefs`) silently
> return null on miss — the learner experiences an empty cue-card
> shell with no operator-visible signal. Partner-blocker for Mock +
> Part 2 + Baseline practice flows.
>
> The structural infrastructure for this exact pattern already
> existed (`check-fk-consistency.ts` Query 11 catches the JSON soft-FK
> shape for `AnalysisSpec.config.parameters[].id`; `parse-content-sources.ts`
> proves the lookup-index pattern works). The check was never written.

## Rule

When you add or modify a course-reference fixture under
`apps/admin/lib/wizard/__tests__/fixtures/course-reference-*.md`:

1. **Declare the source in `## Content Sources`** — every soft
   source-ref the modules cite MUST appear as a `### Source N — …`
   entry whose body carries `moduleRef:` + `settingRef:` (for YAML
   refs) OR whose `Source N` token matches the catalogue label (for
   `contentSourceRef`).

2. **Match by structural key, not free text** — the catalogue label
   ("Source 4 — Baseline topic pool") and the header title ("Source 4
   — Baseline Assessment topic pool") may differ. The gate compares on
   the `Source N` token; the title is descriptive metadata.

3. **For YAML-block refs**, the resolver in
   `lib/wizard/resolve-module-source-refs.ts::RESOLVABLE_FIELDS` is
   the source-of-truth list. The test asserts the test matrix
   (`RESOLVABLE_FIELD_NAMES`) tracks the resolver constant — a
   refactor adding a new resolvable field forces a same-PR matrix
   update.

4. **If you can't ship the content source in the same PR**, add the
   tuple `(fixture, moduleId, field, rawValue)` to `SOURCE_REF_EXEMPT`
   in `tests/lib/wizard/source-ref-coverage.test.ts` with a >20-char
   reason AND bump `EXPECTED_EXEMPT_COUNT`. The ratchet catches the
   bump as a conscious decision.

## How matching works

For each fixture file the test walks:

### YAML-block refs

The walker extracts every `field: source:<slug>` line from inside a
`#### Module N — … — Settings` YAML fence (mirroring the resolver's
own regex contract — kept lightly duplicated rather than imported so
that resolver-internal refactors don't silently change the gate
semantics).

For each ref `(moduleId, field, slug)`:
- Look up the `## Content Sources` index built from the same fixture
  by `(moduleRef, settingRef)`.
- Hit → `covered`.
- Miss → `gap` (or `exempt` if listed).

### Catalogue `contentSourceRef`

The walker reads the catalogue table's "Content source" column for
every module row. For each label:
- Extract the `Source N[a-z]?` token (e.g. `Source 4`, `Source 2a`).
- Search the fixture's `### Source N — …` headers for a header whose
  token matches.
- Hit → `covered`.
- Miss → `gap` (or `exempt` if listed).

Title-text matching is deliberately NOT used — too brittle.

## Layered enforcement

| Layer | Surface | Gate | Purpose |
|---|---|---|---|
| **PR-time** | course-ref fixtures under `lib/wizard/__tests__/fixtures/` | `tests/lib/wizard/source-ref-coverage.test.ts` (this rule) | Catch authoring drift BEFORE the wizard projects |
| **CI / deploy-time** | Live `Playbook.config.modules[]` on hosted DBs | `apps/admin/scripts/check-fk-consistency.ts` Query 14 (`playbook-module-dangling-source-ref`, WARN-only) | Catch post-projection drift on hf_sandbox / hf_staging |
| **Runtime** (deferred — S3 of #2166) | `selectPinnedCardForModule` / `resolveModuleSourceRefs` | AppLog subject `source_ref.unresolved` + structured fallback decision | Operator-visible signal at the moment of the miss |

S3 (runtime AppLog) is a separate follow-on PR in the epic to avoid
broadening this Coverage gate's scope.

## When NOT to apply

- **Non-published fixtures** (test stubs, throwaway snapshots) — the
  walker discovers files matching `course-reference-*.md` under
  `lib/wizard/__tests__/fixtures/`. Files in other test fixture
  directories aren't walked.
- **Fixtures with no `## Content Sources` section AND no
  `contentSourceRef` declarations** — the walker auto-skips a fixture
  if it produces 0 ref cells (the parser-regression test fires on a
  parse miss).
- **External / sister-project fixtures** (e.g. `apps/foh` / non-HF
  course-refs) — out of scope; this gate covers the HF wizard's
  projection input.

## When adding a new fixture

Author checklist (same PR):

1. Drop the fixture at `apps/admin/lib/wizard/__tests__/fixtures/<name>.md`
   following the `course-reference-*.md` naming convention.
2. Ensure every learner-selectable module's "Content source" cell in
   the catalogue table references a `Source N` token that appears as
   a `### Source N — …` header.
3. Ensure every `field: source:<slug>` line inside a per-module YAML
   block has a matching `### Source N — …` entry with `moduleRef:` +
   `settingRef:` matching the consuming module + field.
4. Run `npx vitest run tests/lib/wizard/source-ref-coverage.test.ts`.
5. Green → ship. RED → wire the content source OR add to
   `SOURCE_REF_EXEMPT` with a >20-char reason.

## When adding a new resolvable field

If you extend `lib/wizard/resolve-module-source-refs.ts::RESOLVABLE_FIELDS`:

1. Add the new field name to `RESOLVABLE_FIELD_NAMES` in
   `tests/lib/wizard/source-ref-coverage.test.ts`.
2. The "matrix tracks resolver" test fires immediately if you forget.
3. Add a parser-format dispatch in `parseByFormat` in the resolver.
4. Add a fixture YAML-block example so the gate exercises the new
   field on at least one fixture.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/wizard/source-ref-coverage.test.ts` (born 2026-06-20, this PR) | 10 vitests: fixture discovery + matrix-vs-resolver sanity + per-fixture distribution + gap check + 2 ratchets + exempt reason + no-contradiction + non-stale exempt + distribution sanity | New course-ref fixtures shipping with unresolved source-refs (the 2026-06-20 fingerprint: 5 IELTS modules referencing non-existent ContentSource rows). |
| `apps/admin/scripts/check-fk-consistency.ts` Query 14 (this PR) | WARN-only SQL against hosted DBs | Post-projection drift in `Playbook.config.modules[]` against `ContentSource` rows. CI's ephemeral DB returns 0 by construction. |
| `apps/admin/lib/wizard/resolve-module-source-refs.ts` (#1850 P3f + P3g) | Runtime resolver with structured warnings + skip reasons | The runtime layer that silently returns null today; S3 of epic #2166 upgrades to emit `source_ref.unresolved` AppLog subjects. |

## Future hardening

- **S3 of #2166** — `selectPinnedCardForModule` and
  `resolveModuleSourceRefs` log `source_ref.unresolved` with
  `{playbookId, moduleSlug, fieldName, refValue}` so the silent
  failure mode becomes operator-visible.
- **Promotion of Query 14** to error severity once the IELTS Sources
  1-5 backfill (sibling story) clears the incumbent debt on
  hf_sandbox + hf_staging.
- **ESLint rule** blocking new code paths that introduce soft
  source-refs without a paired `ContentSource` write (long-term;
  Theme 1b migration to proper FK columns supersedes this).

## Related

- [`tests/lib/wizard/source-ref-coverage.test.ts`](../../apps/admin/tests/lib/wizard/source-ref-coverage.test.ts) — the test
- [`apps/admin/scripts/check-fk-consistency.ts`](../../apps/admin/scripts/check-fk-consistency.ts) Query 14 — the DB-time sibling
- [`apps/admin/lib/wizard/resolve-module-source-refs.ts`](../../apps/admin/lib/wizard/resolve-module-source-refs.ts) — the runtime resolver
- [`apps/admin/lib/wizard/parse-content-sources.ts`](../../apps/admin/lib/wizard/parse-content-sources.ts) — the `## Content Sources` index parser
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage gate (same shape, different surface)
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- Epic [#2166](https://github.com/WANDERCOLTD/HF/issues/2166) — BIG LATTICE MISS #2 (parent)
