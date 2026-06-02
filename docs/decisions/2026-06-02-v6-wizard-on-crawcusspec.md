# ADR: V6 Wizard built on CrawcusSpec (`@tallyseal/core`)

**Date:** 2026-06-02
**Status:** Proposed
**Deciders:** Paul Wander, HF team
**Supersedes:** none. **Coexists with:** V5 wizard (`apps/admin/app/x/wizard/components/conversationalwizard.tsx` + `lib/wizard/graph-*.ts` + `lib/chat/v5-system-prompt.ts`).

> **Non-goal — V5 stays untouched.** V5 ships every Build Course, Build Community, and Build Source flow today. This ADR proposes a parallel V6 surface; it does not touch V5 code, V5 routes, or V5 specs. V5 is deprecated only after V6 reaches parity on a flow-by-flow basis, validated by side-by-side production traffic.

## Context

### V5 has four overlapping partial contracts and no single source of truth

The V5 wizard is graph-driven (`lib/wizard/graph-evaluator.ts`, `graph-nodes.ts`, `graph-schema.ts`) with field persistence split across four mechanisms:

| Mechanism | What it enforces | Where it falls short |
|---|---|---|
| `WizardGraphNode` TS type | Existence, dependencies, `required`, `skipWhen` | No `tool` field, no `persistVia` field |
| Tool schemas (`conversational-wizard-tools.ts`) | `show_options.dataKey` auto-persists; `show_suggestions` does not | Pairing between a node and the correct tool lives nowhere |
| `validate-setup-fields.ts` | Whitelist + name corrections | Cannot judge whether a write should have happened |
| `v5-system-prompt.ts` prose (~600 lines) | "For NPS call `show_suggestions` then `update_setup`" | Model trust. The only enforcer is the LLM following English instructions. |

This violates the CLAUDE.md top-line mandate **"Configuration over Code. Database over Filesystem."** Every other AI-driven surface in HF (pipeline stages, prompt composition, identity, voice, BDD specs) is spec-driven; the wizard is TypeScript literals + prose.

### Two recent bugs are symptoms of the contract hole

Observed 2026-06-01 in `dev.humanfirstfoundation.com /x/admin/courses` Build Course wizard:

1. **NPS Y/N renders with no chips.** Prompt asks via `show_suggestions` (no `dataKey`, no auto-persist) and relies on the AI to remember to call `update_setup({ npsEnabled })`. When the AI forgets, the field stays undefined and the chip rail never fires.
2. **Module-catalogue picker re-renders after the user answers it.** Because `progressionMode` never lands in the data bag (same split-call contract), the graph evaluator re-prioritises the node and emits the `🚨 BLOCKED — progressionMode picker required` directive on the next turn. The renderer faithfully draws the identical picker again with a fresh `uid()`.

Both are contract-shaped holes, not rendering bugs. A renderer-layer dedup would have **masked** Symptom 2 by swallowing user input silently — making the bug worse.

### tallyseal sister project (`/Users/paulwander/projects/tallyseal`)

The `@tallyseal/*` workspace ships:

- `@tallyseal/core` — `defineCrawcusSpec()` + `defineContract()` + `field` builder + `writeEvent` runtime
- `@tallyseal/react` — chip lifecycle + `SuggestionRail` primitives
- `@tallyseal/react-assistant-ui` (Y1 marquee), `@tallyseal/react-copilotkit`, `@tallyseal/react-vercel-aisdk` — chat-UI adapters
- `@tallyseal/server`, `@tallyseal/prisma-adapter`, `@tallyseal/extractor`
- `@tallyseal/regulations-{gdpr,ferpa,eu-ai-act}` — typed Contract factories
- `@tallyseal/crawcus-tck` — Test Compatibility Kit for the open CRAWCUS spec

**HF is named as the first wedge customer** in `tallyseal/README.md` and `docs/notebook/08-design-partner/hf-as-witness-zero.md`. Consumption is intended to happen via normal npm flow; the packages aren't published yet but the workspace builds locally.

`CrawcusSpec` (`packages/crawcus-spec/src/types/intent.ts`) declares a complete typed-completion contract for a conversational flow: `key`, `version`, `fields`, `readiness`, `contracts: { pre, invariants, post }`, `extends` (sector-pack overlay), `derogations` (with regulation citations), and optional `disclosureRequirements` / `consentRequirements` / `lineageRequirements` / `oversightRequirements`. Field builders chain: `field.string().required().askHint({en:'…'}).options([…]).validates(fn).contract(c)`.

