# Epic 100 — Verification harness

> Operating manual for the harness that proves each Epic 100 story moves the right counter.
> Required reading: [`docs/epic-100-chain-walk.md`](epic-100-chain-walk.md), [Epic #600](https://github.com/WANDERCOLTD/HF/issues/600), [harness story #631](https://github.com/WANDERCOLTD/HF/issues/631).

---

## What the harness is

Five components, one purpose: **prove that each Epic 100 story drives its specific counter to its documented target without breaking anyone else's invariant.**

| Component | File | Purpose |
|-----------|------|---------|
| 1. Audit script | `apps/admin/scripts/audit-epic-100.ts` | Read-only audit — 11 counters tagged `invariant` (block CI) or `informational` (report-only). Exits non-zero only when an `invariant` is above target. |
| 2. Audit baseline | `apps/admin/tests/fixtures/epic-100-audit-baseline.json` | Snapshot of current counts. Each story PR updates the row(s) it owns. |
| 3. Golden-prompt baseline | `apps/admin/tests/fixtures/epic-100-golden-prompt-baseline.json` | Frozen ComposedPrompt JSON for the canonical Nico Grant evidence case. Each story PR diffs against this. |
| 4. Behaviour evals | `apps/admin/evals/epic-100/*.yaml` | Promptfoo evals — one per behavioural contract. BEFORE-mode asserts the broken behaviour is detectable; flipped to AFTER-mode by the story PR. |
| 5. Sim-call proof | `apps/admin/scripts/proof/epic-100/sim-canonical-call.ts` | Deterministic post-pipeline shape check against the golden caller. |

CI wiring: `npm run ctl check` runs the audit script as step 6 (after FK consistency).

---

## Running locally (edit machine)

The edit machine cannot reach the dev DB. The audit script and sim-call proof
both detect this case and exit 0 with a warning — that lets `npm run ctl check`
finish without false failures on the edit machine. To exercise the full audit,
run on the VM.

```bash
# Type-check the harness
cd apps/admin
npx tsc --noEmit scripts/audit-epic-100.ts
npx tsc --noEmit scripts/proof/epic-100/sim-canonical-call.ts

# Lint
npm run lint -- scripts/audit-epic-100.ts scripts/proof/epic-100/sim-canonical-call.ts

# Promptfoo eval parsability
npx promptfoo eval -c evals/epic-100/no-tutor-training-mcq.yaml --no-cache --dry-run
```

---

## Running on the VM (full audit)

```bash
ssh hf-dev
cd ~/HF/apps/admin

# Full audit — human-readable
npx tsx scripts/audit-epic-100.ts

# JSON output (for the baseline file)
npx tsx scripts/audit-epic-100.ts --json > /tmp/audit.json

# Diff against current baseline (highlights what each PR changed)
npx tsx scripts/audit-epic-100.ts --diff=tests/fixtures/epic-100-audit-baseline.json

# Sim-call proof
npx tsx scripts/proof/epic-100/sim-canonical-call.ts

# Re-snap the golden prompt baseline (after a story merges)
npx tsx scripts/proof/epic-100/sim-canonical-call.ts --snap
```

---

## Per-story workflow

When you build a Tier 1+ Epic 100 story:

1. **Branch off the previous story's branch** (Tier 1 stacks: #631 → #606 → #611 → …).
2. **Make your fix.**
3. **Update the relevant counter target** in `tests/fixtures/epic-100-audit-baseline.json`. The counter's new value MUST be ≤ its target.
4. **Flip the corresponding eval** from BEFORE-mode to AFTER-mode — move the
   `flip-after-merge.tests` block into `tests:`.
5. **Run `npm run ctl check`** locally — confirm the audit step still exits 0
   (it will, because the harness exits 0 on DB-unreachable).
6. **Open PR.** State in the body: *"#NNN counter `X` driven from <before> → <after>."*
7. **CI on the VM** re-runs the audit against the live DB; that's the moment
   the counter actually has to be at its target.

---

## Counter kinds — invariant vs informational

The audit emits two distinct counter kinds. **Only invariants block CI.**

- **`invariant`** — a contract the adaptive loop must hold. If above target, the audit exits non-zero and `npm run ctl check` step 6 fails. Each Epic 100 story drives one or more invariants to their target.
- **`informational`** — a number worth knowing but not a contract violation per se: either **leak surface** (raw DB rows that exist but are filtered at runtime — fix is in code, not the data) or **historical drift** (pre-fix rows that only drain via a separate migration). Reported in output and JSON but never fail the build.

This distinction was added on 2026-05-22 after Tier 1. The earlier shape treated every counter the same and produced misleading "still failing" messages on counters whose runtime fix had already landed.

## Counter map

| Counter key | Story | Kind | Target | What it measures |
|-------------|-------|------|--------|------------------|
| `duplicatePlaybookSubjects` | #607 | invariant | 0 | Same subject linked to same playbook twice |
| `recallQuizOnInstructionCategories` | #605 | invariant | 0 | Tutor-instruction assertions tagged `recall_quiz` |
| `tutorOnlyQuestionsLeakSurface` | #606 | informational | 0 | TUTOR_ONLY ContentQuestion rows present in the DB (filtered at loader; not deleted) |
| `dualLoMasteryKeysSameLO` | #611 | informational | 0 | Pre-#611 dual `lo_mastery:*` keys for the same LO (drains via #614) |
| `callScoreZeroStorms` | #611 | informational | 0 | Pre-#611 calls with >40 CallScore rows all scored 0 (drains via CallScore cleanup) |
| `orphanLearningObjectives` | #615 | invariant | 0 | LearningObjective with no surviving CurriculumModule parent |
| `danglingContentAssertionLOs` | #615 | invariant | 0 | ContentAssertion.learningObjectiveId points at a deleted LO |
| `advisorInInputsSnapshot` | #608 | invariant | 0 | Active ComposedPrompts whose `inputs.specUsed` mentions `spec-advisor-001` |
| `callerAttributeOldKeyFormCount` | #614 | invariant | 0 | Old name-form `lo_mastery:*` keys awaiting slug migration |
| `playbooksWithoutTeachingMode` | #604 | invariant | 0 | Prerequisite — #604's archetype-aware criticalRules requires `Playbook.teachingMode` populated |
| `hardcodedRulesRemainingInTransforms` | #610 | invariant | 0 | Static grep — files under `lib/prompt/composition/transforms/` still containing hardcoded behavioural strings |

---

## Failure modes + how to investigate

| Symptom | First place to look |
|---------|---------------------|
| Counter `X` went UP after a merge | The merge introduced a contract regression. Revert + open a fix-up branch. |
| Counter `X` flat after a merge | The fix didn't take. Check whether the relevant write path actually changed. |
| Audit script throws on a counter query | Schema drift — the column the counter joins on was renamed/removed. Update the query in `audit-epic-100.ts`. |
| Sim-call proof flags `prior-call-feedback-relevance` failure | Symptom-3 still firing — #611 Fix C did not land cleanly. |
| Promptfoo eval still passing in BEFORE-mode after merge | Eval needs flipping to AFTER-mode — story PR forgot to swap the `flip-after-merge` block. |

---

## Sequencing reminder

Per [`docs/epic-100-chain-walk.md`](epic-100-chain-walk.md):

```
#631 (this harness — blocks all others, lands first)
  ↓
#606 → #607 → #605 → #608-C → #604 → #611 (monolithic) → #614 → #615 → #608-A → #610 → #616
```

Tier 1 (this sprint): #631 → #606 → #611. Story PRs stack on each other; do not
merge out of order.
