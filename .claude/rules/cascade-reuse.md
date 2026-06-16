# Cascade-Reuse Pattern

> Every UI surface that displays a value the cascade resolves MUST route
> through `useEffectiveValue` (client) / `resolveEffective` (server) and
> render via `<CascadeValue>` + `<LayerBadge>`. No parallel chip
> implementations. No snapshot reads of cascade-resolvable values.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (WRITE-side),
> [`ai-read-grounding.md`](./ai-read-grounding.md) (AI-CHAT-side),
> [`response-redaction.md`](./response-redaction.md) (role-tier read-side).
> This is the **cascade-honesty read-side** discipline.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Cascade pillar of HF Lattice.

## Rule: Cascade-eligible values render through the canonical primitives

When a UI surface shows the value of a knob that the cascade can resolve
across layers (System → Domain → Course → Segment → Caller → Call), the
operator must see provenance — the chip that says "from Domain" / "set
on this Course" / "using System default". The data path is mandatory:

```
useEffectiveValue(knobKey, scope) → Effective<T>
  ↓ (or `resolveEffective(...)` on the server)
<CascadeValue envelope={…}>{displayValue(envelope.value)}</CascadeValue>
  ↓
<LayerBadge envelope={…} onInspect={…} />
  ↓
sidebar-aligned icon + tooltip + optional CascadeInspectorTray
```

Reading the value via `resolveValueAtPath(playbookConfig, storagePath)`
or any similar snapshot helper is the **anti-pattern** when the knob has
a registered cascade family. Snapshot reads silently lose:

- Which layer the winning value came from
- Whether the operator is editing the winning layer or an overridden one
- The fallback chain when a layer's value is null
- Provenance metadata (set-by, set-at) the inspector tray surfaces

## When this applies

Any client-side React surface that:

1. Renders a value for educator visibility, AND
2. The value is keyed by a knob registered in
   `lib/cascade/effective-value.ts::FAMILIES` (today: `BEH-*`,
   `welcomeMessage`, `onboarding`, `intake`, `stops`, `offboarding`,
   `voiceProvider`, `voiceId`, `model`, `modelTemp`, `modelTopP`,
   `language`, `identitySpecId`, `skillTierMapping`,
   `skillScoringEmaHalfLifeDays`), AND
3. The surface has access to the scope chain (at minimum `courseId`).

Today: Journey-tab `CascadeTraceBreadcrumb` (#1737), `VoiceConfigSection`,
Skills Framework lenses (`CourseSkillsTab` Cohort/Calibration), the
Cascade Inspector Tray. Candidates for future application: any new
Inspector / configuration panel.

## The fall-back path is explicit

Not every knob has a registered family. Pure course-only fields
(`completionCriteria`, `firstCallMode`), runtime/scoring settings
(`skillScoringEmaHalfLifeDays` did require adding to the family — most
do not), and module-scoped IELTS Theme 1 settings live entirely on
`Playbook.config` / `AuthoredModule.settings` with no Domain/System
ancestor. For these:

- `useEffectiveValue` returns `{ unresolvable: true }` after the route
  responds 400 "Unknown cascade knob key …"
- The consumer falls back to its static / snapshot-read path
- This is structurally fine — there IS no provenance to show

The hook is the gate. Never duplicate the family-match logic on the
client to "pre-filter" — drift between client + server gates is the
exact bug class the centralised dispatch table prevents.

## Pattern: hook-then-render

```tsx
// BAD: snapshot read, no provenance, parallel chip implementation
const value = resolveValueAtPath(playbookConfig, contract.storagePath);
return <div>{contract.label}: {String(value)}</div>;

// GOOD: hook → CascadeValue → LayerBadge
const knobKey = contract.cascadeKnobKey ?? contract.id;
const { envelope, unresolvable } = useEffectiveValue<unknown>(knobKey, {
  courseId: ctx.courseId,
});
if (unresolvable) {
  return <StaticFallback contract={contract} />;
}
if (!envelope) return null;
return (
  <CascadeValue envelope={envelope} knobKey={knobKey}>
    {displayValue(envelope.value)}
  </CascadeValue>
);
```

## Existing implementations

| Surface | Location | Notes |
|---|---|---|
| Journey Inspector cascade chip | `components/journey-tab/CascadeTraceBreadcrumb.tsx` (#1737) | Hook + CascadeValue. Static fallback for unresolvable knobs via `contract.cascadeSources`. |
| Cascade Inspector Tray | `components/cascade/CascadeInspectorTray.tsx` | Renders the full LayerHit chain. Mounted by `<LayerBadge>` `onInspect`. |
| Voice config section | `components/shared/VoiceConfigSection.tsx` | Each voice knob (`voiceProvider`, `voiceId`, etc.) goes through resolveEffective + CascadeValue. |
| Skills Framework Rubric Calibration | `app/x/courses/[courseId]/CourseSkillsTab.tsx` | `skillTierMapping`, `skillScoringEmaHalfLifeDays` chips. |

## When NOT to apply

- The value isn't keyed by a cascade family (course-intrinsic config,
  spec slugs, source ids, etc.) — fall-back path is correct.
- Read-only diagnostic / debug surfaces where provenance overhead would
  obscure the data.
- High-density tables where chips would dominate the layout — pass
  `bare` to `<CascadeValue>` for chip-only rendering, or surface
  provenance only in a row's expansion / drill panel.

## Escalation

If you're writing a new Inspector / Settings surface and can't route
through the hook (e.g., the surface needs a value in a context where
`useEffectiveValue` can't run — non-React rendering, build-time
generation), add a `// TODO(cascade-reuse):` comment explaining why
and what the provenance gap is. Tracked by `broken-windows` and
surfaced by `arch-checker` on changed files.

## Related

- [`docs/decisions/2026-06-10-cascade-honesty-ux.md`](../../docs/decisions/2026-06-10-cascade-honesty-ux.md) — Layer 2 decision; why cascade chips are mandatory
- [`docs/kb/guard-registry.md#guard-cascade-reuse`](../../docs/kb/guard-registry.md) — registry row
- Memory: [feedback_lattice_guard_umbrella.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_lattice_guard_umbrella.md) — Cascade pillar
