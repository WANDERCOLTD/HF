# Architectural Thinking Patterns — Shared Reference

> **NOT an agent.** This file is a shared catalogue referenced by the four
> upstream grooming agents (`reuse-finder`, `business-analyst`, `tech-lead`,
> `plan-reviewer`) so each agent applies the same HF-specific architectural
> discipline without duplicating prose across four files.
>
> When the canonical source is a rule file under `.claude/rules/*.md` or a
> memory file under `~/.claude/projects/-Users-paulwander-projects-HF/memory/`,
> **always read the canonical source first** — this file is the index, not the
> source of truth.
>
> Born 2026-06-21 in response to the #2174 fingerprint (operator had to
> correct a "4-6d bespoke editor work" plan to "~1.5d DATA-first" mid-
> execution because zero upstream agents asked the DATA-first question).

---

## How agents use this file

| Agent | Section to apply | When |
|---|---|---|
| `reuse-finder` | §A "Lattice primitive scan" | Always — every brief |
| `business-analyst` | §B "Generic Lattice classification" | Before quoting any effort estimate |
| `tech-lead` | §C "Anti-pattern audit" | Every tech-lead review |
| `plan-reviewer` | §D "Lattice-respecting plan checklist" | Every plan review |

---

## §A — Lattice primitive scan (for `reuse-finder`)

Before reporting "no existing helper for X", enumerate every Lattice
primitive that might already carry the surface. The Lattice's value
proposition is that infrastructure ships ONCE and extensions are DATA
forever — a brief that misses an existing primitive forces the BA to
propose bespoke code that didn't need to be written.

For ANY requirement touching operator-facing config, scoring, behaviour
tuning, or knob editing, scan these surfaces explicitly:

| Surface | Where to look | What it carries |
|---|---|---|
| **Registry rows** | `apps/admin/lib/journey/setting-contracts.entries.ts` (`JOURNEY_SETTINGS`) + `apps/admin/lib/settings/voice-setting-contracts.ts` (`VOICE_SETTINGS`) | Operator-facing tunable knobs rendered by the generic Inspector |
| **Cascade families** | `apps/admin/lib/cascade/effective-value.ts::FAMILIES` | Knobs that resolve through System → Domain → Course → Segment → Caller → Call |
| **AnalysisSpec files** | `apps/admin/docs-archive/bdd-specs/*.spec.json` | Runtime behaviour driven by spec.json + the generic dispatcher (no bespoke runner needed) |
| **ESLint chokepoints** | `apps/admin/eslint-rules/*.mjs` | IP-boundary / write-pattern guards — extend the constant rather than write a new rule |
| **Coverage tests** | `apps/admin/tests/lib/**/*-coverage.test.ts` | Bidirectional ratchets that pin registry ↔ schema / DB / consumer alignment |
| **Generic transforms** | `apps/admin/lib/prompt/composition/transforms/*.ts` | Compose-side readers that pick up registry settings via `storagePath` |
| **Cascade resolvers** | `apps/admin/lib/cascade/resolvers/*.ts` | Per-family effective-value resolution |
| **Canonical chokepoint helpers** | `lib/measurement/write-call-score.ts`, `lib/voice/create-session.ts`, `lib/privacy/stamp-regulatory-expiry.ts`, `lib/curriculum/resolve-module.ts`, `lib/content-trust/validate-manifest.ts`, etc. | Single-writer surfaces for high-risk DB columns |
| **Generic UI primitives** | `JourneyInspectorPanel`, `CascadeValue`, `LayerBadge`, `RelevanceWrapper`, `journey-setting` PATCH route | The canvas; new knobs render here without a new component |
| **LearnerShellKind variants** | `LearnerShellKind` union | One generic component per shell-kind; per-course config via DATA |

**Brief addition (always present):**

```markdown
### Lattice primitives covering this surface
- Registry rows: [list any JourneySettingContract / VoiceSettingsContract entries that could carry it, OR "none found — gap"]
- Cascade families: [list any FAMILIES entries that apply, OR "none — would need a new family entry"]
- AnalysisSpec slots: [list any existing spec.json that could be extended OR "would need a new spec.json (which the dispatcher will auto-pick-up)"]
- ESLint chokepoints: [list any existing rule whose constant covers the field set, OR "none — but the pattern is constant-list, not rule-per-field"]
- Coverage tests: [list any *-coverage.test.ts that this surface should be added to]
- Canonical chokepoint helpers: [list any single-writer helpers for the DB columns involved]
- Generic UI primitive that would render the new knob: [name it — Inspector, CascadeValue, etc.]
```

A brief that returns only "no helper found" without scanning the above
is incomplete — the BA can't classify the work as DATA vs CODE without
the primitive scan.

---

## §B — Generic Lattice classification (for `business-analyst`)

