# No course-specific MEASURE query — spec-driven dispatch

> Pipeline / measurement / spec-dispatch code MUST NOT couple to
> product-specific spec naming. Prisma filters like
> `{ slug: { startsWith: "IELTS-MEASURE-" } }` and string-method
> dispatch like `spec.slug.startsWith("IELTS-MEASURE-")` are
> structurally banned inside `app/api/calls/`, `lib/pipeline/`, and
> `lib/measurement/`. The architectural pattern is
> [spec-driven dispatch](../../docs/CHAIN-CONTRACTS.md) — query by
> `outputType` / `specRole` / a spec config opt-in flag, so any new
> course (TOEFL, CEFR, CIO/CTO Speaking, KS2-SATs) adopting MEASURE
> specs auto-routes without a code change.
>
> Sibling to [`spec-readonly-boundary.md`](./spec-readonly-boundary.md)
> (HF-canonical parameter semantics — write-side IP boundary),
> [`ai-callpoint-cascade.md`](./ai-callpoint-cascade.md) (per-call-point
> AI-config cascade — same "no hardcoded model id" discipline applied
> to AI-config, not spec dispatch), and the existing
> `hf-config/no-hardcoded-spec-slug` rule (which covers comparison
> literals; this rule covers **filter literals** — complementary
> surface). Part of the Guards pillar of the Lattice.
>
> Story: [#2183](https://github.com/WANDERCOLTD/HF/issues/2183) (audit
> follow-on from epic #2176 S8 — NO HARDCODINGS).

## Rule

When you write or modify code under `apps/admin/app/api/calls/`,
`apps/admin/app/api/pipeline/`, `apps/admin/app/api/score/`,
`apps/admin/lib/pipeline/`, or `apps/admin/lib/measurement/`:

1. **Do not embed product-name prefix literals** (shape `[A-Z]{3,}[-_]`)
   in `startsWith` / `endsWith` / `contains` clauses — either Prisma
   filter values OR String.prototype method arguments.
2. Use one of these course-agnostic patterns:
   - **Prefer** — query by structural fields the spec catalogue carries
     for the purpose: `outputType`, `specRole`, `scope`, or an opt-in
     config flag on `AnalysisSpec.config` (e.g. the existing
     `requiresBehaviorTargetParams: true` used by
     `filterByBehaviorTargetParams`).
   - **Acceptable** — lift the prefix to a named constant declared at
     module level (e.g. `LLM_IELTS_MEASURE_SLUG_PREFIX = "IELTS-MEASURE-"`)
     so the literal lives in one place and future course-agnostic
     refactors have a single point to retire. The rule's CallExpression
     visitor matches Literal arguments only — a constant-reference call
     passes structurally.
   - **Last resort** — add the per-site escape comment
     `// hf-pipeline-disable-next-line no-course-specific-measure-query: <reason>`
     on the line above, and document the deferred refactor target. Use
     only when the rule's per-site assumption breaks (e.g. heavy refactor
     is queued in a separate epic).
3. **If a course-tunable prefix is genuinely needed across multiple
   sites**, add a getter to `lib/config.ts::config.specs.*` (e.g.
   `config.specs.ieltsMeasurePrefix`) so it becomes env-overridable and
   the surface stays NO-HARDCODINGS-clean.

## Why

