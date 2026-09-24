# Data Presence Coverage (Lattice Coverage-pillar sub-pillar)

> The Lattice Coverage pillar has two sub-pillars. The first —
> **Producer↔Consumer Coverage** — pins CODE pairing (does a consumer
> read what a producer writes?). The second — **Data Presence Coverage**
> — pins DATA presence (does the DATA row a soft reference, declared
> need, or runtime resolver depends on actually EXIST in the target
> table / environment?).
>
> Producer↔Consumer answers "is the code wired?". Data Presence answers
> "is the data wired?". Both are necessary; neither is sufficient.
>
> Sibling sub-pillar:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md) +
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) +
> [`parameter-coverage.md`](./parameter-coverage.md) +
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) —
> all members of the Producer↔Consumer sub-pillar.
>
> First instances (Data Presence sub-pillar):
> [#2166](https://github.com/WANDERCOLTD/HF/issues/2166) (soft
> source-ref → ContentSource — the live IELTS Sources 1-5 leak); the
> existing [`db-registry-parity.md`](./db-registry-parity.md) cross-
> environment parity discipline (single-surface instance of the
> cross-env shape this sub-pillar generalises).
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> under the "Data Presence (Coverage sub-pillar)" section. Born of
> epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168) — the
> 2026-06-21 operator framing: *"is our lattice all code, or is it
> underpinned by data entries?"*

## Rule: data-presence checks belong on the Lattice

When you write a code path that:

1. Reads a JSON-column soft reference and resolves it to a sibling
   table row (e.g. `AuthoredModule.settings.cueCardPool` →
   `ContentSource`), OR
2. Declares a per-mode / per-state runtime DEPENDENCY on the
   existence of specific data (e.g. every `mode: examiner` module
   needs a cue-card pool), OR
3. Assumes data parity across environments (e.g. published Playbooks
   look the same on hf_sandbox / hf_staging / hf_prod), OR
4. Authors a doc whose quantitative claim ("88 cue cards") MUST
   match the projected DB row count, OR
5. Defines a Cartesian-completeness expectation (every `(X, Y)`
   combination has data), OR
6. Asserts the cascade can reach a layer (every active Caller has a
   CallerTarget for every Skill parameter),

then the resolver / dependency / assumption MUST be paired with a
**Data Presence Coverage gate** that fails CI when the data is
missing — instead of silently returning `null` at runtime.

```
JSON ref / declared need → DPC gate enumerates targets →
  classify each as `present` / `exempt` / `gap` → ratchet incumbent
  → AppLog `data_presence.unresolved` on runtime miss
```

## The six generic shapes

| Shape | Pattern | First / canonical instance |
|---|---|---|
| **Soft FK resolvability** | JSON column carries a string ref to a sibling table; runtime resolver returns `null` when missing | #2166 — module-config source-refs (`cueCardPool` / `topicPool` / `scaffoldPool` / `contentSourceRef`) → ContentSource |
| **Declared-need fulfilment** | Config declares "this mode needs X data"; runtime silently degrades when X is empty | future S1 — every `mode: examiner` module has cueCardPool data; every `mode: quiz` module has ContentQuestion rows |
| **Cross-environment parity** | Same data shape across hf_sandbox / hf_staging / hf_prod | existing [`db-registry-parity.md`](./db-registry-parity.md) (single surface today: `Parameter.domainGroup`); generalises to per-Playbook structural parity |
| **Authored-vs-projected parity** | Doc says N items → DB has N items | future S3 candidate — course-ref quantitative claims (e.g. v2.3 declares 88 cue cards) match DB row counts |
| **Cartesian completeness** | Every `(X, Y)` combination has data | future S4 candidate — every `AuthoredModuleMode` × every PUBLISHED course has a runnable spec-selection result |
| **Cascade reachability** | A value at one layer cascades through to next | future S5 candidate — every Skill parameter has a CallerTarget seeded for every active Caller |

Each shape becomes an instance gate that follows the canonical
enumerate→classify→ratchet shape.

## Canonical shape (every instance follows this)