Worked example (`apps/playground/src/tallyseal/intents.ts`) is `CreateRecipe` — a complete conversational-form wizard in ~30 lines, plus invariant and post-commit contracts.

## Decision

**Build V6 of the HF wizard as a parallel surface on `@tallyseal/core` + `@tallyseal/react-assistant-ui`, with each wizard flow (Create Course, Create Community, Create Source, Create Institution) declared as a `CrawcusSpec`.**

V5 remains in production and continues to receive bug fixes. V6 ships behind a feature flag and a separate route prefix.

### V6 architecture

```
apps/admin/
├── app/x/wizard-v6/                         ← NEW route prefix, V5 untouched at /x/wizard
│   ├── courses/page.tsx                     ← consumes @tallyseal/react-assistant-ui
│   ├── communities/page.tsx
│   ├── sources/page.tsx
│   └── institutions/page.tsx
├── lib/wizard-v6/
│   ├── specs/
│   │   ├── create-course.crawcus.ts         ← CrawcusSpec literal
│   │   ├── create-community.crawcus.ts
│   │   ├── create-source.crawcus.ts
│   │   └── create-institution.crawcus.ts
│   ├── compliance.ts                        ← ComplianceManifest (GDPR + FERPA)
│   ├── reducers/                            ← customReducer escapes (mirror to Playbook.config)
│   └── adapters/
│       └── hf-prisma-event-store.ts         ← @tallyseal/prisma-adapter binding
└── lib/wizard/                              ← V5, UNCHANGED
```

Each wizard intent is a `CrawcusSpec`. Example for `CreateCourse`:

```ts
export const CreateCourse: CrawcusSpec = defineCrawcusSpec({
  key: 'CreateCourse' as IntentKey,
  projection: 'Playbook' as ProjectionName,
  version: 1,
  classification: 'standard',
  fields: {
    courseName: field.string().required().askHint({ en: 'What course are we building?' }),
    progressionMode: field
      .enum(['ai-led', 'learner-picks'])
      .required()
      .askHint({ en: 'How should learners progress through modules?' })
      .options(['ai-led', 'learner-picks']),
    npsEnabled: field
      .boolean()
      .optional()
      .askHint({ en: 'Should we ask for satisfaction rating at end of course?' }),
    // … 19 other nodes that today live in graph-nodes.ts
  },
  readiness: ({ has }) => has('courseName', 'progressionMode'),
  contracts: {
    invariants: [
      defineContract({
        id: 'course.progression-and-modules-agree',
        description: { en: 'If progressionMode is learner-picks, modules must be authored.' },
        predicate: ({ has, value }) =>
          value('progressionMode') !== 'learner-picks' || has('modulesAuthored'),
      }),
    ],
    post: [/* commit-time invariants */],
  },
});
```

### What V6 fixes that V5 cannot

| V5 gap | V6 mechanism |
|---|---|
| Tool/persistence pairing is implicit | The runtime derives the tool + persistence from the field type. `field.enum().options([…])` always pairs with a `show_options`-equivalent in the adapter. No prose. |
| `show_suggestions` requires a manual `update_setup` | The chip lifecycle in `@tallyseal/react` writes the event in one path. The "did the AI remember?" failure mode disappears. |
| Graph re-emits unanswered nodes (duplicate picker) | The runtime ledger is event-sourced. The next-turn evaluator reads materialised state, not an inferred blackboard. Re-emission requires explicit re-ask, never accidental. |
| Field values silently dropped by client-side whitelist | The spec's `fields` map is the whitelist. There is only one source. |
| Cross-layer integrity not checked | `defineContract` predicates run at every checkpoint. Violations emit a `ContractViolation` event surfaced in audit. |
| GDPR/FERPA compliance bolted on later | `ComplianceManifest` declares PII tier, retention, residency, lawful basis. EU AI Act `classification: 'standard' \| 'high-risk' \| 'prohibited'` is first-class. |

### Migration plan (incremental, V5 always working)

