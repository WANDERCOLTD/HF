# HF Repo Knowledge Map

A translation layer for the HumanFirst (HF) codebase. The purpose of this file is to take a question asked in plain human language and route it to the right concept, the right file, and the right place to act, using the repo's own vocabulary.

Repo: `WANDERCOLTD/HF` (the URL `paw2paw/HF` redirects here; `WANDERCOLTD` is the canonical owner).
Source verified: README.md, CLAUDE.md, docs/INDEX.md, repo file tree. Last verified against repo on 2026-05-22.

---

## How to use this file

When a question comes in, do three things in order:

1. Translate the human words into HF concepts using the **Vocabulary Bridge** below.
2. Identify whether the answer is **runtime data** (lives in the database, edited via UI or CLI) or **engine/code** (lives in source files, changed via a branch and PR). This distinction governs almost everything in HF.
3. Point to the named concept, the canonical file, and the correct place to act.

---

## The one rule that explains most confusion

**The database is the runtime source of truth. Files are bootstrap material, not the live system.**

The BDD spec files in `apps/admin/docs-archive/bdd-specs/` exist to seed the database once. After seeding, the database owns the data, and specs can be created and edited entirely via the UI. So:

- To change what a live environment actually does now, edit the **database** (UI or CLI). Editing a file does nothing to a running environment.
- To change what a fresh seed or a brand new environment produces, edit the **seed file** (code change, branch, PR).
- A live database edit is wiped by a `db:reset`. If a change must survive resets and reach new environments, it has to land in both places.

If a question is "why didn't my file edit change anything," this rule is almost always the answer.

---

## The Adaptive Loop (the spine of the whole system)

Everything flows through one loop. Every feature, service, and change respects it:

```
Call → Transcript → Pipeline (EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE) → Next Prompt
```

Plain reading: a student has a call, the call becomes a transcript, the transcript runs through a seven-stage pipeline that measures and adapts, and the output is the next prompt the system will use. When someone says "the lessons changed" or "it responded differently," they are describing an output of this loop.

---

## Vocabulary Bridge: human words to HF concepts

| When a human says... | They probably mean (HF concept) | Type |
|---|---|---|
| "the course," "the lesson," "the curriculum" | **Playbook** (a collection of Specs for a domain) and/or **Domain** (Tutor, Companion, Coach) | Runtime data |
| "the teaching material," "the content" | **CONTENT** specs (e.g. `WNF-CONTENT-001`), Content Trust levels | Runtime data |
| "how it measures the student," "the assessment" | **Parameters** (e.g. Big Five, VARK) measured by **EXTRACT** specs | Runtime data |
| "how it decides what to say next," "the AI's reply" | **COMPOSE** stage + **SYNTHESISE** specs producing the Next Prompt | Engine + data |
| "the rules," "the guardrails," "what it must not do" | **CONSTRAIN** specs (e.g. `GUARD-001`) | Runtime data |
| "the personality," "the character," "the persona" | **IDENTITY** specs (e.g. `TUT-001`, `COACH-001`) | Runtime data |
| "the order things happen in," "the flow" | **ORCHESTRATE** specs (`PIPELINE-001`, `INIT-001`) | Runtime data |
| "how it scores quality," "the marking" | **REWARD** stage, reward policy (`RWD-001`), quality scorecard (`QS-001`) | Engine + data |
| "it learns / adapts to the student" | **ADAPT** stage, goal tracking | Engine + data |
| "the memory," "what it remembers" | **Memory taxonomy** (`MEM-001`), EXTRACT memory specs (`MEM-001`) | Runtime data |
| "the voice" | **VOICE** specs (`VOICE-001`) | Runtime data |
| "who can see / do what," "permissions," "logins" | **RBAC**, 8 roles, `requireAuth()` | Engine |
| "the journey," "the steps a student goes through" | **Journey stops** (auto-include stops wrapping teaching sessions) | Engine + data |
| "where the data lives," "the database design" | **Prisma schema** | Engine |

