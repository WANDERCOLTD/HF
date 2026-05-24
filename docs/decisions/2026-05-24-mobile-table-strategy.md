# Mobile responsive strategy for admin tables (Tier 2 of #753)

**Date**: 2026-05-24
**Status**: Proposed — not yet implemented per-route
**Context**: Issue #753 (Tier 1 shipped), follow-up to phone observation that as ADMIN the user couldn't reach version/env on iPhone.

## Decision

For the 60+ admin routes under `app/x/**` that render raw `<table>`/`<thead>`/`<tbody>` markup, adopt **two complementary patterns** based on table complexity:

| Pattern | When | Example today |
|---------|------|---------------|
| **Parallel `mobile-page.tsx`** | Route's mobile UX is fundamentally different (different actions, different IA, list-of-cards instead of grid) | `app/x/callers/mobile-page.tsx` (already shipped) |
| **`<ResponsiveTable>` wrapper** | Table is "the same data, smaller viewport" — collapse columns ≥ a priority threshold, stack labels above values below 768px | New component to build; first use on `/x/specs`, `/x/domains`, `/x/courses` index |

The **default** for new admin routes is `<ResponsiveTable>` — parallel pages only when the mobile UX genuinely diverges.

## Why two patterns

A single pattern fails:

- **Parallel `mobile-page.tsx` for everything**: doubles maintenance per route. The callers pattern works because callers have a fundamentally different mobile shape (card view vs grid). Forcing it on every table-heavy route doubles file count without product justification.
- **`<ResponsiveTable>` for everything**: works for tabular data but breaks when mobile needs entirely different IA (e.g. callers mobile has a "compose call" CTA at top; the desktop callers page doesn't).

Two patterns let each route pick the right tool. The wrapper handles the boring 80% (just collapse columns); parallel pages handle the 20% where mobile UX is its own thing.

## What `<ResponsiveTable>` looks like (sketch)

```tsx
<ResponsiveTable
  columns={[
    { key: 'name', label: 'Name', priority: 'always' },
    { key: 'role', label: 'Role', priority: 'always' },
    { key: 'lastSeen', label: 'Last seen', priority: 'wide' },     // hidden < 1024px
    { key: 'actions', label: '', priority: 'always', align: 'right' },
  ]}
  rows={users.map(u => ({
    key: u.id,
    cells: { name: u.name, role: <RoleChip role={u.role} />, ... }
  }))}
  mobileLayout="card"  // < 768px: each row becomes a card with key:value pairs
  mobileTitleKey="name"
/>
```

Three breakpoints map to three priorities:
- `always` — visible at every viewport
- `tablet` — hidden below 768px
- `wide` — hidden below 1024px

Below 768px, the table becomes a stack of cards (one per row). Each card shows `always` columns as labelled key/value pairs, with the title column elevated to the card heading.

## Migration plan (post-decision)

1. **Build `<ResponsiveTable>`** as a single PR (~4–6h)
   - Component + tests + Storybook example + UI design rule entry
2. **First 3 routes** (highest traffic): `/x/specs`, `/x/domains`, `/x/courses` index — one PR per route (~1h each)
3. **Iterate** through the remaining ~12 raw-table routes as bandwidth allows
4. **Educators mobile-page-ify** any route where mobile UX justifiably diverges (e.g. `/x/feedback` if/when tickets become primarily mobile-managed)

Each PR is independently shippable. No big-bang refactor.

## Alternatives considered

- **Tailwind responsive-only**: hide columns with `lg:hidden` etc. Rejected — works for hiding, breaks for "transform to cards" which is what's needed below 768px.
- **CSS grid with auto-fit**: nice for cards in general but tables-as-cards needs explicit key/value labelling that auto-fit can't infer.
- **Third-party libs (TanStack Table responsive, etc.)**: heavy for our use. Our tables are mostly read-only display; no need for the full TanStack feature set.

## Risks + mitigation

- **Pattern proliferation**: someone builds a third pattern for a one-off. Mitigation: this ADR + UI design rule entry naming the two sanctioned patterns; PR reviewers reject ad-hoc third patterns.
- **`<ResponsiveTable>` API stagnation**: features get added one at a time for each new route's needs. Mitigation: keep the surface area minimal (no kitchen-sink); add per-route customisation only when 2+ routes need it.
- **Migration drags**: 12+ routes is a lot. Mitigation: Tier 2 isn't market-test-blocking (Tier 1 already gives admin access to version/env on mobile). Migrate routes as their UX feedback warrants.

## Out of scope

- Form responsiveness — separate concern, separate component (`<ResponsiveForm>` if needed)
- Wizard flow mobile UX — V5 wizard is already conversational, no tables to refactor
- Learner-facing surfaces (`/learn/*`) — already mobile-first; not part of this ADR

## Related

- Issue #753 (Tier 1 shipped — avatar + UserContextMenu on mobile header)
- Hook: `apps/admin/hooks/useResponsive.ts`
- Reference: `apps/admin/app/x/callers/mobile-page.tsx` (parallel pattern, in use)