1. **Phase 1 — Vendor + smoke test.** `pnpm add @tallyseal/core @tallyseal/react @tallyseal/react-assistant-ui @tallyseal/prisma-adapter` (pinned exact versions; pre-release). Build a `/x/wizard-v6/playground` page that runs the playground `CreateRecipe` spec end-to-end. Confirms the wire works.
2. **Phase 2 — Pilot one flow: `CreateCourse`.** Translate `lib/wizard/graph-nodes.ts` Course nodes into `create-course.crawcus.ts`. Wire `customReducer` to mirror the existing `Playbook.config` write path. Ship behind `NEXT_PUBLIC_WIZARD_VERSION=v6` env flag. V5 stays default.
3. **Phase 3 — Side-by-side production traffic.** Route 10% of new Build Course sessions to V6. Measure: contract violation rate, completion rate, time-to-launch, AI-call cost. V6 must match or beat V5 on every metric for two consecutive weeks.
4. **Phase 4 — Extend to other flows.** `CreateCommunity`, `CreateSource`, `CreateInstitution`. Each ships as its own `.crawcus.ts` behind its own flag.
5. **Phase 5 — Flip default.** `NEXT_PUBLIC_WIZARD_VERSION=v6` becomes default. V5 routes redirect. V5 code stays in tree for one further sprint as rollback target.
6. **Phase 6 — Retire V5.** Delete `lib/wizard/graph-*.ts`, `lib/chat/v5-system-prompt.ts`, `conversationalwizard.tsx`, and the corresponding routes. Only after V6 has run as the default for one full sprint without rollback.

V5 receives **bug fixes** during Phases 1-5 but **no new feature work**. New nodes ship in V6 only.

## Versioning + sync strategy

A live dependency on `@tallyseal/*` only works if HF can answer "are we in sync?" deterministically. The owner of tallyseal is also the owner of HF (Paul Wander) — which inverts the usual pre-release-vendor risk: every breakage can be fixed at source before HF needs the upgrade. The discipline below makes that practical, not theoretical.

### Three orthogonal version axes

HF pins (A), observes (B), owns (C). They evolve independently.

| Axis | What it is | Owner | Sync mechanism |
|---|---|---|---|
| **A. Package semver** | `@tallyseal/core@0.3.7` etc. | tallyseal | Exact pin in HF `package.json`. Bumped on a monthly cadence. |
| **B. CRAWCUS standard version** | The format itself (currently `v0.2` per `intent.ts`) | tallyseal (open standard) | Declared once in HF. Bumped via formal RFC + TCK update. |
| **C. Per-spec `version: N`** | The integer on each `CrawcusSpec` literal | HF (per flow) | Bumped when an HF flow's shape changes — independent of A and B. |

### Boundary facade — single import surface

Every `@tallyseal/*` import in HF goes through one re-export file:

```
apps/admin/lib/wizard-v6/tallyseal/
├── index.ts           ← the only place HF imports from @tallyseal/*
├── types.ts           ← re-exports CrawcusSpec, FieldSpec, Contract, etc.
├── builders.ts        ← re-exports defineCrawcusSpec, defineContract, field
└── adapters.ts        ← re-exports the React adapter HF picks
```

Everything else in HF imports from `@/lib/wizard-v6/tallyseal`, never from `@tallyseal/core` directly. Refactors, renames, and signature changes hit one file. Cost: ~30 lines of re-exports. Value: every tallyseal upgrade has a single PR-shaped surface to review.

### Compatibility is *defined*, not hoped-for — TCK is the contract

`@tallyseal/crawcus-tck` is the Test Compatibility Kit for the open standard.

- **tallyseal CI** runs TCK against `@tallyseal/core` itself — proves the runtime implements the standard at this revision.
- **HF CI** runs TCK against HF's V6 wizard consumption — proves HF's adapter matches what the runtime expects.
- **Both pin the same TCK version**, bumped together.

"Are we in sync?" becomes a binary, machine-checkable question: *does HF's wizard pass the same TCK revision that tallyseal's runtime passes?* If yes, you're in sync. If no, the TCK output names the failing contract. Without TCK, "compat" means "did types still match" — which catches signature drift but not semantic drift.

### Five sync rules