Type key: *Runtime data* = edit in the database via UI/CLI to change a live environment; back-port to a seed file if it must survive a reset. *Engine* = source code change, requires a branch and a PR.

---

## Core Concepts (definitions)

- **Parameters** — Dimensions the system measures, such as Big Five personality or VARK learning styles.
- **AnalysisSpecs** — The HOW. Either how to measure a parameter (an EXTRACT spec) or how to compose a prompt (a SYNTHESISE spec).
- **Playbooks** — Collections of specs for a domain, priority-ordered. This is the closest thing to what a layperson calls "the course."
- **Domains** — Logical groupings (Tutor, Companion, Coach), each with readiness checks.
- **Content Trust** — A six-level provenance taxonomy from L0 Unverified up to L5 Regulatory Standard.

### SpecRole taxonomy (what each kind of spec does)

| Role | Job | Example slugs |
|---|---|---|
| `ORCHESTRATE` | Flow and sequence control | `PIPELINE-001`, `INIT-001` |
| `EXTRACT` | Measurement and learning | `PERS-001`, `VARK-001`, `MEM-001` |
| `SYNTHESISE` | Combine and transform data | `COMP-001`, `REW-001`, `ADAPT-*` |
| `CONSTRAIN` | Bounds and guards | `GUARD-001` |
| `IDENTITY` | Agent personas | `TUT-001`, `COACH-001` |
| `CONTENT` | Curriculum material | `WNF-CONTENT-001` |
| `VOICE` | Voice guidance | `VOICE-001` |

A useful note for teachers: in the UI, teachers never see Playbooks, Specs, or Roles directly. The UI is organised by educator intent, and the system auto-scaffolds the underlying specs. So the "course" a teacher edits in the UI maps down to Playbooks and specs underneath.

---

## Where things live (canonical file map)

| You want to understand... | Go to |
|---|---|
| Project overview and philosophy | `README.md` |
| Full documentation index | `docs/INDEX.md` |
| Codebase structure and common tasks | `docs/CODEBASE-OVERVIEW.md` |
| Comprehensive system architecture | `apps/admin/ARCHITECTURE.md` |
| Admin app architecture (pipelines, playbooks, specs) | `apps/admin/docs/ARCHITECTURE.md` |
| The data-driven spec system | `apps/admin/docs/DATA-DRIVEN-ARCHITECTURE.md` |
| The 7-stage pipeline in detail | `docs/PIPELINE.md` |
| Content classification and data flow | `docs/CONTENT-PIPELINE.md` |
| The data model (database design) | `apps/admin/prisma/schema.prisma` |
| Parameters and metrics | `docs/04-behaviour/PAR-001-parameters-and-metrics.md` |
| Personality model | `docs/04-behaviour/PRS-001-personality-model.md` |
| Reward policy | `docs/04-behaviour/RWD-001-reward-policy.md` |
| Quality scorecard | `docs/04-behaviour/QS-001-quality-scorecard.md` |
| Memory taxonomy | `docs/05-data/MEM-001-memory-taxonomy.md` |
| Internal API reference (151+ endpoints) | `docs/API-INTERNAL.md` |
| Public API for clients | `docs/API-PUBLIC.md` |
| BDD spec file format | `apps/admin/docs-archive/bdd-specs/SPEC-FORMAT.md` |
| Seed specs (bootstrap only) | `apps/admin/docs-archive/bdd-specs/` |
| Architecture decisions | `docs/adr/` |
| Admin UI user guide | `apps/admin/ADMIN_USER_GUIDE.md` |
| Testing strategy and the playground | `apps/admin/docs/PLAYGROUND-GUIDE.md` |

### Code layout

