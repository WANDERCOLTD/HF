# 2026-06-16 — Registry ↔ Schema Coverage as the 5th Lattice piece

**Status:** accepted
**Drives:** Lane 1 of the post-Slice-C BA-failure recovery
**Sibling docs:** [`.claude/rules/registry-schema-coverage.md`](../../.claude/rules/registry-schema-coverage.md) · [`docs/kb/guard-registry.md`](../kb/guard-registry.md)

## Decision

Add a sixth-level structural check to the Lattice:
**Registry ↔ Schema Coverage**. Every educator-facing field on
`PlaybookConfig` (+ its sub-interfaces) MUST be either:

1. **Covered** by a `JourneySettingContract.storagePath` in
   `JOURNEY_SETTINGS` or `VOICE_SETTINGS`, OR
2. **Exempted** in `REGISTRY_EXEMPT_PATHS` with a documented reason
   from one of four legitimate categories (wizard-owned, internal,
   derived, ai-only).

A vitest (`tests/lib/journey/registry-schema-coverage.test.ts`)
enforces this at CI time. The rule
(`.claude/rules/registry-schema-coverage.md`) anchors the discipline
for human reviewers.

## The BA failure that drove this

Slice C of epic #1675 shipped four PRs of structural hardening:

| PR | Slice | What it shipped |
|---|---|---|
| #1736 | C1 | Bucket-grained LH menu + multi-pulse + pick-strip |
| #1753 | C2 | Cascade-honesty (`useEffectiveValue` + `<CascadeValue>`) |
| #1772 | C3 | `no-bucketless-journey-setting` ESLint rule + writeGate UI lock chip + ADR + CONTRACTS-JOURNEY.md §17 |
| #1775 | follow-on | `moduleVisibility` Preview-lens tag (closed the lens-less gap) |

Each PR carried a "Lattice 4-pillar audit" claiming Chain Contracts /
Guards / Cascade / Rules were satisfied. None of them caught the fact
that the underlying registry was ~20 entries SHORT of the
`PlaybookConfig` schema it was supposed to cover.

The shortfall surfaced when an operator clicked on the "AI Intro Call"
Preview bubble and got an Inspector with no control for it. The
schema had `sessionFlow.intake.aiIntroCall.enabled` — wired through
the resolver, surfaced in PreviewLens — but the registry had no
contract. ~19 other contracts were similarly missing (#1403
`firstCallCourseIntro` / `firstCallWaitForAck`; #234 `shareMaterials`;
#1119 `tierPresetId`; #417 `skillMinCallsToFull`; #779
`progressNarrative.*`; #780 `offboardingSummary.*`; #598
`firstCall.durationMinsOverride` / `firstCall.introducePedagogy` /
`tolerances.*`; #599 `priorCallRecap.*`; #492
`interleaveReviewMinDays`; #494 `strictPrerequisites` /
`completionMode`; `nps.*`; `offboarding.triggerAfterCalls` /
`bannerMessage`).

## Why none of the 4 Lattice pillars caught it

| Pillar | What it audits | Why it missed the coverage gap |
|---|---|---|
| **Chain Contracts** | Cross-stage invariants documented in `docs/CHAIN-CONTRACTS.md` / `CONTRACTS-JOURNEY.md` | Audits the registry → composer → bubble chain WITHIN the registry. Doesn't audit registry coverage AGAINST `PlaybookConfig`. |
| **Guards** | ESLint rules blocking write-side mistakes | Catches new contracts WITHOUT a bucket. Doesn't catch new schema fields WITHOUT a contract. Inverse direction. |
| **Cascade** | `lib/cascade/effective-value.ts::resolveEffective()` discipline | Audits cascade-resolvable knobs only. Schema fields without cascade families are invisible. |
| **Rules** | `.claude/rules/*.md` discipline files | Process documents, not structural enforcement. Capture conventions; don't pin schema-vs-registry coverage. |

The shape of the miss: the Lattice was an inward-facing integrity
audit. Coverage is the OUTWARD-facing check that the structure even
matches its target surface.

## Considered alternatives

### (a) Manual periodic audit

