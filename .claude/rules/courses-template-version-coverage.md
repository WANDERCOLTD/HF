# Courses template-version coverage (Lattice Coverage-pillar member)

> Every production course-reference doc — first-party HF courses under
> `docs/courses/**/*.course-ref.md` AND external partner course imports
> under `docs/external/**/Upload Docs/{*.course-ref.md,course-ref.md}` —
> MUST carry `hf-template-version: "X.Y"` in YAML front-matter. The
> marker is what disambiguates which template revision the doc was
> authored against. Drift is silent without the gate.
>
> Sibling Coverage-pillar tests:
> [`registry-schema-coverage.md`](./registry-schema-coverage.md),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md),
> [`fixture-type-coverage.md`](./fixture-type-coverage.md). Same generic
> enumerate→classify→ratchet pattern. Story: #1991 S5 of epic #1986.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you author or modify a course-reference doc at any of these paths:

- `docs/courses/**/*.course-ref.md` — first-party HF courses
- `docs/external/**/Upload Docs/course-ref.md` — partner imports
- `docs/external/**/Upload Docs/*.course-ref.md` — partner imports (named variant)

The doc MUST open with a YAML front-matter block whose body contains
the `hf-template-version` key:

```yaml
---
hf-template-version: "5.1"
---
```

Valid forms:
- `hf-template-version: "5.1"` (preferred — quoted)
- `hf-template-version: '5.1'` (single-quoted)
- `hf-template-version: 5.1` (unquoted)

The version pattern is `\d+\.\d+` — major + minor.

## Why this exists

Course-ref docs feed the wizard's `applyProjection` pipeline. Each
template revision changes the YAML schema (new keys, removed keys,
relocated nesting). Without a top-of-file version marker, the parser
can't tell which revision the doc targets, so:

- A v4.x doc fed to a v5.x parser silently drops keys the parser
  doesn't recognise.
- A v5.x doc fed to a v4.x parser may interpret renamed keys as the
  old semantics.
- The wizard's "rebuild course from doc" loop can't refuse to apply
  a doc authored against a future template.

The 2026-06-18 audit (epic #1986) found that every production
course-ref had been migrated to v5.1 (commit `31e58e17`) but no
structural gate enforced the marker. A new course-ref shipped without
the marker would slip through review.

## How matching works

The vitest at
[`tests/lib/courses/courses-template-version-coverage.test.ts`](../../apps/admin/tests/lib/courses/courses-template-version-coverage.test.ts)
walks the two surfaces:

1. Recursively walk `docs/courses/` for `*.course-ref.md`.
2. Recursively walk `docs/external/` for `course-ref.md` AND
   `*.course-ref.md` — but only when the file's path includes a
   `/Upload Docs/` segment (the partner-import convention).

For each file:

1. If its path (relative to repo root) is in
   `COURSES_TEMPLATE_VERSION_EXEMPT` → `exempt`.
2. Read the file; require `---` on line 1 (front-matter open) and
   another `---` within the first 30 lines (front-matter close).
3. Inside the front-matter, regex-match
   `^hf-template-version:\s*["']?(\d+\.\d+)["']?\s*$`.
4. Match → `compliant`. No match (or missing front-matter) → `gap`.

The walk **deliberately excludes**:

- `apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-*.md`
  (wizard test fixtures)
- `apps/admin/tests/fixtures/course-reference-ielts-*.md`
  (seed-test fixtures)
- `apps/admin/test-data/**/course-ref-*.md` (KS2-SATs + IELTS
  Writing Task 2 test data)
- `a-sample-docs/course-reference-template.md` (the template itself)
- `a-sample-docs/humanfirst-3-session-course-reference.md` (sample)

These are NOT production course-refs — they belong to test/fixture
surfaces governed by other gates (e.g. `fixture-type-coverage.md`).

## When NOT to apply

- Files under `apps/admin/lib/wizard/__tests__/fixtures/` — covered by
  [`fixture-type-coverage.md`](./fixture-type-coverage.md), governed
  by the wizard parser's own type-vs-key gate.
- Files under `a-sample-docs/` — the template and samples are
  authoring guidance, not production input.
- `.md` files inside `docs/courses/` that are NOT `*.course-ref.md`
  (planning notes, README, evaluation memos) — the walk only matches
  the `*.course-ref.md` suffix.
- `.md` files under `docs/external/**` that are NOT inside an
  `Upload Docs/` directory — partner reference material, not course
  inputs.

## When adding a new course-ref

Author checklist — same PR:

1. Drop the new file at `docs/courses/<slug>/<slug>.course-ref.md` (or
   for partners: `docs/external/<provider>/<exam>/Upload Docs/course-ref.md`).
2. Open the file with the YAML front-matter block:
   ```yaml
   ---
   hf-template-version: "5.1"
   ---
   ```
   Use the current template version (check the most recently-merged
   course-ref for the canonical version string).
3. The vitest auto-picks up the new file via the directory walk —
   no test edit needed.
4. Run `npx vitest run tests/lib/courses/courses-template-version-coverage.test.ts`.
5. If green → ship. If `gap` → add the marker, OR (in rare cases —
   e.g. a course-ref retired but kept for forensic reference) add to
   `COURSES_TEMPLATE_VERSION_EXEMPT` with a reason and bump
   `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.

## When deleting a course-ref

1. Delete the file.
2. If the file was in `COURSES_TEMPLATE_VERSION_EXEMPT`, remove the
   entry and drop `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET` by 1.
3. Run the test — the non-stale-exempt assertion catches the missed
   step.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/courses/courses-template-version-coverage.test.ts` (born 2026-06-18, this PR) | 6 vitests: gap-check, ratchet, non-empty-reason, non-stale-exempt, no-contradiction, distribution-sanity | New course-ref shipping without `hf-template-version`. Stale exempt entries. Files silently marked + still in exempt. |
| Course-ref docs themselves | The front-matter marker | Future parser changes can detect the revision before consuming the body |
| Recent migration commit `31e58e17` (2026-06-18) | One-time backfill | Brought every production course-ref to v5.1 |

## Future hardening

When the wizard parser at `apps/admin/lib/wizard/extract-per-module-settings.ts`
(and siblings) is taught to BRANCH on `hf-template-version` (different
parsers for v4 vs v5), this gate becomes load-bearing for correctness
in addition to discoverability — a v4 doc lacking the marker would
silently fail v5-parse with cryptic missing-key errors.

A second layer worth adding: validate the version value against an
allowed-set constant in `lib/wizard/template-versions.ts`, so a typo
(`5.10` instead of `5.1`) doesn't pass the regex but fail the parser.
Today's regex is shape-only.

## Related

- [`tests/lib/courses/courses-template-version-coverage.test.ts`](../../apps/admin/tests/lib/courses/courses-template-version-coverage.test.ts) — the test
- [`.claude/rules/fixture-type-coverage.md`](./fixture-type-coverage.md) — sibling gate covering wizard test fixtures
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test, same generic pattern
- Story: [#1991](https://github.com/WANDERCOLTD/HF/issues/1991) — this gate (S5 of epic #1986)
- Parent epic: [#1986](https://github.com/WANDERCOLTD/HF/issues/1986) — Course-ref template versioning
- Migration commit `31e58e17` — course-refs migrated to v5.1
- Memory: `feedback_lattice_5th_pillar_coverage.md` — Coverage pillar