```
apps/admin/              Next.js 16 app (all the real work lives here)
├── app/api/             ~315 API routes (each protected by requireAuth)
├── app/x/               Admin UI pages (all under the /x/ prefix)
├── lib/
│   ├── config.ts        Env vars, spec slugs (env-overridable)
│   ├── permissions.ts   RBAC: requireAuth(), isAuthError()
│   ├── pipeline/        Pipeline stage config and runners
│   ├── prompt/          Section loaders + prompt template compiler
│   ├── contracts/       DB-backed data contract registry
│   └── bdd/             Spec parser, compiler, prompt template generator
├── prisma/              Schema, migrations, seed scripts
├── cli/control.ts       CLI tool (npm run ctl)
└── e2e/                 Playwright tests

docs/                    Project-level documentation
scripts/                 Dev helpers
```

---

## "I want to..." quick router

**...change what a course/Playbook does for students, live, now**
That is runtime data. Edit it in the admin UI (organised by educator intent) or via the CLI (`npm run ctl`). It hits the database directly. Remember: a `db:reset` will wipe it unless you also back-port to the seed file.

**...make a Playbook change survive resets and reach new environments**
Edit the matching seed material under `apps/admin/docs-archive/bdd-specs/`, then re-seed. This is a code change: feature branch, PR, the works. Doing only this does NOT change any already-seeded live environment.

**...change how the system measures a student**
Parameters and EXTRACT specs. Concept docs: `PAR-001`, `PRS-001`. Live values are DB data; the measurement engine is in `apps/admin/lib/pipeline/`.

**...change how the AI decides what to say next**
The COMPOSE stage and SYNTHESISE specs. Engine lives in `apps/admin/lib/prompt/`. The composition flow is documented in the pipeline docs.

**...change the guardrails / what the AI must never do**
CONSTRAIN specs (`GUARD-001`). DB data for the values, engine in the pipeline for enforcement.

**...understand the end-to-end flow of a call**
`docs/PIPELINE.md` for the seven stages, then `apps/admin/ARCHITECTURE.md` for the full picture.

**...see or change the data model**
`apps/admin/prisma/schema.prisma`. Any change here is a migration and is treated as a heavyweight code change.

**...test a change before trusting it**
`apps/admin/docs/PLAYGROUND-GUIDE.md`.

**...integrate an external client with HF**
`docs/API-PUBLIC.md`.

---

## Who can do what (RBAC, at a glance)

Roughly 315 API routes are protected by `requireAuth()`; 12 are intentionally public (including 4 VAPI webhook-secret routes). Eight roles, highest to lowest:

`SUPERADMIN` > `ADMIN` > `OPERATOR` / `EDUCATOR` > `SUPER_TESTER` > `TESTER` / `STUDENT` / `VIEWER` > `DEMO`.

Onboarding is invite-based, with domain-locked invites. CI fails if any new route is missing auth.

---

## Operating norms worth knowing (so answers match how the team works)

- **Never work on `main`.** Non-trivial changes go on a feature branch (`fix/`, `feat/`, `chore/`), referencing a GitHub issue number where one exists, and merge via PR.
- **Search with `qmd` and `hf-graph`, not grep.** The repo mandates its own semantic search tools for exploration. Grep is reserved for complex multi-file regex edits.
- **Git is the single source of truth** for specs, data models, tests, and code. **Notion** holds planning, status, and meeting notes.
- **Three cloud environments:** DEV (`dev.humanfirstfoundation.com`), TEST (`test.humanfirstfoundation.com`), PROD (`lab.humanfirstfoundation.com`).

---

## Honest limits of this file

- This is a routing map, not a substitute for the live system. It tells you which concept and which file are in play. It cannot tell you the current value of any Playbook or spec, because those live in a database this file cannot see.
- Slug examples (e.g. `TUT-001`, `GUARD-001`) are illustrative of the naming scheme. Confirm exact slugs against the live spec list before acting.
- File paths are accurate as of the verification date above. The repo moves; if a path misses, start from `docs/INDEX.md`, which is the maintained map.
- This file was built from the repo's own top-level documentation. It has not traced individual source files line by line.