```
1. Enumerate the targets    — walk every declared need / soft ref / cross-env row
2. Classify each target     — present | exempt | gap
3. Pin the ratchet           — EXPECTED_GAP_COUNT + EXPECTED_EXEMPT_COUNT (monotonic only-drops)
4. Exempt-with-reason        — >20-char justification per exempt entry
5. Runtime AppLog subject   — `data_presence.unresolved` (or sub-shape) on resolver miss
6. Paired rule file          — `.claude/rules/data-presence-<surface>-coverage.md`
7. Inventory row             — `docs/lattice-chains.md` Data Presence section
```

This shape mirrors the Producer↔Consumer sub-pillar's canonical shape
(`registry-consumer-coverage.test.ts`, `parameter-coverage.test.ts`,
etc.). The structural identity is intentional: same patterns,
different SURFACE.

## When this applies

Any code path that depends on the existence of a row in a target
table without the type system or a FK constraint enforcing it.
Specifically:

1. **JSON-column soft references** — `Playbook.config.modules[].settings.cueCardPool` carries a string like `source:cue-card-bank-part-2` that must resolve to a `ContentSource.slug`. No Postgres FK; no Prisma relation; resolver returns `null` on miss.
2. **Declared-need runtime resolvers** — `selectPinnedCardForModule` reads the module's mode + settings and assumes the declared content pool has rows.
3. **Cross-environment assumptions** — code that reasons about "what's in hf_staging" (e.g. demo scripts, deploy seeds) and assumes parity with hf_sandbox.
4. **Authored-doc projections** — wizard's `applyProjection` walks a course-ref doc's `## Cue cards` block expecting N entries to land in DB.
5. **Cartesian inputs** — pipeline dispatch matrices (mode × course) where every cell needs a runnable spec.
6. **Cascade-eligible defaults** — values that flow from System → Domain → Course → Caller and assume the Caller layer is seeded.

## When NOT to apply

This sub-pillar is about **structural absence of data**. It does NOT
cover:

- **Typed unions covered by Producer↔Consumer Coverage** — e.g.
  `SessionKindString` value drift is the sibling sub-pillar
  ([`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)).
  That's a CODE pairing question, not a DATA presence question.
- **Row-level data integrity** — e.g. "this user's email is malformed"
  is field validation, not presence coverage.
- **Authored-content quality** — e.g. "this cue card's prompt is too
  short" is content QA, not presence.
- **Performance / scaling** — Lattice is correctness, not load.
- **External vendor data** — VAPI / OpenAI / Anthropic upstream API
  state is out of scope.

Each instance gate's own rule file documents its specific narrower
exclusions.

## Required structure for new instance gates

When adding a new Data Presence Coverage instance gate to HF:

1. **Rule file naming** — `.claude/rules/data-presence-<surface>-coverage.md`. Example: `.claude/rules/data-presence-source-ref-coverage.md` for #2166.
2. **Ratchet shape** — both `EXPECTED_GAP_COUNT` and `EXPECTED_EXEMPT_COUNT` constants in the test file. Both monotonically decrease only.
3. **Exempt list** — same shape as sibling Coverage gates: `EXEMPT_<SURFACE>: Record<string, { reason: string }>` with >20-char justifications.
4. **Runtime AppLog subject** — on any runtime data-presence miss, fire `log({ subject: "data_presence.<surface>.unresolved", payload: { ... } })`. This makes the failure mode operator-visible instead of silent. The structural decision per epic #2168: **silent null returns are a Lattice violation**.
5. **Inventory row** — add to `docs/lattice-chains.md` Data Presence (Coverage sub-pillar) section with the same column shape as other rows: `Chain | Producer | Consumer | Status | Gate | Severity | Notes`.
6. **Self-maintenance bump** — `apps/admin/tests/lib/lattice-self-maintenance.test.ts` ratchets for both the new Coverage test (if vitest) AND the new rule file. Run the test; let it tell you the new ratchet number; commit the bump.
7. **Don't centralise** — each instance is its own gate with its own ratchet. The umbrella is conceptual + catalogue. Per epic #2168 decision 8.

## Why a sibling sub-pillar (not a new top-level pillar)

The Coverage pillar's identity is *bidirectional structural tests*.
That identity holds for both sub-pillars — Producer↔Consumer and Data
Presence both ratchet incumbent counts, both require exempt-with-
reason, both close drift classes via enumerate→classify rather than
assertion-per-row. The substrate (the test patterns, the ratchet
shape, the exempt-list discipline) is shared.

What differs is the **surface**:

- Producer↔Consumer asks: "does this code consume what that code
  produces?"
- Data Presence asks: "does the row the code references actually
  exist?"

Splitting these into separate sub-pillars under the Coverage umbrella
matches operator mental model (the 2026-06-21 framing: "all code OR
underpinned by data") without inventing a 6th top-level pillar that
shares 90% of its substrate with the 5th.

## The hidden assumption this sub-pillar names

Every Producer↔Consumer Coverage gate has, implicit in its design,
the assumption: *the data the producer writes and the consumer reads
EXISTS*. The producer doesn't claim it's writing rows that aren't in
DB. The consumer doesn't claim it's reading rows that aren't in DB.
The Coverage test pins the wiring — it does NOT pin the underlying
row count.

Pre-#2168, "is the data wired?" was the silent assumption. The IELTS
Sources 1-5 incident (5 module source-refs to non-existent ContentSource
rows) revealed it. Naming the assumption — making it a sub-pillar
question instead of a hidden one — is what this umbrella delivers.

## Existing enforcement (sub-pillar inventory at birth)

| Instance | Gate | Status |
|---|---|---|
| #2166 — soft source-ref → ContentSource | `tests/lib/wizard/source-ref-coverage.test.ts` (in flight) + `apps/admin/scripts/check-fk-consistency.ts` new query + AppLog `source_ref.unresolved` runtime guard | 🚧 IN FLIGHT |
| [`db-registry-parity.md`](./db-registry-parity.md) `Parameter.domainGroup` DB parity ratchet | `tests/lib/registry/parameter-domain-group-db-parity.test.ts` (#2040 S7) + `check-fk-consistency.ts` Query 13 | ⚠️ PARTIAL (cross-env shape, single surface today) |
| Future — declared-need fulfilment (every `mode: examiner` has cueCardPool data) | not yet built | ❌ GAP — candidate instance per epic #2168 |
| Future — published-Playbook structural parity across envs | partial via `db-registry-parity.md` | ⚠️ PARTIAL — candidate instance per epic #2168 |
| Future — authored-vs-projected parity (course-ref claim count ↔ DB row count) | not yet built | ❌ GAP — candidate instance per epic #2168 |
| Future — Cartesian completeness (every mode × course has a runnable spec) | not yet built | ❌ GAP — candidate instance per epic #2168 |
| Future — cascade reachability (every Skill param has a CallerTarget per active Caller) | not yet built | ❌ GAP — candidate instance per epic #2168 |

## Related

- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — inventory; Data Presence section lives below Configuration
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage sub-pillar (Producer↔Consumer) and template for new Coverage gates
- [`.claude/rules/parameter-coverage.md`](./parameter-coverage.md) — sibling Producer↔Consumer Coverage gate; same shape
- [`.claude/rules/db-registry-parity.md`](./db-registry-parity.md) — sibling cross-environment parity discipline; existing single-surface instance of this sub-pillar's cross-env shape
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Producer↔Consumer Coverage gate
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline (now MUST include both sub-pillar questions)
- Epic [#2168](https://github.com/WANDERCOLTD/HF/issues/2168) — umbrella for this sub-pillar
- Epic [#2166](https://github.com/WANDERCOLTD/HF/issues/2166) — first instance (soft source-ref → ContentSource)
- Story [#2167](https://github.com/WANDERCOLTD/HF/issues/2167) — IELTS Sources 1-5 data backfill (drives #2166's ratchet to 0)
- PR #2144 — established the Producer↔Consumer sub-pillar's recent additions (mode-ui-coverage + sessionkind-reader-coverage + learner-ui-leak-coverage)
- Memory: `feedback_lattice_5th_pillar_coverage.md` — original Coverage pillar framing this sub-pillar extends