Pro: lightweight; doesn't require new infrastructure.

Con: relies on someone remembering to audit, on a cadence that doesn't
exist. Exactly the failure mode we're recovering from. Rejected.

### (b) AST-driven schema walker

Build a vitest that uses `ts-morph` to walk `PlaybookConfig` field
names automatically and check each against the registry.

Pro: zero hand-curation. Self-updating.

Con: heavy dependency for a small check; AST walker would need to
classify which fields are "educator-facing" vs "internal" — that
classification is human judgement, not type-derivable. Drift between
the walker's classification heuristic and the dev's intent.

### (c) Hand-curated `EXPECTED_SCHEMA_PATHS` + vitest (CHOSEN)

Pro: every entry has provenance (source PR / context). PR review
sees the catalogue change explicitly. Forces the dev who adds a
field to ALSO add it to the test — that double-write IS the
discipline. The "catch-up" exempt block makes the existing shortfall
visible in the codebase, not hidden in a follow-on ticket.

Con: must be kept in sync manually. Mitigated by (1) the test
failing on additions, (2) the rule doc anchoring the discipline,
(3) the catch-up ratchet test surfaces debt at PR time.

## Why (c) wins

The double-write is the load-bearing piece. A new field must touch
two files: the schema (`json-fields.ts`) AND the catalogue
(`registry-schema-coverage.test.ts`). The dev cannot land the change
without thinking about coverage. That's the structural pressure
the 4-pillar Lattice was missing.

## The catch-up exempt block

The 20 known missing settings ship with this PR in
`REGISTRY_EXEMPT_PATHS` tagged `"catch-up: <name> contract pending
(<bucket> bucket)"`. This:

1. Surfaces the existing shortfall in the codebase (not in an issue
   tracker that may go stale).
2. Lets this PR ship without blocking all other work.
3. Provides a punch list for the Lane 3 follow-on PRs.
4. Is ratcheted DOWN by the catch-up sentinel — adding new
   "catch-up:" entries is a test failure.

As Lane 3 contract PRs land, exempt entries delete. When the
"catch-up:" prefix count reaches zero, the shortfall is closed.

## Lattice 5-pillar audit (post-this-PR)

| Pillar | Coverage |
|---|---|
| **Chain Contracts** | Unchanged — cross-stage invariants in CHAIN-CONTRACTS.md / CONTRACTS-*.md |
| **Guards** | Unchanged — `no-bucketless-journey-setting` + 22 sibling rules |
| **Cascade** | Unchanged — `resolveEffective()` + `<CascadeValue>` |
| **Rules** | Extended — `.claude/rules/registry-schema-coverage.md` lands as a new rule |
| **Coverage** | **NEW** — `registry-schema-coverage.test.ts` |

## Consequences

### Positive

- The "AI Intro Call" class of miss is structurally impossible after
  this lands. The next new `PlaybookConfig` field MUST be in the
  expected catalogue + covered/exempt.
- The 20 existing misses are now VISIBLE in the codebase, not in
  developer memory.
- The Lane 3 contract-add PRs have a queue + a ratchet → progress
  is observable.
- BA discipline is now structural: "what's the coverage check?"
  becomes a default question in PR review.

### Negative

- Hand-curated catalogue must be kept in sync. Mitigated by the
  tests + the double-write being the discipline.
- Adding new fields is one extra step. That's the point.

### Risks

- If the hand-curated catalogue itself drifts (someone deletes a
  schema field without updating the catalogue), the "stale exempt"
  test catches the exempt side; uncovered + present-in-schema is
  still possible if a dev DELETES an entry from EXPECTED without
  removing the field. Mitigated by PR review.

## Related

- Slice C epic: [#1675](https://github.com/WANDERCOLTD/HF/issues/1675)
- C1 (#1736), C2 (#1753), C3 (#1772), follow-on (#1775)
- [`docs/CONTRACTS-JOURNEY.md`](../CONTRACTS-JOURNEY.md) §17 — bucket model
- [`.claude/rules/registry-schema-coverage.md`](../../.claude/rules/registry-schema-coverage.md)
