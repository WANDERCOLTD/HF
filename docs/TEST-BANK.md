# Test Bank

A curated catalog of high-signal tests we deliberately keep — the ones that
**prove a property we care about**, not the ones that just exercise the
happy path. Each entry below names the invariant being defended, the
incident or issue that motivated the test, and how to run it.

If a test isn't in this bank, it isn't necessarily worthless — but if a
test IS in this bank, it must be runnable in isolation and its failure
mode must be obvious without reading the surrounding code.

## How to use

| Situation | Action |
|---|---|
| Triaging a regression in a load-bearing area | Run the bank entries tagged with that area first — they isolate failure modes faster than the full suite |
| Reviewing a PR that touches a guarded contract | Locate the bank entry and re-read it; if the PR changes behaviour the entry should be updated in the same PR |
| Adding a new structural fix | Add a bank entry alongside the fix (see "Adding an entry" below) |
| Boot-strapping a new contributor | The bank doubles as a tour of the invariants this codebase cares about |

## Adding an entry

Two parts:

1. **The test file.** Lives in its normal place under `apps/admin/tests/...`.
   The file's top docstring MUST list the acceptance criteria it proves
   (numbered, one line each) so the test stands on its own.
2. **An index entry in this doc.** Use the template at the bottom.

Bank-worthy tests:

- Defend a named invariant or chain contract (`docs/CHAIN-CONTRACTS.md` /
  `docs/epic-100-chain-walk.md`)
- Pin behaviour at a known landmine (the kind of thing that broke once and
  we don't want to relearn)
- Cover a guard listed in `.claude/rules/ai-to-db-guard.md`
- Are cheap to run in isolation (single file, no external services)

Not bank-worthy:

- Tests that mostly exercise framework or library behaviour
- Snapshot tests with no narrative in the docstring
- Anything that needs a live DB, a network call, or a running dev server
  (these are integration tests — track them in `docs/INTEGRATION-TESTS.md`
  when we have one)

## Running the bank

```bash
# Single entry
cd apps/admin && npx vitest run <path-from-the-entry-card>

# Whole bank (uses the `bank/` tag — see "Tagging" below)
cd apps/admin && npx vitest run --reporter=verbose $(grep -oE 'apps/admin/tests/[^ ]+\.test\.tsx?' docs/TEST-BANK.md | sort -u | sed 's|apps/admin/||g')
```

## Tagging

Every bank entry's `describe(...)` block should start with a hashtag that
matches its area, so we can grep:

| Tag | Area |
|---|---|
| `#928` / `#611` / `#614` | Issue / epic this test defends |
| `compose-read-scope` | COMPOSE-stage read-site filters |
| `ai-to-db-guard` | Guards in `.claude/rules/ai-to-db-guard.md` |
| `chain-contract` | A named contract from `docs/CHAIN-CONTRACTS.md` |
| `slug-scope` | `#407` / `#415` slug-scoping invariants |

Mixing tags is fine. `describe("buildLoMasteryMap (#928 scoping helper)", ...)` is good.

---

## Entries

### 001 — `buildLoMasteryMap` cross-course scoping

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/lib/prompt/composition/lo-mastery-map.test.ts` |
| **Subject** | `apps/admin/lib/prompt/composition/lo-mastery-map.ts::buildLoMasteryMap` |
| **Defends** | Chain-walk Link 6 (ADAPT → COMPOSE) — CallerAttribute `lo_mastery` reads must be scoped to the current curriculum spec slug. |
| **Issue / origin** | [#928](https://github.com/WANDERCOLTD/HF/issues/928) — cross-course bleed when a learner is enrolled in multiple playbooks with different curriculum specs. |
| **Failure mode it pins** | A learner enrolled in courses A and B finishes calls on A. Mastery rows pile up under `curriculum:spec-A:lo_mastery:*`. Next call composes for B — pre-#928 a tolerant `.includes(':lo_mastery:')` matcher pulled A's rows into B's `loMasteryMap`, skewing `informationNeed` and surfacing the wrong LOs in `PROGRESS NARRATIVE`. |
| **What it proves** | 13 properties: current-spec rows surface; sibling-spec rows filtered; mixed-spec input returns only current; colliding suffix keeps only current; undefined/empty slug → empty map (graceful); null/empty attrs → empty map; non-CURRICULUM scope filtered; null `numberValue` filtered; legacy name-form module token preserved (#611/#614 grace window); rows without `:lo_mastery:` segment ignored; no prefix-leak when one slug is the prefix of another (`IELTS` vs `IELTS-WRITING`); empty-suffix rows dropped. |
| **How to run** | `cd apps/admin && npx vitest run tests/lib/prompt/composition/lo-mastery-map.test.ts` |
| **When to re-run** | Any change to `lo-mastery-map.ts`, the three transforms that consume it (`transforms/modules.ts`, `transforms/retrieval-practice.ts`, `transforms/progress-narrative.ts`), or `SectionDataLoader` `callerAttributes` loader. Also re-run before flipping the `callerAttributeOldKeyFormCount` audit gate to remove the grace window. |
| **Status** | ✅ green (13/13, 2026-05-27) |
| **Owner area** | Composition / Adaptive Loop |
| **Related** | `#611` canonical-slug write path · `#614` legacy-key drain · `#615` FK consistency audit · `docs/epic-100-chain-walk.md` Link 6 |

---

## Template for a new entry

```markdown
### NNN — <short subject>

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/...test.ts` |
| **Subject** | `apps/admin/lib/...` (the unit under test) |
| **Defends** | <named invariant / contract / chain link> |
| **Issue / origin** | [#NNN](url) — one-line context |
| **Failure mode it pins** | <plain-English description of the bug this stops from coming back> |
| **What it proves** | <enumerated properties, comma-separated or short list> |
| **How to run** | `cd apps/admin && npx vitest run tests/...` |
| **When to re-run** | <which file edits should trigger a re-run> |
| **Status** | ✅ green (N/N, YYYY-MM-DD) | 🟡 flaky | 🔴 disabled |
| **Owner area** | <subsystem> |
| **Related** | <other issues / docs> |
```

## House rules

- **One file, one entry.** If a test file covers multiple invariants, split
  the entry into A/B (e.g. `004A`, `004B`) so each defended property has its
  own card.
- **Update on behaviour change.** If a PR changes what the test proves,
  update the entry in the same PR.
- **Don't promote happy-path tests.** A test belongs in the bank because it
  prevents a class of bug from coming back, not because it's well-written.
- **Status freshness.** When you re-run an entry as part of triage, bump
  the date in the Status row.
