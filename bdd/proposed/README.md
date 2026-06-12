# Proposed BDD specs — engine QA loops (for discussion)

These feature files describe **proposed** quality-assurance behaviour for the engine. They document QA loops that **do not exist today**. The step definitions are intentionally not implemented, and the files live **outside `bdd/features/`** so CI (`npm run bdd`, which globs `bdd/features/**`) does not execute them.

They came out of a gap analysis of the IELTS Speaking **assessment** flow, which surfaced two engine-level gaps. In both cases the engine has solid *structural/mechanical* validation, but no *semantic* check that the output reflects what was intended or what was measured. The consistent pattern is **"propose → validate structure → write"**, with no fidelity gate.

## Gap 1 — Course-configuration fidelity (`qa-loops/course_config_fidelity_qa.feature`)

When a course configuration is generated from a creator's intent (a course-reference), the only gate before publish is structural (item counts, duplicate IDs, ordering, active specs, placeholder shape — `apps/admin/app/api/playbooks/[playbookId]/publish/route.ts`). The projection itself is a pure parser (`apps/admin/lib/wizard/project-course-reference.ts`, "No AI, no side effects"). Nothing checks that every intended parameter/goal is represented, that goals are coherent with the criteria, or that the configuration matches the source — and nothing flags drift, omission, or hallucination.

## Gap 2 — Prompt-composition fidelity (`qa-loops/prompt_composition_fidelity_qa.feature`)

The bootstrap prompt ("prompt 0") and each post-session prompt ("prompt n+1") are composed deterministically, templating in the config and the session's measurements and trusting them. Mechanical invariants run (`apps/admin/lib/prompt/composition/compose-invariants.ts`) and SUPERVISE clamps numeric targets (`docs/PIPELINE.md` notes SUPERVISE does **not** do drift detection), but nothing checks that prompt 0 reflects the configuration, or that prompt n+1 reflects the configuration **and** the session's measurements. The one AI prompt critic (`apps/admin/app/api/callers/[callerId]/eval-prompt/route.ts`) is operator-triggered, config- and measurement-blind, and its result is stored but never used to gate anything — `ComposedPrompt` is written `status: "active"` immediately.

## Why these might be closeable with existing machinery

- The "**propose → guard → write**" pattern already exists throughout; a fidelity guard would slot into the same shape.
- A **confidence < 0.8 → review-queue** mechanism already exists for LO classification (`apps/admin/lib/content-trust/validate-lo-classification.ts`) — an analogous gate could route low-fidelity config/prompts to review.
- An AI prompt critic already exists (`eval-prompt`); the gap is that it is out-of-loop and config-blind, not that it is missing.
- A **projection-vs-snapshot drift cron** is already noted as a Phase-2 design item (`docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md`).

These files are a starting point for a decision on whether to add these loops and how.
