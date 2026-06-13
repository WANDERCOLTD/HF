# Caller Detail v3 — retirement audit

> Tracks the 8 legacy Caller Detail tabs that will retire once the
> `Snapshot (beta)` tab introduced by S5 of #1555 (under master epic
> #1577) reaches parity. Source of truth for the `WILL_RETIRE` code
> comments scattered through `apps/admin/components/callers/CallerDetailPage.tsx`.

**Activated by:** `NEXT_PUBLIC_SNAPSHOT_V3_ENABLED=true` env-flag +
`?v=3` URL parameter. Either alone is a no-op; together they reveal the
beta tab. The legacy tabs continue to render unchanged until each row
below is ticked and the corresponding follow-on PR deletes the legacy
render block.

## Legacy tabs scheduled for retirement

Each tab below has a `// WILL_RETIRE — covered by Snapshot v3: see
docs/retirement-audit/caller-detail-v3.md` comment immediately above
its render branch in `CallerDetailPage.tsx`. When the tick is added
here, the next PR removes the comment AND the render branch in the
same commit, then drops the `validTabs` + `tabRedirects` entries.

- [ ] `overview` — v1 Overview (already hidden via `VISIBLE_TABS`; kept for `tab=overview` URL fall-through)
- [ ] `overview-v2` — current Overview tab (`OverviewV2Tab`); GuideLens + per-domain panels
- [ ] `uplift` — v1 Uplift (already hidden via `VISIBLE_TABS`)
- [ ] `progress-v2` — current Progress tab (`ProgressV2Tab` console)
- [ ] `calls-prompts` — Calls + Prompts history
- [ ] `how` — Profile (memories + traits + personality + template-variable inspector)
- [ ] `what` — v1 Progress (already hidden via `VISIBLE_TABS`)
- [ ] `artifacts` — Artifacts + Actions history

## Out of scope for this retirement (kept indefinitely)

These tabs are NOT scheduled for retirement — they serve flows that
won't fold into Snapshot v3:

- `tune` — operator tuning surface, distinct intent
- `session-flow` — per-session flow editor, distinct intent
- `ai-call` — live AI call surface, action tab not a view
- `attainment` (SP4-A) — new beta tab, **replacement** for parts of
  `progress-v2`; will absorb that retirement when SP4-E ticks
  `progress-v2` here. Tracked separately under SP4-E.
- `adaptations` (SP5-A) — new beta tab, **replacement** for parts of
  `tune`'s adaptation sections; tracked separately under SP5-E.
- `uplift-v2` — current Uplift report; may retire or merge with
  Snapshot v3 at the follow-on epic's discretion (out of S5 scope).

## Per-tab retirement preconditions

A row can only be ticked when:

1. The Snapshot v3 surface renders an equivalent (or better) coverage
   of the tab's data envelope, AND
2. Any deep-link (`?tab=<id>` or `?view=<id>`) has either been removed
   from outbound links in the codebase OR has a `tabRedirects` entry
   pointing at the Snapshot v3 surface, AND
3. A two-sprint observation window has passed on the operator analytics
   without a regression report.

## Process

1. Snapshot v3 content lands (Renderers v2 epic + follow-on stories).
2. Open a retirement PR per tab that: ticks the box here, removes the
   `WILL_RETIRE` comment, removes the render branch, adds a
   `tabRedirects` entry, deletes the tab's now-orphaned component file
   if no other surface mounts it.
3. Bake on staging for ≥3 days; then deploy to prod.

## Backstop

If a retirement PR is reverted, restore both the `WILL_RETIRE` comment
AND the audit-doc unchecked state in the revert PR. Audit drift is
worse than no audit — `arch-checker` will flag a `WILL_RETIRE` comment
without a matching doc row, and vice versa.