| # | Rule | What it gives |
|---|---|---|
| 1 | **Exact pin, no caret/tilde** in `package.json`: `"@tallyseal/core": "0.3.7"`, never `"^0.3.7"` | Reproducible installs across local + CI + production |
| 2 | **Changesets workflow in tallyseal** — every PR adds a changeset declaring patch/minor/major | Forces conscious semver decisions; produces a CHANGELOG HF can scan in 30 seconds |
| 3 | **TCK pinned in HF CI** + green required to merge | Compat becomes a build-time fact, not a hope |
| 4 | **Monthly upgrade window in HF** — first Monday of each month: bump `@tallyseal/*` to latest, run TCK + V6 e2e, fix-forward on either side. Nothing else upgrades that window. | Bounded blast radius. If something breaks, the diff is small and the cause is obvious. |
| 5 | **Boundary facade** at `lib/wizard-v6/tallyseal/*` — single import surface | Renames, signature changes, and removed exports surface as one diff |

### Anti-patterns to avoid from day one

| Anti-pattern | Why it bites |
|---|---|
| `file:../tallyseal/packages/core` in HF `package.json` | Works on Paul's laptop; breaks on CI, breaks on hf-dev VM. Leaks tallyseal's `node_modules` into HF builds. Ban. |
| `workspace:*` across repos | Would only work if HF + tallyseal became a single monorepo (explicitly rejected — separate IP boundaries). |
| Floating dependency range (`^0.x`) | One `npm install` later, prod has a different version than dev. Pre-1.0 patches can break. |
| HF-specific code added to `@tallyseal/core` | Pollutes the open standard with one customer's needs. HF-specific adapters live in HF (e.g., `apps/admin/lib/wizard-v6/hf-adapter/*`) — never upstreamed unless genuinely generic. The wedge-customer story depends on HF *consuming* and *validating* the open standard, not bending it. |
| Bumping tallyseal without changesets | Becomes impossible to reason about the changelog. Use the changeset CLI even for solo work — it costs nothing. |

### Is this a one-time import?

**No.** A one-time import would forfeit every future tallyseal improvement, force HF to maintain a fork of CRAWCUS independently, break the wedge-customer story, and produce worse compliance attestations (auditors prefer "implements `@tallyseal/core@0.5.2`" over "fork of v0.2 from 2026-06"). Treat tallyseal as a live dependency governed by the five rules above. Cost: ~1 hour/month of upgrade-window discipline. Benefit: every fix lands at the source and flows to HF cleanly.

## Consequences

### Positive

- **One source of truth per flow.** `create-course.crawcus.ts` replaces five layers (graph node + tool schema + validator + whitelist + prompt prose).
- **The NPS-class bug becomes unrepresentable.** Field declares tool + persistence together; the adapter wires both.
- **Compliance infrastructure earned for free.** GDPR / FERPA / EU AI Act contracts ship with the package; HF gets the audit-bundle output it will need for market entry anyway.
- **Strategic alignment.** HF as named wedge customer for tallyseal — consumption proves the contract is the right shape and accelerates tallyseal's path to GA.
- **Open standard underneath.** CRAWCUS is the standard, Tallyseal is one runtime; HF is not vendor-locked.
- **Adapter choice preserved.** If `react-assistant-ui` proves wrong, swap to `react-copilotkit` or `react-vercel-aisdk` without touching the spec.

### Negative / risk

- **Tallyseal packages are pre-release.** No published npm packages yet (Y1 H1 milestone per tallyseal/README). HF would consume via local file: paths or a private registry until publication.
  - **Mitigation:** start with Phase 1 vendor + smoke test only. Phase 2 commitment waits on tallyseal v0.1 publication or a stable pin.
- **Two wizard systems in production simultaneously for the V5→V6 transition window.** Maintenance burden on both.
  - **Mitigation:** Phases 2-5 are explicitly time-boxed. V5 receives only bug fixes during the transition.
- **`@tallyseal/react-assistant-ui` may not cover every V5 UX detail.** V5 has unique behaviours (course-ref analysis spinner, welcome-flow chip handler, etc.).
  - **Mitigation:** Phase 2 acceptance criteria include a UX parity matrix. Gaps go to tallyseal as PRs (we are the wedge customer).
- **Event-sourced model is a paradigm shift.** Today the wizard updates a snapshot directly; V6 records events and projects state.
  - **Mitigation:** `customReducer` provides a Tier-2 escape for HF-specific state shapes during transition. Pure event-sourcing only after Phase 4.