The 2026-06-21 audit (epic #2176 / story #2181) found exactly one
HIGH-severity course-name leak surviving in the pipeline dispatch
layer: a per-Playbook kill-switch override (`config.aiMeasurement.disableLlmIeltsScoring`)
checking `spec.slug.startsWith("IELTS-MEASURE-")` to scope itself to
the LLM-IELTS scoring family (#2158).

The leak is a partner-blocker: any non-IELTS course adopting LLM
measurement (TOEFL Speaking, CEFR oral, CIO/CTO Standard Speaking)
would silently ship with the kill-switch unable to scope to its specs,
because the prefix is hardcoded. Per the operator's NO HARDCODINGS
principle, the structural fix is to **make the dispatch course-agnostic
at the spec-catalogue level** — each spec self-declares its dispatch
intent via `outputType` (already wired), `specRole` (already wired),
and `config.requiresBehaviorTargetParams` (wired by #2137).

The kill-switch's prefix-coupling is the last structural exception. The
short-term fix (this PR) hoists the literal to a named constant so the
rule passes structurally; the medium-term fix (deferred to a follow-on)
replaces the slug-prefix check with a spec-config opt-in
(`cfg.disableViaPlaybookConfigKey: "aiMeasurement.X"`) so the kill-switch
becomes fully course-agnostic.

## How matching works

The rule walks every `Property` and `CallExpression` in guarded files:

| AST shape | Rule fires? | Example |
|---|---|---|
| `{ startsWith: "IELTS-" }` Property | YES — `prismaFilter` | Prisma `where` clause filter |
| `{ contains: "TOEFL-" }` Property | YES — `prismaFilter` | Same |
| `{ endsWith: "CEFR-MEASURE" }` Property | YES — `prismaFilter` | Same |
| `s.startsWith("IELTS-")` CallExpression | YES — `stringMethod` | String dispatch |
| `s.includes("CEFR-")` CallExpression | YES — `stringMethod` | Same |
| `s.startsWith(config.specs.foo)` CallExpression | NO | Argument is Identifier, not Literal |
| `s.startsWith(CONST)` where `CONST` is module-level | NO | Same |
| `{ startsWith: "ielts-" }` Property | NO | Lowercase fails `[A-Z]{3,}[-_]` |
| `{ startsWith: "KS-" }` Property | NO | Two-letter prefix fails shape |

## Guarded surfaces

| Path fragment | Why |
|---|---|
| `/app/api/calls/` | Pipeline route — where the original story-cited fingerprint lived (line 915 pre-#2137) |
| `/app/api/pipeline/` | Future pipeline-trigger routes (currently empty; reserved) |
| `/app/api/score/` | Future score-write routes (currently empty; reserved) |
| `/lib/pipeline/` | Spec loading + filtering helpers (specs-loader.ts, aggregate-runner.ts, etc.) |
| `/lib/measurement/` | CallScore writers + measurement-spec consumers |

## When NOT to apply

- `lib/config.ts` — env-overridable prefix constants legitimately live
  here (allow-listed).
- `prisma/seed*.ts` / `prisma/migrations/**` — seed data is allowed to
  carry literal slugs.
- All `.test.ts` / `.test.tsx` / `.spec.ts` files — fixtures.
- `_archived/**`.
- Files outside the guarded path-set — e.g. `lib/curriculum/` slug
  resolvers and `lib/voice/` provider-name handlers legitimately handle
  product names as data and are NOT spec-dispatch surfaces.

## When adding a new spec-dispatch site

Author checklist (same PR):

1. Decide the dispatch dimension:
   - **Stage / output kind** → use `outputType` (`MEASURE`, `LEARN`,
     `AGGREGATE`, ...).
   - **Spec role / persona** → use `specRole` (`EXTRACT`, `IDENTITY`,
     `CONSTRAIN`, ...).
   - **Scope** → use `scope` (`SYSTEM` / `DOMAIN` / `PLAYBOOK`).
   - **Course-specific behaviour** → add a boolean / string flag to
     `AnalysisSpec.config` (e.g. `requiresBehaviorTargetParams: true` or
     `disableViaPlaybookConfigKey: "aiMeasurement.X"`).
2. Query / filter by that dimension. Never by `slug.startsWith(...)`.
3. If a course-tunable prefix is genuinely needed across multiple
   sites, add a getter to `config.specs.*` so it's env-overridable.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `eslint-rules/no-course-specific-measure-query.mjs` (born 2026-06-20, this PR) | Edit-time, error severity from day 1 | New `IELTS-` / `TOEFL-` / `CEFR-` / `CIO_` literals re-entering the spec-dispatch surface via Prisma filters or String methods |
| `tests/eslint-rules/no-course-specific-measure-query.test.ts` (this PR) | RuleTester behavioural pin | Future refactor weakening the rule's pattern detection |
| `eslint-rules/no-hardcoded-spec-slug.mjs` (#1539 audit HF-I) | Sibling rule | Hardcoded spec-slug literals (e.g. `"PIPELINE-001"`) in comparison contexts. Complementary surface — this rule covers filter / dispatch literals; that rule covers comparison literals. |
| `docs/CHAIN-CONTRACTS.md` | Architectural source | Spec-driven dispatch pattern (outputType / specRole / config opt-in) |
| `lib/pipeline/specs-loader.ts::filterByBehaviorTargetParams` (#2137) | Runtime | Reference implementation of opt-in dispatch — specs declare `config.requiresBehaviorTargetParams: true` instead of being slug-matched |

## When the layers disagree (debugging)

| Symptom | Likely cause | Where to look |
|---|---|---|
| Lint fires on a legitimate prefix constant | The literal is inline at the call-site; lift to a module-level `const` | Refactor; rule's CallExpression visitor only matches Literal arguments |
| Lint fires inside a per-site escape comment that exists | Escape syntax wrong (must contain `no-course-specific-measure-query`) | `eslint-rules/no-course-specific-measure-query.mjs::ESCAPE_PATTERN` |
| Lint doesn't fire on a real leak | The file isn't in `GUARDED_PATH_FRAGMENTS` | Add the path to the rule OR move the leak inside the guarded surface |
| Course-specific dispatch is required by a partner | Add a `config.specs.<prefix>Prefix` getter + use the identifier reference | `lib/config.ts` + the rule passes structurally |

## Related

- [`eslint-rules/no-course-specific-measure-query.mjs`](../../apps/admin/eslint-rules/no-course-specific-measure-query.mjs) — the rule
- [`tests/eslint-rules/no-course-specific-measure-query.test.ts`](../../apps/admin/tests/eslint-rules/no-course-specific-measure-query.test.ts) — the behavioural test
- [`lib/pipeline/specs-loader.ts`](../../apps/admin/lib/pipeline/specs-loader.ts) — the refactored kill-switch (`LLM_IELTS_MEASURE_SLUG_PREFIX` module constant)
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) — spec-driven dispatch pattern
- [`.claude/rules/spec-readonly-boundary.md`](./spec-readonly-boundary.md) — sibling write-side IP boundary
- [`.claude/rules/ai-callpoint-cascade.md`](./ai-callpoint-cascade.md) — sibling NO-HARDCODINGS pattern (AI-config cascade)
- Story [#2183](https://github.com/WANDERCOLTD/HF/issues/2183)
- Sibling stories: #2181 (epic #2176 S8 — NO HARDCODINGS parent sweep), #2182 (no-bare-spec-identifier rule), #2184 (course-name leak in chat tool-handler)
