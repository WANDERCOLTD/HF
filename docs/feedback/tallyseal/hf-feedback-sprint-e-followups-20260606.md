# HF feedback — three follow-ups after Sprint E LANDED

**Author:** HF (paw2paw)
**Date:** 2026-06-06
**Trigger:** HF began grooming issue #1140 (V6 wizard Phase 2 = admin spec-authoring layer) the day after Sprint E LANDED (#67 merged 2026-06-04). TL schema-verification pass discovered three concrete blockers that prevent the dogfood/reflective architecture HF wants to ship. This doc is the precise feedback so tallyseal can shape Sprint F or a Sprint E follow-on.
**HF mirror:** none yet (this file is the source).
**Authoritative copy when committed:** lands in `tallyseal/docs/notebook/08-design-partner/hf-feedback-sprint-e-followups-20260606.md`.

---

## TL;DR

Three asks, in priority order:

1. **`@tallyseal/crawcus-spec`** — expose `field.json()` (or `.record()` / `.unknown()`) with a Zod-compatible validator callback. Without it, the reflective "L0 MetaSpec describes what a spec is" property collapses; HF must fall back to `field.string()` + post-parse and lose DSL-level invariant coverage on the meta layer.
2. **`@tallyseal/admin-editor` (or sibling)** — extract the editor components (`FieldListEditor`, `INTERNAL_FIELDS_EDITOR`, `ReadinessPredicateBuilder`, `DeployButton`) out of `apps/admin-viewer/` into a publishable npm library. Today they ship inside a Next.js app, which HF cannot consume short of running admin-viewer as a sibling app on a subdomain (long-term operational cost).
3. **`@tallyseal/prisma-adapter`** — add a generic or V6-snapshot variant to the `ProjectionWrite` discriminated union (`dist/index.d.ts:724-742`) so `writeEventWithProjection()` can replace HF's manual same-tx in `lib/wizard-v6/record-field-answered.ts`. Today the union covers only compliance projections (warrant / disclosure / consent / oversight-*), so V6 snapshot writes can't use the helper.

All three were discovered during TL schema-verification pass on #1140 today (filed 2026-06-06). Evidence: file:line citations throughout below.

---

## HF context — why these three, not others

Sprint E shipped the visual IntentSpec editor in 5 PRs in ~24h after HF's PR #57 (`hf-feedback-spec-authoring-ui-20260603.md`). HF tried to adopt immediately for issue #1140 (V6 wizard Phase 2). The intent: admins author CrawcusSpec entries via UI, not TS files. The architectural insight HF wants to preserve: **the designer is itself a CrawcusSpec**. Three layers — L0 MetaSpec (hand-authored seed) → L1 domain specs (CreateCourse, CreateRecipe) → L2 entities (actual courses). Same renderer, same projector, same validation engine at all three.

The blockers below all prevent this reflective property from holding cleanly with the currently-shipped primitives.

---

## Ask 1 — `field.json()` with validator callback

### What's missing today

`@tallyseal/crawcus-spec@0.11.0` `dist/index.d.ts:2655-2668` — the `field` typed-builder exposes `.string()`, `.integer()`, `.boolean()`, `.enum()`, etc. There is no `.json()`, `.record()`, or `.unknown()` method. The L0 MetaSpec needs fields like:

```ts
const MetaSpec = createSpec({
  key: "meta-spec",
  version: "1.0.0",
  fields: {
    specKey:    field.string().required(),
    version:    field.string().required(),
    fields:     field.json().required().validate(FieldDefSchema.array()),    // <- needs .json()
    invariants: field.json().optional().validate(InvariantDefSchema.array()), // <- needs .json()
    readiness:  field.json().required().validate(ReadinessDefSchema),        // <- needs .json()
  },
  contracts: {
    invariants: [
      // these must reach inside the JSON-typed fields:
      { key: "no-duplicate-field-keys",     predicate: (v) => ... },
      { key: "all-requires-resolve",        predicate: (v) => ... },
      { key: "no-circular-requires",        predicate: (v) => ... },
      { key: "readiness-references-real-fields", predicate: (v) => ... },
    ],
  },
});
```

### Proposed shape

