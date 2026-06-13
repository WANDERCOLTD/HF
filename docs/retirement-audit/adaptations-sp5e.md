# Adaptations tab — SP5-E retirement audit

> Tracks the surfaces that the SP5-A/B/C/D Adaptations tab replaces.
> Sister of `attainment-sp4e.md`. Part of master epic #1577 → SP5-E.
>
> The Adaptations tab is already live on `main` (PRs #1589 / #1590 /
> #1591 / #1592) and not gated behind `?v=3`. Retirement begins when
> coverage parity is verified.

## Legacy surfaces scheduled for retirement

Each component below has a `// WILL_RETIRE — covered by Adaptations
(SP5-A/B/C/D): see docs/retirement-audit/adaptations-sp5e.md` comment
at the top of its module file. When a row is ticked, the retirement
PR removes both the comment AND the component.

- [ ] `components/callers/caller-detail/caller-detail-v2/lenses/AdaptationLens.tsx`
  — current per-learner adaptation lens inside the Progress v2 console.
  The new Adaptations tab subsumes its content with: (a) cascade chips
  on per-parameter overrides (SP5-B), (b) timeline of REWARD-stage
  rationale (SP5-C), (c) next-call preview (SP5-D). The lens has no
  unique capability the tab doesn't carry.

- [ ] `Tune` tab adaptation section(s) — the Tune tab currently
  surfaces "engine adjustments to date" inline among its tuning
  controls. The Adaptations tab is the single place for this; Tune
  retains pure tuning controls only.
  - File audit pending — Tune is a large surface and the adaptation
    section is fused with tuning UI; the retirement PR for this row
    must be careful to isolate display-only adaptation rendering from
    the editable tuning controls.

## Retirement preconditions

A row may only be ticked when:

1. The Adaptations tab's corresponding section is rendering correctly on
   hf_sandbox for: (a) a caller with no CallerTarget overrides, (b) a
   caller with PLAYBOOK-scope overrides, (c) a caller with CALLER-scope
   overrides + RewardScore history, AND
2. The "Why" timeline (SP5-C) has been verified to surface at least one
   live RewardScore.targetUpdatesApplied entry per call attempted in
   the test cohort, AND
3. The "Next call" preview (SP5-D) matches what the AI actually receives
   when the next prompt is composed (spot-check against a freshly
   composed prompt in `/x/callers/<id>?tab=calls-prompts`), AND
4. Two-sprint observation window passed without regression report.

## Out of scope

- `tune` tab itself — Tune is NOT scheduled for retirement; only the
  adaptation **display** within it. Tune retains all writable tuning
  controls.
- Cascade chip details — the Adaptations tab surfaces System / Playbook
  / Caller scope as a chip; the deeper `CascadeInspectorTray` opened
  from the chip belongs to the cascade-lens family, not this audit.

## Process

Same as `attainment-sp4e.md`.

## Backstop

If a retirement PR is reverted, restore both the `WILL_RETIRE` comment
AND this audit-doc row's unchecked state in the revert PR.
