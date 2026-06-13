# Attainment tab — SP4-E retirement audit

> Tracks the 3 legacy surfaces that the SP4-A/C/D Attainment tab
> replaces. Sister of `caller-detail-v3.md` (broader Snapshot v3
> retirement) — this audit is **narrower** and **independent**: the
> Attainment tab is already live on `main` (PRs #1580 / #1586 / #1587 /
> #1588) and not gated behind `?v=3`, so retirement can begin as soon as
> coverage is verified.
>
> Part of master epic #1577 → SP4-E.

## Legacy surfaces scheduled for retirement

Each component below has a `// WILL_RETIRE — covered by Attainment
(SP4-A/C/D): see docs/retirement-audit/attainment-sp4e.md` comment at
the top of its module file. When a row is ticked, the next PR removes
both the comment AND the component (and any unused parent that mounted
only it).

- [ ] `components/callers/caller-detail/ProgressTab.tsx` — legacy
  progress view rendered before Progress (v2). Already hidden on the
  default tab bar via `VISIBLE_TABS`; kept for `?tab=what` fall-through.
- [ ] `components/callers/caller-detail/cards/SkillBandStripCard.tsx` —
  per-skill bar strip mounted inside Progress v2's Overview lens.
  Replaced by Attainment's `SkillBandsSection` with the click-to-expand
  evidence trail (which Strip doesn't have).
- [ ] `components/callers/caller-detail/cards/MockResultCard.tsx` —
  mock-exam result card mounted inside Progress v2 + Uplift. The
  Attainment tab branches on `useFreshMastery` for the same data with
  the same colour scheme (cold→hot palette consistent with the rest of
  the tab); this card duplicates that view.

## Retirement preconditions

A row may only be ticked when:

1. The Attainment tab's corresponding section is rendering correctly on
   hf_sandbox **for both structured and CONTINUOUS playbooks**, AND
2. A two-sprint observation window has passed without an operator
   regression report on Slack `#hf-dev` or via the in-app feedback path,
   AND
3. (For `SkillBandStripCard` + `MockResultCard`) the parent component
   that mounts them has been audited — if it's the only consumer, it
   too retires; if shared, only the mount-site is removed.

## Out of scope for this retirement

- `progress-v2` console as a whole — that retirement is tracked under
  `caller-detail-v3.md` (Snapshot v3 absorbs it). SP4-E only retires
  the three components listed above; the rest of Progress v2 stays
  until Snapshot v3 ships.
- Goal section duplication — the AttainmentTab's `GoalsSection`
  (SP4-D) duplicates Progress v2's goal view, but Progress v2's goal
  view also surfaces non-Attainment-shape data (e.g. raw confidence
  intervals) used by the operator-tuning Tune tab. Retire only after
  Tune tab no longer reads from there.

## Process

1. Confirm acceptance criteria above for the row.
2. Open a retirement PR per component that: ticks the box here,
   removes the `WILL_RETIRE` comment, deletes the component file,
   removes any imports + mount sites.
3. Bake on hf-dev for ≥1 day; on staging for ≥3 days; then deploy to
   prod.

## Backstop

If a retirement PR is reverted, restore both the `WILL_RETIRE` comment
AND this audit-doc row's unchecked state in the revert PR.