```ts
// In @tallyseal/crawcus-spec — additive, no breaking change to existing field builders.
interface FieldBuilders {
  // existing...
  string(): StringFieldBuilder;
  integer(): IntegerFieldBuilder;
  // new:
  json<T = unknown>(): JsonFieldBuilder<T>;
}

interface JsonFieldBuilder<T> {
  required(): JsonFieldBuilder<T>;
  optional(): JsonFieldBuilder<T>;
  validate<U>(schema: { parse: (input: unknown) => U }): JsonFieldBuilder<U>;
  // ReadinessCtx.value<T>(key) already exists; reuse it for cross-field predicates.
}
```

The `validate(schema)` callback accepts any object with a `.parse()` method — works for Zod, valibot, hand-rolled. Tallyseal owes no opinion on which validator library; the contract is structural.

### Workaround if ask is declined / deferred

HF would have to use `field.string().validate((s) => JSON.parse(s) /* throws on invalid */)` and lose:
- IDE type inference on the parsed value
- AI tool-call schema generation (the JSON shape isn't recoverable from a string-typed field)
- DSL-level invariants that reach inside the JSON shape (would have to move to `customReducer` write-boundary)

Acceptable as a temporary workaround; degrades the reflective property to "near-dogfood" (L0 has weaker validation than L1/L2).

### NFR citation

- **NFR D5** — "any third party can verify without contacting Tallyseal". If L0 is a `field.string()` with post-parse, the audit bundle cannot show the meta-spec's invariants were enforced at DSL level — verifier can only see "a string was written and parsed successfully somewhere downstream." That's a weaker proof chain than "field.json().validate(schema) refused the write at the typed-builder boundary."
- **NFR L1** — "doesn't-lie — the bundle cannot be authored to mislead a verifier". Same shape: enforcement at the typed-builder boundary is structurally trustworthy; enforcement in arbitrary post-parse code is not.

---

## Ask 2 — extract editor components from `apps/admin-viewer/` into a library

### What's missing today

Sprint E PRs #64 (TKT-ADMIN-EDITOR-FIELDS), #65 (TKT-ADMIN-EDITOR-READINESS), #67 (TKT-ADMIN-EDITOR-DEPLOY) shipped editor UI inside `apps/admin-viewer/` — a Next.js app. HF cannot `npm install @tallyseal/admin-viewer` because it's a workspace app, not a publishable library.

HF's three options today are all costly:

- **Option A — Iframe / sibling-app integration.** Deploy `apps/admin-viewer/` on a subdomain, HF sidebar deep-links. Cost: second app to operate, separate auth, separate deploy pipeline, two Cloud Run services. Long-term ops debt.
- **Option B — Port components.** Copy the source from `apps/admin-viewer/` into HF directly under MIT. Cost: one-day port, but every tallyseal upstream fix has to be manually re-applied — drift risk identical to v5-system-prompt prose drift HF is escaping.
- **Option C — Wait.** Block #1140 on Sprint F shipping the library.

None of these is good. Option A is operationally heavy, Option B reintroduces the drift property that V6's whole architecture is designed to eliminate, Option C blocks ~50% of #1140 effort that doesn't depend on the editor (DB storage layer + page assembly + seed import).

### Proposed shape

A new publishable package `@tallyseal/admin-editor@0.1.0` (or whatever name fits the existing conventions — `@tallyseal/spec-editor`?):

```
exports:
  FieldListEditor       — the field-list table + add/edit/delete (PR #64)
  ReadinessPredicateBuilder — the predicate template builder (PR #65)
  DeployButton          — the PR-mode flow trigger (PR #67)
  SpecEditorShell       — optional default-layout wrapper (mirrors TallysealAssistantUI pattern)
  type SpecEditorTheme  — CSS variable contract for host-app theming
```

Same pattern as `@tallyseal/react-assistant-ui` — the package exposes components, host app provides routing, auth, and storage. The `data-tallyseal="..."` attribute pattern for CSS theming is already established and works for HF.

Storage adapter contract: components receive a `store` prop typed like:

```ts
interface SpecStore {
  load: (key: string, version?: string) => Promise<CrawcusSpec | null>;
  saveDraft: (spec: CrawcusSpec) => Promise<{ id: string; version: string }>;
  publish: (specId: string) => Promise<{ deployOutcome: SpecDeployOutcome }>;
  list: (filter?: { status?: "DRAFT" | "PUBLISHED" }) => Promise<SpecSummary[]>;
}
```

HF implements `SpecStore` against `crawcus_spec` Prisma table; tallyseal owns the editor UI + the validation calls into `@tallyseal/spec-emitter`.

### Workaround if ask is declined / deferred

HF would port components (Option B above). Costs HF a day, costs tallyseal the upstream-drift property they've been protecting. Worse outcome for both sides.

### NFR citation

- **NFR S** series — data sovereignty. If HF runs `apps/admin-viewer/` as a sibling app, the admin-viewer's auth surface has to bridge into HF's session model. Sovereignty boundary gets fuzzy. A library package keeps the boundary clean: HF owns auth + storage; tallyseal owns rendering + validation.
- **NFR D5** — third-party verification. A vendored library version (semver-pinned in HF's package.json) is independently auditable against tallyseal's published artefact. A copied-and-modified port is not.

---

## Ask 3 — generic ProjectionWrite variant in `@tallyseal/prisma-adapter`

### What's missing today

`@tallyseal/prisma-adapter@0.2.0` `dist/index.d.ts:724-742` — the `ProjectionWrite` discriminated union covers:

- `warrant`
- `disclosure`
- `disclosure-signal`
- `consent`
- `oversight-requirement`
- `oversight-finding`

All compliance-projection kinds. There is no variant for HF's V6 wizard-session snapshot. So `writeEventWithProjection()` (TKT-WRITE-EVENT-WITH-PROJECTION #71) cannot replace HF's manual `begin → appendEventInTx → projectV6Snapshot` chain in `apps/admin/lib/wizard-v6/record-field-answered.ts`.

Note: there's also a version mismatch HF needs to clean up — `package.json` references `@tallyseal/prisma-adapter@0.1.0` tarball but installed package reports `0.2.0`. HF's responsibility to fix; flagging for context.

### Proposed shape

Either:

```ts
// Option (a) — V6-specific variant
type ProjectionWrite =
  | { kind: "warrant", ... }
  | { kind: "disclosure", ... }
  | ...existing variants...
  | { kind: "v6-snapshot", projection: V6SnapshotInput };
```

Or, preferred:

```ts
// Option (b) — generic escape hatch for any host-defined projection
type ProjectionWrite =
  | ...existing compliance variants...
  | { kind: "custom", table: string, write: (tx: Tx) => Promise<unknown> };
```

Option (b) is more flexible — keeps the helper's atomicity guarantee (same tx) without binding the adapter to a growing list of host-app projection kinds. The compliance variants stay first-class so the typed-checker can enforce the compliance-projection contract; the `custom` kind is the escape hatch for HF (and future design partners) with bespoke projection shapes.

### Workaround if ask is declined / deferred

HF keeps the manual same-tx pattern from Phase 1. Costs HF nothing in the short term (the pattern already works and the 3-layer guard — ESLint + projector assertion + DB trigger — is preserved). Costs the broader story: `writeEventWithProjection` becomes a compliance-only helper rather than the canonical atomic-write primitive across all projection kinds.

### NFR citation

- **NFR L1** — "doesn't-lie". The atomicity guarantee of `writeEventWithProjection` is the load-bearing structural property — event and projection land in the same tx or both roll back. HF's manual pattern provides the same guarantee in code, but a single audited adapter helper is structurally stronger than per-host bespoke implementations.

---

## Four-contract pass

### Contract 1 — Primitive coverage (14 CRAWCUS primitives)

| Primitive | Coverage |
|---|---|
| Spec (IntentSpec / CrawcusSpec) | **Ask 1** is about expanding the spec primitive's typed-builder DSL. **Ask 2** is about delivering the editor UI for spec authoring. |
| Event | N/A — no new event kind proposed. |
| Suggestion | N/A — no Suggestion changes. |
| Projection | **Ask 3** is about expanding the ProjectionWrite primitive's kind set. |
| Contract | **Ask 1** affects how cross-field invariants reach into JSON-typed fields. |
| Disclosure | N/A — no Disclosure changes. |
| Consent | N/A — no Consent changes. |
| HumanOversight | N/A — no Oversight changes. |
| Warrant | Trust-triangle "Author" side relies on Warrant primitive — see Contract 2. No primitive-shape changes proposed. |
| Lineage | Lineage-through-SeamHandoff was raised in PR #57 G4; not re-raised here. N/A in this doc. |
| AuditBundle | N/A — no AuditBundle changes. |
| ToolDefinition | N/A — no Items 12/13 follow-up here. |
| ToolCall | N/A. |
| Verifier | **Ask 1's NFR D5 citation** depends on the verifier observing field-builder-level invariants in the audit trail. If Wave-1 verifier (TKT-VERIFIER-1a) is shipping the 8-check evaluator next, the meta-spec invariants ("no-duplicate-field-keys" etc.) become a new check class — flagged for TKT-VERIFIER-1b scope review. See Contract 4. |

### Contract 2 — Trust triangle

| Side | Coverage |
|---|---|
| **Author** | A1: spec author writes L0 MetaSpec in TS once (engineer Warrant); domain specs (L1) authored via UI (admin Warrant via PR-mode flow from #67). A2: editor components are tallyseal-Authored, HF-vendored — Warrant chain is tallyseal release signature → HF semver pin. A3: projection-write authority is the adapter library, owned by tallyseal. |
| **Deploy** | A1: shipped as a minor bump on `@tallyseal/crawcus-spec` (additive). A2: new `@tallyseal/admin-editor` package, semver 0.x. A3: shipped as a minor bump on `@tallyseal/prisma-adapter`. All three deploy via existing tarball-vendor path (`feedback_tarball_pickup_handoff.md`). |
| **Verify** | **A1:** Wave-1 verifier `crawcus-verify` already audits field-builder shape per `tkt-verifier-1a-heads-up-20260603.md`; `.json().validate(schema)` adds one new check ("meta-spec invariants enforced at typed-builder boundary"). Scope grow on TKT-VERIFIER-1b. **A2:** library version pin in HF's package-lock provides offline verification of which editor version produced a given spec authoring event. **A3:** generic ProjectionWrite kind needs a verifier rule that ensures `custom` projections don't bypass attestation requirements — flag for TKT-VERIFIER-1b. |

### Contract 3 — NFR citation

Cited inline above. Summary:

- A1 — NFR D5, NFR L1
- A2 — NFR S series, NFR D5
- A3 — NFR L1

### Contract 4 — In-flight ticket cross-reference

In-flight tickets enumerated from `tallyseal/.changeset/tkt-*` as of 2026-06-06:

| Ticket | Status | Cross-ref impact |
|---|---|---|
| `tkt-write-event-with-projection` (#71) | merged 2026-06-05 | **Ask 3 directly extends.** The ProjectionWrite union must grow either via #71's follow-up or a new ticket. |
| `tkt-prisma-row-to-intent` (#69) | merged | N/A |
| `tkt-prisma-adapter-primitives-10-14` (#68) | merged | N/A — Disclosure/Consent/Warrant projection variants already in. |
| `tkt-prisma-adapter-primitives-10-14-core-reexports` | merged | N/A |
| `tkt-admin-editor-deploy` (#67) | merged 2026-06-04 | **Ask 2 directly extends.** Editor components ship inside `apps/admin-viewer/`; library extraction is the follow-up. |
| `tkt-admin-pr-adapter` (#66) | merged | N/A — already vendorable. |
| `tkt-admin-editor-readiness` (#65) | merged | **Ask 2 directly extends** (same as #67). |
| `tkt-admin-editor-fields` (#64) | merged | **Ask 2 directly extends.** |
| `tkt-admin-emitter-roundtrip` (#63) | merged | A2's `SpecStore` contract relies on spec-emitter for serialization. No primitive change needed; flagging for awareness. |
| `tkt-admin-viewer-1b` (#62) | merged | N/A |
| `tkt-verifier-1a-heads-up-20260603` | in build | **Ask 1's NFR D5 citation depends on this.** Meta-spec invariants need to be in TKT-VERIFIER-1b's check-set. Flag forward-binding: when 1a merges and the heads-up #3 fires per cadence, HF should confirm 1b scope includes `field.json().validate(schema)` enforcement detection. |

No new tickets proposed by HF; each ask routes to an existing ticket's follow-on scope.

---

## Pre-publish checklist (HF → tallyseal feedback)

- [x] Contract 1 (primitive coverage): all 14 CRAWCUS primitives addressed or marked N/A with reason
- [x] Contract 2 (trust triangle): Author + Deploy + Verify all addressed for each of the three asks
- [x] Contract 3 (NFR citation): every ask cites at least one load-bearing NFR
- [x] Contract 4 (in-flight ticket): in-flight tallyseal tickets enumerated; each ask routed to a ticket follow-on
- [x] Addendum section: see below

---

## Addendum 2026-06-06 — gaps recorded during drafting

- **Self-reference paradox.** Asking tallyseal to ship `field.json().validate()` so HF can author the L0 MetaSpec that describes specs (including specs that have `.json()` fields) is the kind of self-referential dependency that tends to surface chicken-and-egg gotchas. Tallyseal should sanity-check that adding `.json()` to the typed-builder doesn't recursively require the MetaSpec to have already been authored. (HF's read: it doesn't — `.json()` is a primitive in the builder, not a spec. But flagging.)
- **Sprint F naming.** This doc uses "Sprint F" loosely. If tallyseal is on a different sprint cadence or these asks belong on a follow-on to Sprint E rather than a new sprint, treat the framing as advisory.
- **Version mismatch in HF.** `@tallyseal/prisma-adapter` is referenced as `@0.1.0` in HF's package.json but installs as `0.2.0`. HF will clean up separately; not a tallyseal action item.
- **Ask 2 priority.** If tallyseal has to pick one of the three, **Ask 2 (library extraction) is the highest leverage.** HF can ship a near-dogfood Phase 2 without `field.json()` (workaround: string + post-parse, weaker but functional). HF cannot ship the editor UI without the components in a vendorable package short of accepting one of the three costly options above. The other two asks are weeks of additive value; the editor library is a hard blocker on the V6 admin authoring UI.

---

## Addendum 2026-06-06 EOD V6++ session — UX nit: editor surface could opt into the host design system

**Trigger.** After PR #1217 (HF Phase 2c) shipped and we ran the first interactive smoke test on `dev.humanfirstfoundation.com/x/intake/specs/CreateCourse@0.1.0`, a fresh admin user added a `tester2` field, then went looking for Save. The primary Save / Deploy actions landed below the fold on a 1440×900 Safari viewport — discovery happened by scroll, not by sight. The flow eventually worked (we have DB evidence — body re-derived from `[placeholder]` to `[placeholder, tester2]`, deploy fired through the modal at `15:45:22.927Z`) but the affordance lagged the action.

**Observation.** HF has a mature in-house design system at `apps/admin/styles/` — `hf-card`, `hf-btn-primary`, `hf-btn-secondary`, `hf-section-title`, `hf-banner`, `hf-badge`, `hf-page-shell`. The HF page wrapper at `app/x/intake/specs/[id]/page.tsx` already uses several (`hf-page-shell`, `hf-card`, `hf-page-title`, `hf-banner`). Inside `<EditorShell>`, however, the styling is admin-editor's own — buttons, banners, fields all carry admin-viewer's defaults. Two consequences:

1. **Visual seam** — the editor frame looks markedly different from the rest of the admin shell that wraps it, so the editor reads as "a different app embedded in our app" rather than a first-class admin surface.
2. **Action discoverability** — Save / Deploy positioning is admin-viewer's choice and isn't tunable from the host.

**Two non-exclusive paths.**

- **(a) Opt-in theme prop.** `<EditorShell theme={{ button: { primary: "hf-btn-primary", secondary: "hf-btn-secondary" }, card: "hf-card", banner: "hf-banner", section: "hf-section-title" }} />` lets each customer hand in their own class tokens. Cheap, additive, doesn't break existing consumers (default to admin-viewer's own classes when prop omitted). HF would adopt immediately.
- **(b) Sticky action footer.** Independently of theming — fix Save / Deploy to the bottom of the editor frame so they're discoverable without scroll regardless of styling. Solves the affordance class even for customers who don't theme.

**Priority.** UX nit, not a contract gap. Both fixes are additive and won't change any externally-observed behaviour beyond visual / affordance polish. Filing here so it's tracked next to the structural asks rather than lost in an issue tracker.

**HF intent.** If tallyseal exposes (a), HF wires the token map in `editor-mount.tsx` (~10 LOC) and we close the visual seam. If only (b) lands, HF gets the discoverability fix for free.

**Out of scope here.** Token semantics (would `hf-btn-primary` ever conflict with admin-editor's own primary-state styling? probably not, but worth a sanity pass). Dark mode parity. Locale-aware label wrapping.