- **CrawcusSpec is currently TypeScript literal, not DB-seeded JSON.** "Configuration over Code" mandate is satisfied only partially.
  - **Mitigation:** Phase 7 (post-retirement) — promote `.crawcus.ts` to spec JSON loaded via `AnalysisSpec`-style DB model. Separate ADR when the time comes.

### Neutral

- V6 changes the URL shape (`/x/wizard-v6/*`) during transition. Routes flip at Phase 5.
- The `Playbook.config` write path is preserved via `customReducer` — downstream pipeline, composition, and call flow are unaffected.

## Alternatives considered

1. **Narrow patch on V5 only.** Convert NPS to `show_options` (closes Symptom 1) and add "asked-recently" guard to `graph-evaluator.ts` (closes Symptom 2). Rejected as the primary fix because it leaves the contract hole open for every future node; the next `show_suggestions`-shaped feature reopens the same class of bug. *Accepted as a tactical patch for the immediate user-visible symptom while V6 is in development.*
2. **Build a homegrown WizardNodeSpec model.** Mirror `AnalysisSpec` for wizard nodes. Rejected: duplicates work tallyseal has already shipped, forfeits the compliance infrastructure and adapter ecosystem, breaks the strategic alignment with HF as tallyseal's wedge customer.
3. **Extend the `DataContract` registry to cover wizard nodes.** Rejected: `DataContract` is a boolean gate over composition sections; it's the wrong abstraction shape for "this node uses this tool and persists via that mechanism."
4. **Adopt `assistant-ui` (or CopilotKit, or Vercel AI SDK) directly without tallyseal.** Rejected: these libraries give us a chat UI, not a contract. The contract gap is the actual bug class.

## Open questions

1. Tallyseal package publication timeline — when can HF pin a published v0.1 vs consume via `file:` path? Coordinate with tallyseal roadmap.
2. Which adapter is the right pick for V6 Phase 1 — `react-assistant-ui` (Y1 marquee), or do we prototype against `react-vercel-aisdk` because HF already uses AI SDK conventions? Decide at Phase 1 spike close.
3. Does V6 keep `update_setup`-style server-side validation, or move to event-sourced commits via `writeEvent`? Phase 2 design call.
4. Storage: `@tallyseal/prisma-adapter` schema fragment vs HF's existing `setupData` blob — pick a single store. Phase 2 design call.
5. Is `CreateCourse` actually one CrawcusSpec, or several composed via `extends` (e.g. `CreateCourse extends CreateLearningArtifact`)? Phase 2 design call.

## References

- V5 wizard surface: `apps/admin/app/x/wizard/components/conversationalwizard.tsx`, `apps/admin/lib/wizard/{graph-schema,graph-nodes,graph-evaluator,resolvers,validate-setup-fields}.ts`, `apps/admin/lib/chat/{v5-system-prompt,conversational-wizard-tools}.ts`
- V5 contract documentation: `~/.claude/projects/-Users-paulwander-projects-HF/memory/wizard-chat-flow.md`, `gs-v5-dependency-chain.md`, `feedback_wizard_chain_dag_first.md`
- Tallyseal: `/Users/paulwander/projects/tallyseal/README.md`, `packages/crawcus-spec/src/types/intent.ts`, `apps/playground/src/tallyseal/intents.ts`
- CRAWCUS format canonical: `/Users/paulwander/projects/tallyseal/docs/notebook/02-product/crawcus-format.md`
- HF as wedge customer: `/Users/paulwander/projects/tallyseal/docs/notebook/08-design-partner/hf-as-witness-zero.md`
- CLAUDE.md top-line mandates: "Configuration over Code. Database over Filesystem." + "Wizards must flow."

## Action items if accepted

- [ ] Confirm tallyseal package publication or `file:` consumption path with tallyseal owner
- [ ] Spike Phase 1 — `/x/wizard-v6/playground` running `CreateRecipe` end-to-end in HF tree. Time-box 1 day.
- [ ] Write groomed GitHub epic for Phase 2 (`CreateCourse` pilot). Pass to BA + Tech Lead.
- [ ] **Open tactical issue** for the V5 NPS + duplicate-picker symptoms (narrow patch per Alternative 1) so users are unblocked before V6 ships.
- [ ] Update `~/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md` "Now" section with V6 epic pointer once accepted.
