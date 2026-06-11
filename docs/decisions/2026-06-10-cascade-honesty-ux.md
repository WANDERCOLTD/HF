# 2026-06-10 — Cascade-honesty UX for the operator

**Status:** DECIDED — Paul (operator #1) signed off on 2026-06-10 against research-backed strawman. One sanity-check operator interview still wanted before merging the first Layer 2 PR; design will not block on it. This is the design contract for `lib/cascade/` (Epic #1442 Layer 2).

**Epic:** [#1442 — Operator-Truthful Demo System](https://github.com/WANDERCOLTD/HF/issues/1442)

**Source:** Handoff brief at `memory/handoff-epic-1442-operator-truthful-demos.md` §4 Sprint 1.

---

## 1. Problem

HF config cascades through **6 layers**: SYSTEM → DOMAIN → PLAYBOOK → SEGMENT → CALLER → CALL. Some knobs (e.g. `BEH-RESPONSE-LEN`, `welcomeMessage`, voice config) can be set at any layer, and the lower layer wins.

Today the operator sees only the surface they happen to be editing. Two consequences, both observed in the source session:

1. **Silent inheritance** — editor opens First-call Targets panel, sees "No overrides set", **assumes nothing is configured**, and gets surprised when the next call uses a Playbook-scope `BehaviorTarget` row that's been there for weeks (#1417).
2. **Misleading fallback copy** — Preview lens shows "Using INIT-001 defaults" when in fact onboarding has been explicitly disabled at the Playbook layer; the same copy fires for "explicitly empty" and "never configured" (#1418).

Net effect: **the operator can't trust what they see.** That is fatal for the demo product — a demo runner needs to know what the AI will say *next call*, with no debugger spelunking.

Layer 2 of Epic #1442 fixes this with a single `lib/cascade/` primitive plus three visible surfaces: a **badge**, an **inspector**, and a **scope-aware write affordance**.

---

## 2. Prior art (researched 2026-06-10)

| Tool | What it does | Lesson we take | Lesson we leave |
|---|---|---|---|
| **Chrome DevTools Styles + Computed** | 3 resting-state cues: strikethrough (overridden), pale + info icon (inactive), warning icon (invalid). Click jumps from effective → source. No origin-letter badge — list position carries the meaning. | Resting-state cue + click-to-trace. Indicator IS the affordance. | List-position-as-origin doesn't transfer — our 6 layers don't sit in one column. |
| **Unity Prefab Overrides** | Bold property + blue margin line + ± component badges at rest. Revert via right-click or Overrides dropdown. Documented sharp edge: "Apply at the wrong level overwrites overrides" (nested-prefab redesign). | Origin-discriminating cues at rest. The "wrong-level" failure mode forces explicit CTA-label change when an override already exists. | Right-click revert is hostile to non-developers — we surface revert as a primary button. |
| **Unreal Engine details panel** | Yellow "reset to default" arrow appears only when value differs from blueprint default. Indicator and revert affordance are the same widget. | Affordance-doubles-as-indicator. | Documented bug: arrow disappears with scroll → don't put cues in scroll-clipped columns. |
| **Figma variables + Tokens Studio** | Figma: hover-only resolved value (silently regressed once — forum thread). Tokens Studio: raw + resolved side-by-side at rest; icons reserved for negative states (broken, None). | Tokens Studio: redundant resting-state signal. | Figma: hover-only is fragile — single bug invisibles the chain. |
| **AWS IAM Policy Simulator / GCP Policy Troubleshooter** | Separate inspector surface (not inline). AWS jumps to the matching statement; GCP walks org→folder→project. | At ≥3 layers + ≥10 fields, give up on inline and ship a dedicated viewer. Matches our 6×20 regime. | Both are debugger-first — too cold-blooded for a demo operator. We borrow the inspector model and warm the entry point. |
| **Salesforce User Access Policies / Combined Security Report** | Green = contributed, red = didn't. Origin via info-icon click, not in the row. | Colour-coded resting state for contribution status. | Hiding origin behind icon-click is exactly what the SharePoint failure mode (below) warns against. |
| **SharePoint permission inheritance (anti-pattern)** | Documented dominant failure: silent inheritance breaks, admin can't predict effect, audit becomes impossible. | **Under-disclosure causes more incidents than over-disclosure.** This is the #1417 bug class verbatim. | n/a — pure cautionary tale. |
| **Vercel / Stripe Connect platform settings** | Flat env-vars / single-account overrides — no chain UI to learn from. | n/a | n/a |

**The convergence:** at this scale + this audience, the consensus pattern is *informative resting-state cue + click-to-open dedicated inspector tray + explicit scope picker at write time + label-changes-when-override-exists CTA*. No SaaS we surveyed nails all four — Chrome and Unity get the first three but assume developer audiences. We're combining established patterns for a non-developer operator.

---

## 3. Design — three surfaces backed by one primitive

### 3.1 The primitive — `resolveEffective`

```ts
// lib/cascade/effective-value.ts
type Layer = "SYSTEM" | "DOMAIN" | "PLAYBOOK" | "SEGMENT" | "CALLER" | "CALL";

type LayerHit = {
  layer: Layer;
  scopeId: string | null;    // playbookId, callerId, etc. — null for SYSTEM
  scopeLabel: string;        // "OCEAN (Big Five)" / "Smoke Test 32e36" / "System default"
  value: unknown;
  setAt: Date;
  setBy: string | null;      // userId, or "system" for defaults
};

type Effective<T> = {
  value: T;
  source: Layer;             // the winner
  layers: LayerHit[];        // every layer that has a value, ordered SYSTEM → CALL
  isInherited: boolean;      // true if source is above the operator's current scope
  recommendedLayerForEdit: Layer; // where the cascade-aware UI will write on Save
};
```

Resolvers live under `lib/cascade/resolvers/` — one per knob family (behavior-target, voice-config, session-flow, welcome-message, identity-spec). Each calls into existing helpers (`mergeTargets`, `resolveVoiceConfig`, `resolveSessionFlow`) — **this is a UX layer over existing cascades, not a re-implementation.**

### 3.2 Surface 1 — `<LayerBadge>` (the badge)

A 16px chip rendered next to **every cascade-eligible field** plus a faint inline subtitle naming the origin. Click chip → opens inspector sidetray. Hover chip → tooltip with full provenance line.

```
┌──────────────────────────────────────────────────────────────────┐
│ Response length         [PB]  ●━━━━━━━━━━●━━━━━━━━━━━━●   0.2    │
│   set on this Playbook                                           │
│                                                                  │
│ Concision target        [—]   ●━━━━━●━━━━━━━━━━━━━━━━━●   0.5    │
│   (no override — using System default)                           │
│                                                                  │
│ Warmth                  [DOM] ●━━━━━━━━━━━━●━━━━━━━━━━━●   0.6    │
│   inherited from Education domain                                │
└──────────────────────────────────────────────────────────────────┘
                          ▲
                          │
                  ┌───────┴────────────────────────────────┐
                  │ Badge vocabulary (4 tokens only):      │
                  │   [—]   no override anywhere — using   │
                  │         System default. Greyed out.    │
                  │   [PB]  set at this Playbook (winner)  │
                  │   [DOM] inherited from Domain          │
                  │   [SYS] explicit System override       │
                  │         (rare — ADMIN+ only)           │
                  │   [CAL] caller-scope override (rare)   │
                  └────────────────────────────────────────┘
```

**Why this resting state:**
- **Badge on every cascade-eligible field, not only "active" ones.** Research convergence: under-disclosure (SharePoint failure mode = our #1417 bug) causes more incidents than over-disclosure. The `[—]` chip is rendered in muted weight so quiet fields don't dominate, but the operator can always confirm "this CAN be cascaded" at a glance.
- **No generic `[INH]` token.** On a Playbook page, `[DOM]` already means "inherited from Domain". Unity, Chrome and Salesforce all use origin-discriminating cues only — generic inheritance is redundant signal.
- **Inline subtitle (Tokens Studio pattern).** Defence-in-depth: Figma's hover-only resolved-value tooltip silently regressed once and broke the chain for users. The subtitle survives any single-bug regression of the chip.

**Hover state** — tooltip with the one-line summary:

```
┌────────────────────────────────────────────┐
│  [DOM]  ◀── hover                          │
│                                            │
│  Warmth = 0.6                              │
│  Inherited from Domain (Education)         │
│  Set by Paul on 2026-05-22                 │
│  Click for full chain ⏎                    │
└────────────────────────────────────────────┘
```

### 3.3 Surface 2 — `<CascadeInspectorTray>` (the inspector)

Slide-in from the right (same `.hf-preview-sidetray` family as the Course Design Console — established 2026-06-07). Shows the full chain with the winner highlighted.

```
┌─────────────────────────────────────────────────────────────────┐
│  /x/courses/OCEAN/design                        [Cmd+K] [?]   ✕ │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Course Design Console            ┌─────────────────────────┐ │
│                                     │ Warmth                  │ │
│   Lenses ▼                          │ Effective: 0.6  [INH]   │ │
│     ● Preview                       ├─────────────────────────┤ │
│     ○ Journey                       │                         │ │
│     ○ Behaviour    ◀ from here      │  Cascade                │ │
│     ○ Settings                      │                         │ │
│                                     │  SYS  System default    │ │
│   Behaviour > Warmth = 0.6 [INH]    │       0.5 ─ (overridden)│ │
│                                     │                         │ │
│   [ Inspector → ]                   │  DOM  Education domain  │ │
│                                     │  ✓    0.6  ← effective  │ │
│                                     │       Set by Paul       │ │
│                                     │       2026-05-22        │ │
│                                     │                         │ │
│                                     │  PB   OCEAN Playbook    │ │
│                                     │       — not set         │ │
│                                     │                         │ │
│                                     │  SEG  (no segments)     │ │
│                                     │  CAL  (no overrides)    │ │
│                                     │  CL   n/a               │ │
│                                     │                         │ │
│                                     │  ──────────────────────  │ │
│                                     │                         │ │
│                                     │  [ Override for OCEAN ] │ │
│                                     │  [ Override for a       │ │
│                                     │    specific caller... ] │ │
│                                     │  [ Reset to inherited ] │ │
│                                     └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Three actions, ranked:**
1. **Override at the current scope** (Playbook, by default — the most common operator intent)
2. **Override at a deeper scope** (Caller — for one-off demos / debugging)
3. **Reset to inherited** (deletes the override row at the current scope; effective value snaps back)

The DEEPER-scope action opens a scope picker (Surface 3).

**CTA label changes when a row already exists at the chosen scope.** Unity's #1 documented sharp edge is "Apply at the wrong level overwrites overrides" — operators clicked the same button in two different states and got different effects. We mirror their lesson:

```
No existing override at OCEAN:          [ Override for OCEAN     ]
Existing override at OCEAN:             [ Replace override on OCEAN ]
```

Same primitive, label flips based on `resolveEffective().layers` membership. This is primary spec, not a stylistic guard.

**Write routing — `setKnobAtLayer` is a router, not a writer.** The function dispatches to the canonical write helper for the requested layer; it never calls `prisma.*` directly:

| Layer | Routes to | Bump helper called after |
|---|---|---|
| `PLAYBOOK` | `lib/playbook/update-playbook-config.ts::updatePlaybookConfig(playbookId, transformer)` | Automatic — `updatePlaybookConfig` bumps `composeInputsUpdatedAt` when a compose-affecting key changes |
| `DOMAIN` | `lib/domain/update-domain-config.ts::updateDomainConfig(domainId, updatable)` | Automatic via `updateDomainConfig` |
| `CALLER` | `writeCallerBehaviorTarget` (existing) + `bumpCallerComposeTimestamp` (existing) | Explicit — caller-scope writes don't go through a single chokepoint today |
| `SEGMENT`, `CALL` | Not in Sprint 1 (see §4 OUT) | n/a |
| `SYSTEM` | Out of Sprint 1 scope. ADMIN-only when added; no auto-dispatch | n/a |

Direct `prisma.*` calls from `set-at-layer.ts` are not permitted. Adding `lib/cascade/set-at-layer.ts` to the `hf-playbook/no-direct-playbook-config-write` or `hf-domain/no-direct-onboarding-write` ESLint allowlists is **not acceptable** — the file must call the helper, not own the write. (TL revision 2.)

### 3.4 Surface 3 — `<ScopePicker>` (the write affordance)

When the operator chooses "Override for a specific caller" (or types `set warmth 0.8 @beckett` in Cmd+K — same primitive both sides), they need to pick which scope to write to:

```
┌───────────────────────────────────────────────────────┐
│  Override Warmth = 0.8 at which scope?               │
│                                                       │
│  ◉ Playbook  ┌─────────────────────────────────────┐ │
│              │ OCEAN (Big Five)             [chip] │ │
│              └─────────────────────────────────────┘ │
│              Affects all 4 enrolled learners.        │
│                                                       │
│  ○ Domain    ┌─────────────────────────────────────┐ │
│              │ Education                     ▼     │ │
│              └─────────────────────────────────────┘ │
│              ⚠ Affects every course in this domain.  │
│                All enrolled learners across the      │
│                domain will receive updated settings  │
│                on their next call.                   │
│                                                       │
│  ○ Segment   ┌─────────────────────────────────────┐ │
│              │ (no segments on OCEAN)        ▼     │ │
│              └─────────────────────────────────────┘ │
│                                                       │
│  ○ Caller    ┌─────────────────────────────────────┐ │
│              │ Smoke Test 32e36              ▼     │ │
│              └─────────────────────────────────────┘ │
│              ⚠ Caller-scope overrides are persistent.│
│                They survive re-enrollment and stay   │
│                in effect on every future call until  │
│                explicitly reset.                     │
│                                                       │
│  ⚠ Cmd+K writes go through the AI tray. You can      │
│    review before applying. (see #878 tray pattern)   │
│                                                       │
│                       [ Cancel ]  [ Stage override ] │
└───────────────────────────────────────────────────────┘
```

**Cmd+K shorthand mirrors the picker** (per handoff §4 Sprint 3 plan):

```
> set warmth 0.8                 → current scope (Playbook on a course page)
> set warmth 0.8 @smoke-test     → CALLER scope
> set warmth 0.8 ^OCEAN          → PLAYBOOK scope (named, in case URL is elsewhere)
> set warmth 0.8 ~education      → DOMAIN scope
> set warmth 0.8 #system         → SYSTEM scope (ADMIN+ only, ⚠ banner)
```

Operator pins differentiate by scope — `set warmth @caller` and `set warmth ^playbook` are different pinned tools. Different muscle memory, different intents.

---

## 4. Scope of the primitive — what's IN and what's OUT for Sprint 1

### IN (this ADR commits to building)

| Resolver | Knob family | Wraps (verified 2026-06-10) | First UI consumer |
|---|---|---|---|
| `resolvers/behavior-target.ts` | All `BEH-*` parameters (response-length, concision, warmth, etc.) | `lib/tolerance/getEffectiveBehaviorTargetsForCaller.ts` — already exposes per-layer values (`systemValue`, `playbookValue`, `callerValue`). **NOT** `mergeTargets` in `transforms/quickstart.ts` — that runs at COMPOSE-stage, not resolution. | #1417 fix on `FirstSessionSettings.tsx` |
| `resolvers/session-flow.ts` | Onboarding phases, source provenance | `lib/session-flow/resolver.ts::resolveSessionFlow` — already returns `{value, source}` tuples; thin adapter maps source strings (`"new-shape"`, `"init001"`, etc.) to `Layer` enum. | #1418 fix on `PreviewLens.tsx` |
| `resolvers/welcome-message.ts` | Playbook welcome → Domain `onboardingWelcome` → null | `lib/session-flow/resolver.ts::resolveWelcomeMessage` (embedded in the same file, line 286). | Welcome editor badge |
| `resolvers/voice-config.ts` | Voice provider, voiceId, model | **REUSE `lib/cascade/voice-explain.ts` — ALREADY EXISTS** (shipped with #1348). Sprint 1 task is rename/re-export under `lib/cascade/resolvers/`, NOT a new file. Two read paths reconstructing the same chain risks drift. | (no UI consumer in Sprint 1 — primitive only, for Sprint 3 Cmd+K) |
| `resolvers/identity-spec.ts` | Group → Playbook → Domain → DEFAULT_ARCHETYPE_SLUG | Reads same DB rows as `transforms/identity.ts::resolveSpecs` but does NOT call it — `resolveSpecs` returns only the winner, not `LayerHit[]`. Reconstruct chain from raw DB. | (no UI consumer in Sprint 1 — primitive only) |

### OUT (deferred)

- **Segment layer**, **call-instance layer** — primitive supports them in the type; resolvers return empty hits for now. Real wire-up when there's a knob that uses them.
- **Telemetry on inspector opens** — Sprint 3 `HelpEvent` work owns this.
- **Inspector for non-cascading fields** — fields with only one possible scope don't get a `<LayerBadge>`. No "[PB only]" badges — they're noise.

---

## 5. The "difficult UX" risk (Paul's concern)

The research surfaced a real direction: **under-disclosure is the bigger killer**, not visual density. The SharePoint failure mode — silent inheritance, admin can't predict effect — is exactly the #1417 bug class. Optimising for "fewer badges, less noise" would re-introduce the problem we're solving. So the resting state leans toward *more* signal, not less, with weight/colour controlling density.

Three failure modes I'm still worried about. Two are addressed; one needs operator-interview signal before it can be:

| Failure mode | What it looks like | Mitigation |
|---|---|---|
| **Inspector friction** — operator clicks badge, gets sidetray, has to context-switch | Operator stops clicking, falls back to guessing | Tooltip on hover answers 80% of cases. Tray is for the 20% where chain matters. (Cross-tool convergence on click-to-open at this scale.) |
| **Write ambiguity** — operator clicks "Override" on a chip that's already overridden at this scope | Silent no-op or unexpected overwrite (Unity's #1 sharp edge) | Tray's primary CTA changes label based on `resolveEffective().layers` — primary spec at §3.3, not a stylistic guard. |
| **Resting-state noise** — every cascade-eligible field shows a chip + subtitle | Form panels look busy at first encounter | `[—]` chip + subtitle rendered at reduced weight/opacity. Operator interview Q1 is the falsifier — if they say "I can't see the active ones", we tighten back. SharePoint evidence says this is the right way round to err. |

I cannot pre-test these on paper. **The 2 operator interviews (Paul + 1 other educator-perspective person, 15 min each) are non-negotiable** before code lands. Specifically I want to learn:

1. When you see `[INH]`, do you instinctively know what it means?
2. When you hover and see "Set by Paul on 2026-05-22", does that help or feel surveillance-y?
3. When you click "Override for a specific caller", do you expect a fanout warning (it would affect just one) or a "scope this carefully" prompt (it would affect everything below)?
4. Do you actually want to see the inspector by default at the top of a panel, or only on demand?

The interviews come back into this ADR as an "Operator feedback" section before status flips to DECIDED.

---

## 6. Non-goals

- **Not** a graph view of the entire cascade. (One operator brain ≠ Chrome DevTools.)
- **Not** a global "show me all overrides anywhere" search page. (Adds a top-level surface — violates handoff §11 "Don't add a new top-level page for any cross-cutting concern".)
- **Not** a versioned cascade diff ("what changed last week"). Useful, but Layer 2 audit is downstream of this ADR.
- **Not** a "lock this value at scope X" affordance. Locks belong to the SETUP-readiness chain contract, not here.
- **Not** auto-creation of intermediate scope rows. If the operator writes at CALLER scope, we do NOT silently materialise an empty SEGMENT row "in case it's wanted later". This is the SharePoint "Limited Access" anti-pattern — the system creates state the user didn't ask for, then surfaces it as if intentional, and audit becomes meaningless. `setKnobAtLayer` writes exactly one row at exactly the requested layer.

---

## 7. Implementation order (informs the BA story for `feat(cascade): lib/cascade/ primitive`)

1. `lib/cascade/layer-types.ts` + `effective-value.ts` shape + the 5 resolvers — pure TS, no UI (1 day).
2. Hook + `<LayerBadge>` + tests — surface 1 only, wire to #1417 panel as smoke (0.5 day).
3. `<CascadeInspectorTray>` — surface 2 (0.5 day).
4. `<ScopePicker>` + `setKnobAtLayer` — surface 3 (0.5 day).
5. #1417 + #1418 fixes consumed (0.5 day).

Total: ~3 days post-design-sprint. BA + TL grooming happens *after* this ADR is signed.

---

## 8. What signing this ADR commits us to

- Spending ~3 dev-days on Sprint 1 Days 2–4 building the primitive + surfaces.
- A second sanity-check operator interview (educator-perspective person, 15 min) before merging the first Layer 2 PR. Will not block design — but if it surfaces a clear conflict with the Q1–Q4 decisions above, we re-open.
- A 30-minute walkthrough with Paul before that first Layer 2 PR merges, with the actual UI in front of us, to confirm it isn't drifting "difficult".
- A re-open of this ADR if the first real demo (Sprint 3) reveals the inspector tray is in the way more than it helps. Layer 2 is foundation — wrong primitive = wrong everything above it.

---

## 9. Open questions for Paul

These need answers before BA+TL grooming starts. I have a tentative position on each but no decision.

All four originally-open questions decided after the 2026-06-10 operator-#1 interview (Paul). One sanity-check interview with an educator-perspective person still wanted before merging the first Layer 2 PR; will not block design.

**Decided by operator-#1 interview (2026-06-10):**

| # | Question | Decision |
|---|---|---|
| Q1 | Show `[—]` chip + subtitle on every cascade-eligible field, even when there's no override anywhere? | **YES.** Quiet fields still render the chip + subtitle at muted weight. Confirms the research-leaning position — under-disclosure (the #1417 bug class) is the bigger risk than visual density. |
| Q2 | Surface `Set by Paul on 2026-05-22` in the hover tooltip? | **YES.** Already audited in AppLog and exposed in `/x/logs`; hiding it here would be incoherent. |
| Q3 | "Override for a specific caller" — fanout warning, persistence warning, or no warning? | **Persistence warning.** Caller-scope overrides are persistent — they survive re-enrollment and stay in effect on every future call until explicitly reset. Copy embedded in §3.4 ScopePicker mockup. |
| Q4 | Inspector tray on-demand (click) or default-open (panel top)? | **On-demand.** Chip + subtitle answer 80% of cases at rest; tray is for the chain. Chrome DevTools model, not Tokens Studio. |

**Settled by research before the interview:**
- ~~Q: Badge vocabulary — single `[↑]` vs `[PB]/[DOM]/[SYS]`?~~ → DECIDED: 4 origin-labelled tokens, no generic inheritance token. (Unity/Chrome/Salesforce convergence.)
- ~~Q: Hover-pin vs click-only?~~ → DECIDED: click-only. (Figma hover-only is the documented regression case.)
- ~~Q: Reset deletes row or sets value?~~ → DECIDED: deletes the row. (Unity pattern; sentinel-row alternative is the SharePoint phantom-row anti-pattern.)
- ~~Q: Small viewports?~~ → DECIDED: same slide-in, full-width on mobile. (Existing Course Design Console pattern.)

---

## 10. References

- Handoff brief — `memory/handoff-epic-1442-operator-truthful-demos.md` §4 Sprint 1 (the source of truth for the build plan)
- Epic — [#1442](https://github.com/WANDERCOLTD/HF/issues/1442)
- First two consumers — [#1417](https://github.com/WANDERCOLTD/HF/issues/1417), [#1418](https://github.com/WANDERCOLTD/HF/issues/1418)
- Existing cascades that the primitive wraps:
  - `lib/voice/voice-config-cascade.ts`
  - `lib/session-flow/resolver.ts`
  - `lib/prompt/composition/transforms/quickstart.ts::mergeTargets`
- Sidetray pattern precedent — Course Design Console (2026-06-07 epic close, `handoff-design-console-shipped-20260607.md`)
- AI-write tray precedent — `hooks/use-pending-changes-tray.tsx` (#878)
- Chain-contract constraints — `docs/CHAIN-CONTRACTS.md` §3 Link 3 (stamp-on-write/check-on-read; new cascade writes go through `updatePlaybookConfig`)

---

## 11. TL review revisions baked in (2026-06-10)

PR #1450 (this ADR) opened in parallel with `tech-lead` agent review. TL returned **NEEDS REVISIONS** with three concrete fixes. All three baked into §3.3, §3.4, and §4 above. Plus one critical reuse miss from the `reuse-finder` agent.

| # | Finding | Where fixed | Source |
|---|---|---|---|
| 1 | `mergeTargets` citation was wrong — that runs at COMPOSE stage, not resolution. Correct wrap target is `lib/tolerance/getEffectiveBehaviorTargetsForCaller.ts` (already exposes `systemValue` / `playbookValue` / `callerValue`). | §4 IN table, behavior-target row | TL §2 |
| 2 | `setKnobAtLayer` write routing was unspecified — risked bypassing `hf-playbook/no-direct-playbook-config-write` lint rule. Explicit per-layer dispatch table added. | §3.3 "Write routing" subsection | TL §1, §4 |
| 3 | ScopePicker mockup missing DOMAIN-scope fanout warning copy. Operator could click without knowing the change cascades across every course in the domain. | §3.4 ScopePicker mockup | TL §3 |
| 4 | `lib/cascade/voice-explain.ts` **already exists** (shipped with #1348). Sprint 1's `resolvers/voice-config.ts` should rename/re-export, NOT duplicate. Parallel read paths drift on schema change. | §4 IN table, voice-config row | reuse-finder |

**Open items the BA story must own (TL flagged, not baked into ADR):**

- **`setBy` / `setAt` provenance source per knob family** (TL Guard 1, HIGH risk). `BehaviorTarget` has `source` enum but no `setBy userId` column. `Playbook.config` has no authorship metadata. The tooltip mockup ("Set by Paul / 2026-05-22") needs a per-resolver answer: either (a) the field exists today and resolver returns it, (b) a schema migration adds it, or (c) resolver returns `null` and tray renders "Set by (unknown)". The BA must specify for each of the 5 resolvers.
- **New GET route for cascade inspector payload** (TL Guard 3 + Guard 4). Inspector tray needs an API to call `resolveEffective`. Route name + auth level (OPERATOR+) to be specified in the story.
- **`TrayEntryScope` enum has `"playbook" | "domain" | "system"` but no `"caller"`.** ScopePicker writes at CALLER scope either need a new tray scope value or bypass the tray. BA must decide which.
- **Sprint 3 ESLint addition** (when Cmd+K domain writes ship): add `lib/cascade/set-at-layer.ts` to `AI_TOOL_PATH_FRAGMENTS` in `eslint-rules/no-ai-fanout-all.mjs`. Not Sprint 1.

**External prior-art sources (researched 2026-06-10):**
- [Chrome DevTools — Find invalid, overridden, inactive CSS](https://developer.chrome.com/docs/devtools/css/issues)
- [Unity Manual — Prefab instance overrides](https://docs.unity3d.com/2018.3/Documentation/Manual/PrefabInstanceOverrides.html) + [nested-prefab override pitfalls](https://discussions.unity.com/t/nested-prefab-overwrite-issue/763570)
- [Unreal — yellow reset-arrow scroll-clipping bug](https://forums.unrealengine.com/t/yellow-reset-to-default-arrows-disappear-after-scrolling-offscreen-so-the-edited-value-isnt-visible-anymore/397547)
- [Tokens Studio — Token values & references](https://docs.tokens.studio/manage-tokens/token-values/references) + [Inspect tokens](https://docs.tokens.studio/debug/inspect-tokens)
- [Figma — bound-variable hover tooltip regression](https://forum.figma.com/report-a-problem-6/hover-tooltip-for-bound-variables-is-not-showing-value-description-anymore-52914)
- [AWS IAM Policy Simulator](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
- [GCP IAM Policy Troubleshooter](https://cloud.google.com/iam/docs/troubleshoot-policies)
- [Salesforce — Analyze User Permissions](https://help.salesforce.com/s/articleView?id=platform.perm_uapa_analyze_user_perms.htm)
- [Syskit — SharePoint permission inheritance failure modes](https://www.syskit.com/blog/sharepoint-permission-inheritance/) (cautionary tale — under-disclosure failure class)
