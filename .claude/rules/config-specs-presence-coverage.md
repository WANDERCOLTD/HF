# config.specs.* presence coverage (Data Presence sub-pillar)

> Every `config.specs.*` getter in `lib/config.ts` MUST point at a real
> AnalysisSpec — a spec file under `docs-archive/bdd-specs/` that
> `parseJsonSpec` accepts so `seed-from-specs.ts` actually writes the
> row. A getter pointing at a non-existent or unparseable spec is a
> silent runtime failure: `findFirst({slug})` returns `null` and the
> consumer silently degrades.
>
> Sibling Data Presence Coverage gates:
> [`source-ref-coverage.md`](./source-ref-coverage.md) (soft source-ref
> → ContentSource — story #2166),
> [`db-registry-parity.md`](./db-registry-parity.md) (DB ↔ JSON 12-tuple
> parity — story #2031 family).
>
> Sibling Producer↔Consumer Coverage gates use the same
> enumerate→classify→ratchet shape on the code-pairing surface:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`mode-ui-coverage.md`](./mode-ui-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md).
>
> Born of PR #2307 (TOOLS-001 silent fallback — three stacked structural
> failures invisible to CI). Story
> [#2311](https://github.com/WANDERCOLTD/HF/issues/2311). Part of the
> Coverage pillar of HF Lattice (Data Presence sub-pillar — epic
> [#2168](https://github.com/WANDERCOLTD/HF/issues/2168)).

## Rule

When you add a new `optional("<X>_SPEC_SLUG", "<default>")` getter under
`lib/config.ts::config.specs.*`:

1. **Author or identify the spec file** — `docs-archive/bdd-specs/<id>*.spec.json`
   (file prefix matches the slug — `TOOLS-001-voice-tool-definitions.spec.json`
   for `TOOLS-001`).
2. **Confirm parseJsonSpec accepts it** — required fields are `id`,
   `title`, `version`, `story.{asA,iWant,soThat}`, `parameters: array`.
   Most SYSTEM / VOICE / OBSERVE specs that carry config data instead of
   measurement parameters need an explicit `"parameters": []` literal.
3. **Confirm consumer reads canonical slug shape** — seeder writes
   `spec-${id.toLowerCase()}` (per `prisma/seed-from-specs.ts:608`).
   Consumer MUST either match exactly (preferred — fast equality lookup)
   OR use a tolerant `slug: { contains, mode: "insensitive" }` shape
   that won't collide with sibling slugs containing the same substring.
4. **Run the test** —
   `tests/lib/registry/config-specs-presence-coverage.test.ts` walks every
   getter and asserts (1) + (2). If the spec file or parse is genuinely
   pending, add the slug to `CONFIG_SPECS_EXEMPT` with a >20-char `reason`
   citing #2311 + the structural cause, and bump `EXPECTED_EXEMPT_COUNT`.

## Why this exists

`config.specs.*` returns 50 slug strings at the time this rule was filed.
Each is a soft FK to an `AnalysisSpec` row resolved at runtime. The
failure modes pre-#2311:

| Mode | Symptom | Pre-#2311 detection |
|---|---|---|
| Spec file missing | `findFirst` returns null → silent fallback | Runtime log line (operator-invisible) |
| Spec file rejected by parseJsonSpec | `seed-from-specs` skips it → row absent → silent fallback | Warning in seed output (operator-invisible) |
| Seeder drops a config field on the COMPOSE branch | Row present, config empty → silent fallback | Runtime log line (operator-invisible) |
| Resolver uses wrong slug shape | `findFirst` matches the wrong sibling row | NO signal whatsoever — wrong data flows through |

PR #2307 hit THREE of these stacked on TOOLS-001. Six other slugs
(CONTENT-SOURCE-SETUP-001, COURSE-SETUP-001, COMMUNITY-SETUP-001,
INSTITUTION-SETUP-001, DEMONSTRATE-FLOW-001, TEACH-FLOW-001) are
silently failing in the same shape today — the test pins them at the
incumbent exempt ratchet (7 entries) and refuses new failures.

## How matching works

The test reads `lib/config.ts` as text and regex-matches every
`optional("<envVar>", "<defaultSlug>")` call returning a `_SPEC_SLUG`
default. For each:

1. **File-existence check** — find `<id>-*.spec.json` (or `<id>.spec.json`)
   under `docs-archive/bdd-specs/` (case-insensitive prefix match,
   strips a `spec-` prefix if present in the default — handles both
   bare-ID defaults like `TOOLS-001` and seed-output defaults like
   `spec-comp-001`).
2. **parseJsonSpec validation** — parse the file via the canonical
   validator. Catches the same silent-rejection class the seeder hits.

Pure structural — no DB. Runs in vitest. ~30ms.

## When NOT to apply

- Getters that return a non-spec value (model IDs, env paths, feature
  flags) — only `_SPEC_SLUG` getters are enumerated.
- Spec files that aren't referenced by any getter (the regex only sees
  getter defaults — orphan spec files don't trigger this gate; that's a
  separate concern).

## Ratchet shape

`CONFIG_SPECS_EXEMPT` is `Record<defaultSlug, { reason: string }>`.
`EXPECTED_EXEMPT_COUNT` pins the incumbent. New PRs that add to the
exempt list MUST also bump the ratchet — a conscious choice. New PRs
that REMOVE from the list (fix the underlying spec) MUST also drop the
ratchet — the test's "stale exempt" check fires when an entry references
a defaultSlug no getter declares.

## Runtime sibling (separate follow-on per #2311)

This rule is the **build-time** half. The runtime half — a query in
`scripts/check-fk-consistency.ts` that asserts `spec-<id-lowercase>`
exists in `AnalysisSpec` with `isActive=true` on hf_staging / hf_prod —
is deferred to a separate PR. Both layers together close the loop:

| Layer | Catches | Signal |
|---|---|---|
| Build-time (this gate) | Spec file missing or unparseable | vitest red at PR time |
| Runtime audit | Spec file fine but row missing on a specific environment (seed not run, manual deletion, restore from wrong backup) | CI-step ratchet on hf_staging / hf_prod |

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/registry/config-specs-presence-coverage.test.ts` (#2311) | Build-time structural test | Getters pointing at missing or unparseable specs |
| `lib/bdd/ai-parser.ts::parseJsonSpec` | Runtime validator | Malformed spec files |
| `prisma/seed-from-specs.ts` | Seed-time writer | (paired with parseJsonSpec — the silent-rejection class this gate exists to surface) |
| `lib/voice/load-tool-definitions.ts` (post-#2307) | Reference resolver pattern | Wrong-slug-shape lookups (uses deterministic `spec-${slug.toLowerCase()}`) |

## Related

- [`tests/lib/registry/config-specs-presence-coverage.test.ts`](../../apps/admin/tests/lib/registry/config-specs-presence-coverage.test.ts) — the test
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar
- [`.claude/rules/source-ref-coverage.md`](./source-ref-coverage.md) — sibling Data Presence instance
- [`.claude/rules/db-registry-parity.md`](./db-registry-parity.md) — sibling Data Presence instance
- PR [#2307](https://github.com/WANDERCOLTD/HF/pull/2307) — TOOLS-001 fix (the originating symptom)
- Story [#2311](https://github.com/WANDERCOLTD/HF/issues/2311) — this gate
- Epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168) — Data Presence Coverage umbrella