**Run this BEFORE quoting any effort estimate.** The classification
decides whether the story is hours (DATA on existing Lattice) or days
(genuine new code).

### Step 1 — Six-question DATA-first reframe

Source: [`feedback_data_first_lattice_planning.md`](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_data_first_lattice_planning.md).
Ask each in order:

1. **Is there a `JourneySettingContract` / `VoiceSettingsContract` shape that fits?**
   YES → ROW in the entries file. No new component. The generic Inspector renders it.
2. **Is the cascade-resolved value covered by `lib/cascade/effective-value.ts::FAMILIES`?**
   NO → add an entry. Generic resolver walks System → Domain → Course automatically.
3. **Is there an ESLint chokepoint for the boundary you're enforcing?**
   YES → extend the constant; don't write a new rule.
4. **Is the UI insertion point the Course Pane?**
   Default YES. New windows / modals / pages need explicit justification.
5. **Is LearnerShell selection / configuration declared as DATA on Playbook config?**
   If tempted to write a per-course shell component variant — STOP. One generic per shell-kind; per-course config via data.
6. **Is the runtime behaviour driven by a spec.json under `docs-archive/bdd-specs/`?**
   Author the spec; do not author a bespoke runner. The dispatcher already handles new specs by `outputType` + `category`.

**If steps 1-6 all answer "data fits": estimate as ~95% data edits, ~5% type extensions, ZERO new components/routes/rules.**

If the plan calls for >20% new code, that's a flag — re-survey the
existing Lattice primitives. Almost always there's a primitive that fits.

### Step 2 — Classification verdict

Pin in the story body:

```markdown
## Lattice classification
- DATA-on-existing-Lattice: [N rows / N constant entries / N spec.json files / N type-union extensions]
- Genuinely new code: [list each piece + justify why existing primitive doesn't fit]
- DATA/CODE ratio: [N% data, N% code]
- Estimate basis: [data-rows + type-extensions / hours] OR [new code / days]
```

If "Genuinely new code" is non-empty, the story body's `## Verified by`
section MUST include the Lattice-survey result naming WHICH existing
primitive doesn't fit AND WHY.

### Step 3 — Fingerprints to recognise the miss

When drafting an effort estimate, if the breakdown includes phrases
like:
- "Add a new section to..."
- "New component for editing..."
- "New API route to handle..."
- "New cascade resolver for..."
- "New ESLint rule that enforces..."

→ **STOP. Re-frame.** The Lattice almost certainly has a row-based path. The right phrasing is:
- "Add N rows to <registry>..."
- "Extend the constant with N strings..."
- "Author one spec.json..."
- "Register N entries in FAMILIES..."

If the reframe genuinely doesn't work, document why in the story body —
that's the legitimate escalation path. Default assumption is always: it
works.

### Step 4 — Verify-before-claim-done (story-write side)

Source: [`feedback_verify_before_claim_done.md`](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_verify_before_claim_done.md).

Before writing the story claim "no migration needed" / "no existing
code" / "no consumer wired" / "no test covers this": run the actual
audit (schema query, qmd search, grep). Confidence is not evidence.
Honest enumeration of follow-ons beats false confidence.

---

## §C — Anti-pattern audit (for `tech-lead`)

**Run this on every story being reviewed.** Output a structured "Anti-
pattern audit results" table in the review comment.

For each pattern below: PASS (story respects it) / FLAG (story risks it) / N/A (story doesn't touch this surface).

| # | Pattern | Question | Anti-pattern fingerprint | Source |
|---|---------|----------|-------------------------|--------|
| 1 | **DATA-first reframe** | Did the BA quote effort as data-rows or as components/routes? If components: was the reframe justified? | "4-6d bespoke" when "1.5d DATA-first" applies (#2174) | `feedback_data_first_lattice_planning.md` |
| 2 | **Lattice survey** | Does the story touch a shared DB column / chain-stage boundary / new guard / AI write-or-read path? If yes — has the BA cited the 60-90s survey result? | Three contract risks in one helper (#1703) | `.claude/rules/lattice-survey.md` |
| 3 | **Lattice 5-pillar audit** | If new structural infra: does it ship paired Chain-contract / Guard / Cascade / Rule / Coverage entries? | Slice C 4 PRs claimed "Lattice 4-pillar audit passed" while registry 20 entries short of schema | `feedback_lattice_5th_pillar_coverage.md` |
| 4 | **Producer ↔ consumer pairing** | If story registers a setting with non-empty `composeImpact.sections[]`: does the consuming transform land in the SAME PR? | Setting edited, "✓ Saved", composed prompt byte-identical | `.claude/rules/registry-consumer-coverage.md` |
| 5 | **Cascade reuse (read-side)** | If UI displays a cascade-resolvable value: does it route through `useEffectiveValue` / `resolveEffective` + `<CascadeValue>` + `<LayerBadge>`? | Snapshot read loses provenance | `.claude/rules/cascade-reuse.md` |
| 6 | **AI-to-DB guard (write-side)** | If AI output drives DB writes: is there validate-then-write at the chokepoint? | AI hallucinates 47 subjects, each becomes a row | `.claude/rules/ai-to-db-guard.md` |
| 7 | **AI-read grounding (chat-side)** | If AI returns text mentioning a specific entity: does the system enforce a grounding tool call in the same turn? | DATA mode asserts learner enrolment without `get_caller_detail` | `.claude/rules/ai-read-grounding.md` |
| 8 | **Spec-readonly boundary** | If story writes to `Parameter` from a customer-driven path: does it touch `definition` / `interpretationHigh` / `interpretationLow`? | Customer writes "make AI act crazy" into shared spec | `.claude/rules/spec-readonly-boundary.md` |
| 9 | **Privacy redaction (role-tier)** | If GET route returns PII fields AND admits STUDENT/VIEWER: does it route through `redact<X>ForTier` + `@tieredVisibility` tag? | STUDENT reads operator reasoning text | `.claude/rules/privacy-redaction.md` + `response-redaction.md` |
| 10 | **At-rest encryption** | If story stores PII / secrets in a new column: does it use `encryptColumn` + 4-sibling-columns pattern? | Plaintext API credentials in DB | `.claude/rules/at-rest-encryption.md` |
| 11 | **Data retention (regulatory expiry)** | If story creates a `Call` row: does it route through `stampRegulatoryExpiry`? | Caller data outlives consent window | `.claude/rules/data-retention.md` |
| 12 | **Chain Contracts** | If story crosses a pipeline stage boundary (EXTRACT/AGGREGATE/REWARD/ADAPT/SUPERVISE/COMPOSE): is there a contract row in `docs/CHAIN-CONTRACTS.md`? | Producer / consumer agree verbally not in code | `docs/CHAIN-CONTRACTS.md` |
| 13 | **DB ↔ Registry parity (multi-pillar)** | If column carries values from a canonical set: are all 5 pillars wired (source-coverage + DB-parity + ESLint + Postgres CHECK + Chain row)? | `Parameter.domainGroup` 46% sandbox / 70% staging drift undetected 6 months | `.claude/rules/db-registry-parity.md` |
| 14 | **No hardcoded score backfill** | If story seeds / migrates / fallback-fills `CallerTarget.currentScore` / `CallScore.score`: is the empty-state surfaced honestly? | IELTS fake 0.41-0.45 masked missing LLM-judged scoring path | `feedback_no_hardcoded_score_backfill.md` |
| 15 | **Canonical source — derive don't duplicate** | If story lists option values that exist canonically elsewhere: does it `import + Object.entries(...).map(...)` rather than hand-typing? | `tierPresetId` silent label drift | `feedback_canonical_source_discipline.md` |
| 16 | **Verify before fix** | If story is a fix: does it cite concrete evidence (SQL / log subject / vitest result) of the live failure shape? | PR #1406 fabricated narrative from screenshot OCR | `.claude/rules/verify-before-fix.md` |
| 17 | **Lattice-survey written in `## Verified by`** | Does the story body cite the 60-90s sibling-writer survey result? | "I followed the rule" without naming sibling writers | `.claude/rules/lattice-survey.md` + `verify-before-fix.md` |
| 18 | **CI ⇔ Docs parity** | If story touches CI/CD/infra: does it update operator runbooks in the same PR? | `gcloud sql backups restore` survived 12 months in stale runbook | `.claude/rules/ci-docs-parity.md` |
| 19 | **Wizard enum coverage** | If story adds a new chat-tool field with enum value drawn from union: are all 7 layers wired (SET, guard, merge-path, schema, type, ESLint, vitest)? | `Playbook.config.teachingMode = "directive"` shipped to prod (#1995) | `.claude/rules/wizard-enum-coverage.md` |
| 20 | **AI call-point cascade** | If story makes a new AI call: does it pass `scope: { callId, playbookId, domainId }` when scope is in hand? | Per-course AI override silently ignored, falls back to broken global default | `.claude/rules/ai-callpoint-cascade.md` |

**Review comment output:**

```markdown
### Anti-pattern audit (Tech Lead)

| # | Pattern | Verdict | Note |
|---|---------|---------|------|
| 1 | DATA-first reframe | PASS / FLAG / N/A | [if FLAG: specific risk] |
| 2 | Lattice survey | PASS / FLAG / N/A | ... |
| ... | ... | ... | ... |

**Blockers:** [count of FLAGs that must be resolved before BUILD]
**Recommendation:** READY TO BUILD / NEEDS CLARIFICATION / RE-SURVEY LATTICE / SPIKE FIRST
```

---

## §D — Lattice-respecting plan checklist (for `plan-reviewer`)

Append to existing 3-phase intent check. For any plan that touches HF:

| Check | PASS criteria |
|---|---|
| **DATA-first reframe applied** | Plan classifies work as DATA-on-Lattice OR justifies new code with named missing primitive |
| **Lattice survey cited** | Plan body cites the 60-90s sibling-writer survey result for any shared-column / chain-boundary / new-guard / AI-path change |
| **Generic primitive named** | Plan names the existing component/route/resolver that will render the new knob (not "we'll build a component for...") |
| **5-pillar audit acknowledged** | New structural infra is paired with Chain-contract row + Guard + Cascade + Rule + Coverage test |
| **No hardcoded backfill** | Plan does NOT propose synthetic score defaults for empty CallerTarget / CallScore rows |
| **Canonical source derivation** | Plan does NOT hand-type option values that exist in a canonical const |

---

## Cross-references

### Canonical rule files (read these — this catalogue is the index)

- `.claude/rules/lattice-survey.md` — pre-coding sibling-writer survey
- `.claude/rules/cascade-reuse.md` — read-side cascade primitives
- `.claude/rules/ai-to-db-guard.md` — write-side validate-before-execute
- `.claude/rules/ai-read-grounding.md` — chat-side verify-before-claim
- `.claude/rules/spec-readonly-boundary.md` — HF-canonical IP boundary
- `.claude/rules/privacy-redaction.md` + `response-redaction.md` — role-tier read-side
- `.claude/rules/data-retention.md` — regulatory-expiry stamp-at-write
- `.claude/rules/at-rest-encryption.md` — KMS envelope for new PII columns
- `.claude/rules/registry-consumer-coverage.md` — producer↔consumer pairing
- `.claude/rules/registry-schema-coverage.md` — schema↔registry bidirectional
- `.claude/rules/db-registry-parity.md` — multi-pillar DB column protection
- `.claude/rules/parameter-coverage.md`, `parameter-measurement-coverage.md`, `parameter-loop-closure.md` — parameter coverage chain
- `.claude/rules/aggregate-output-consumer-coverage.md` — AGGREGATE output→reader
- `.claude/rules/route-auth-zod-coverage.md`, `tier-visibility-coverage.md` — route gates
- `.claude/rules/fixture-type-coverage.md`, `arraykey-writer-coverage.md`, `journey-grey-out-coverage.md` — Coverage-pillar siblings
- `.claude/rules/wizard-enum-coverage.md` — 7-layer chat-tool enum discipline
- `.claude/rules/ai-callpoint-cascade.md` — Playbook → Domain → AIConfig cascade
- `.claude/rules/lattice-chain-closure.md` — full-chain walking gate
- `.claude/rules/lattice-self-maintenance.md` — the meta-gate
- `.claude/rules/verify-before-fix.md` — developer-side cite-before-act
- `.claude/rules/agent-report-verification.md` — orchestrator-side inverse-probe
- `.claude/rules/ci-docs-parity.md` — CI surface ⇔ docs
- `.claude/rules/no-bare-spec-identifier.md`, `pipeline-and-prompt.md`, `database-patterns.md`, `api-conventions.md`, `rbac.md`, `ui-design-system.md` — surface-scoped patterns

### Canonical memory files

- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_data_first_lattice_planning.md` — central pattern (this catalogue's origin)
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_lattice_survey_discipline.md` — Lattice umbrella
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_lattice_guard_umbrella.md` — 4-pillar definition
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_lattice_5th_pillar_coverage.md` — Coverage as 5th pillar
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_verify_before_claim_done.md` — pre-claim audit
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_canonical_source_discipline.md` — derive don't duplicate
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md` — honest empty state
- `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_chase_loop_anti_patterns.md` — AP-1..AP-5 recognition

### Canonical contract docs

- `docs/CHAIN-CONTRACTS.md` — cross-stage adaptive-loop invariants
- `docs/CONTRACTS-PLAYBOOK-CURRICULUM.md` — Playbook ↔ Curriculum surface
- `docs/CONTRACTS-JOURNEY.md` — journey-tab contracts
- `docs/lattice-chains.md` — every producer ↔ consumer chain inventoried
- `docs/kb/guard-registry.md` — every active guard

---

## Maintenance

When a new architectural pattern emerges (operator surfaces it,
typically in a `feedback_*.md` memory file + a `.claude/rules/*.md`
rule file):

1. Add a row to §C's anti-pattern audit table.
2. Add the rule + memory file to the cross-references list.
3. If the pattern is owner-specific (BA only, RF only): add to the
   relevant agent section (§A / §B / §D).
4. The agent files don't need a re-edit — they reference this file by
   path and pick up the change.
