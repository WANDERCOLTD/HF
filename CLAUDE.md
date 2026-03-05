# CLAUDE.md

> **Configuration over Code. Database over Filesystem. Evidence over Assumption. Reuse over Reinvention.**
>
> **Plan creatively. No hardcodes. qmd + graph. Gold UI. Wizards must flow.**

@/Users/paulwander/projects/skills/dev-principles-SKILL.md
@/Users/paulwander/projects/skills/hf-nextjs-patterns-SKILL.md

---

## 🤖 Proactive Agent Team — MANDATORY

**You are the developer in an Agile team. The PM (user) describes intent; you run the team.**

### Recognise building intent — intercept BEFORE coding

When the user says anything matching these patterns, **STOP and run the BA + Tech Lead agents first**:

| User says | What to do |
|-----------|-----------|
| "I'm going to build / implement / add / create [X]" | Run BA + Tech Lead on X |
| "Let's do [feature]" / "Time to work on [feature]" | Run BA + Tech Lead on feature |
| "Can you build / code / write [X] for me" | Run BA + Tech Lead on X |
| "Start on [feature]" / "Work on [feature]" | Run BA + Tech Lead on feature |
| Pastes a spec/doc and says "implement this" | Run BA + Tech Lead on the spec |

**Exception:** If the user references an existing GitHub issue number (e.g. "work on #12"), skip BA/TL — it's already groomed.

### The interception flow

```
1. Detect building intent (patterns above)
2. Say: "Before we start coding — let me run a quick check."
3. Spawn BA agent (parallel) → searches codebase, writes/finds GitHub issue
4. Spawn Tech Lead agent (parallel) → validates, flags risks
5. Present findings: what exists, what needs building, acceptance criteria, effort
6. Ask: "Ready to build?" — wait for confirmation
7. THEN start coding, with the acceptance criteria as your definition of done
```

### Recognise other intents — handle differently

| User says | What to do |
|-----------|-----------|
| "Run the standup" / start of session with no clear task | Run standup-bot agent |
| "What should I work on?" / "What's next?" | Read sprint backlog + MEMORY.md, recommend top story |
| "We're done" / "That's working" / story criteria all met | Run QA agent on the story, then guard-checker |
| "End of sprint" / "Sprint review" | Run retro-bot agent |
| Fix chain detected (3+ fix: commits on same topic) | Flag it, offer to create a root-cause story |

### Definition of Done (every story)

- [ ] All acceptance criteria checked off
- [ ] `qa-engineer` agent run (vitest + promptfoo evals if applicable)
- [ ] `guard-checker` agent run (all 13 guards)
- [ ] `/check` passes (tsc + lint + tests)
- [ ] Issue closed on GitHub

---

## ⚠️ MANDATORY: Use qmd and hf-graph — NOT grep, NOT glob

**This is non-negotiable. Before searching, reading, or navigating any code in this repo:**

1. **Use `qmd search` or `qmd vector_search` first** — always, for every exploration or lookup task
2. **Use `hf-graph`** for function/type/import lookups
3. **Grep is banned for exploration** — only permitted for complex multi-file regex edits with no qmd equivalent

| Task | Required tool |
|------|--------------|
| Find a concept, feature, or keyword | `qmd search` |
| Find something by meaning/intent | `qmd vector_search` |
| Broad query, unsure of exact terms | `qmd deep_search` |
| Find where a function/type is defined | `hf-graph` |
| Complex regex across many files | grep (only this case) |

**Do not skip qmd "to save time". It is faster and more accurate than grep for this codebase.**

Both configured in `.mcp.json` — auto-connect on project open.

**qmd auto-sync (local only):** Git hooks keep qmd fresh — `pre-commit` updates before commit, `post-merge` after pull. Not needed on hf-dev VM.

---

## Reference Docs (read before re-reading code)

These memory files are kept in sync with the codebase. Consult them first.

| Doc | Contents | Update when |
|-----|----------|-------------|
| [memory/entities.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/entities.md) | Entity hierarchy, canonical file map, terminology | Schema migration, new model or relation |
| [memory/holographic.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/holographic.md) | 8 sections, state shape, permissions, Phase 2 pattern | Section added/changed, new Phase 2 component |
| [memory/async-patterns.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/async-patterns.md) | useTaskPoll / useAsyncStep / WizardShell / spinner-vs-glow | New hook, polling pattern, wizard framework change |
| [memory/extraction.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/extraction.md) | DocumentTypes, resolution chain, ContentAssertion shape, trust levels | New DocumentType, extraction category, new resolveExtractionConfig caller |

---

## Architecture

Single Next.js 16 app in a monorepo. All work under `apps/admin/`.

```
apps/admin/
├── app/api/         ← API routes (requireAuth on every one)
├── app/x/           ← Admin UI (all under /x/ prefix)
├── lib/
│   ├── config.ts    ← Env vars, 16 spec slugs in config.specs.* (all env-overridable)
│   ├── permissions.ts ← RBAC: requireAuth() + isAuthError()
│   ├── pipeline/    ← Pipeline stage config + runners
│   ├── prompt/      ← SectionDataLoader (16 parallel loaders) + PromptTemplateCompiler
│   ├── contracts/   ← DB-backed DataContract registry (30s TTL cache)
│   └── bdd/         ← Spec parser, compiler, prompt template generator
├── prisma/          ← Schema, migrations, seed scripts
├── cli/control.ts   ← CLI tool (npx tsx cli/control.ts)
└── e2e/             ← Playwright tests
```

### The Adaptive Loop

```
Call → Transcript → Pipeline (EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE) → Next Prompt
```

Every feature must respect this loop. Pipeline stages are spec-driven from `PIPELINE-001` in the DB.

### Intent-Led UX: Teacher's View

Teachers never see Playbooks, Specs, or Roles. All UI is organized by educator intent.

```
Teacher's View                  Internal Composition
─────────────────              ─────────────────────
Institution (Domain)           • Domain (1 per school/org)
└─ Course (Playbook)           • Playbook + auto-created CourseReady overlay
   ├─ Lessons                   • Composited CONTENT specs (auto-linked)
   ├─ Content Upload            • EXTRACT-CONTENT specs
   ├─ Teaching Points
   ├─ Onboarding Setup          • IDENTITY specs + INIT-001 phases + ADAPT targets
   └─ First Call Preview        • Prompt composition from merged specs
```

No manual wiring. System auto-scaffolds when readiness checks fail.

### SpecRole Taxonomy

- `ORCHESTRATE` — Flow/sequence control (PIPELINE-001, INIT-001)
- `EXTRACT` — Measurement and learning (PERS-001, VARK-001, MEM-001)
- `SYNTHESISE` — Combine/transform data (COMP-001, REW-001, ADAPT-*)
- `CONSTRAIN` — Bounds and guards (GUARD-001)
- `OBSERVE` — System health/metrics (AIKNOW-001, ERRMON-001, METER-001)
- `IDENTITY` — Agent personas (TUT-001, COACH-001)
- `CONTENT` — Curriculum material (WNF-CONTENT-001)
- `VOICE` — Voice guidance (VOICE-001)

---

## Commands

All commands run from `apps/admin/` unless noted.

### Health & Status
```bash
npm run ctl ok           # Quick health check (git, types, MCP, server)
npm run ctl check        # Full checks (lint + types + tests + integration)
npm run ctl dev:status   # Dev server status
```

### Dev
```bash
npm run dev              # Start dev server (:3000)
npm run devX             # Kill + clear cache + restart
npm run devZZZ           # Nuclear reset (DB + specs + transcripts)
```

### Test
```bash
npm run test             # Vitest — all unit tests
npm run test -- path     # Single test file
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
npm run test:integration # Integration tests (requires running server)
npm run test:e2e         # Playwright e2e (requires running server)
npm run test:all         # Unit + integration + e2e
```

### Build & Lint
```bash
npx tsc --noEmit         # Type-check
npm run build            # Next.js production build
npm run lint             # ESLint (includes AI metering + CSS var enforcement)
```

### Database
```bash
npm run db:seed          # Seed specs + contracts
npm run db:reset         # Full database reset
npx prisma migrate dev   # Run/create migrations
npx prisma studio        # DB GUI
```

### BDD & CLI
```bash
npm run bdd              # Run Cucumber tests
npm run ctl <command>    # Direct CLI command
npm run control          # Interactive CLI menu
```

---

## MCP Server Troubleshooting

```bash
./scripts/check-startup.sh   # Verify on startup
```

If servers fail:
1. `qmd --version` — check installed
2. `.mcp.json` exists at repo root
3. Restart Claude Code
4. `qmd embed` — rebuild embeddings (one-time, ~2 min)

---

## Libraries First (MANDATORY)

Search npm before hand-rolling. Key packages: `jsonrepair`, `p-retry`, `p-limit`, `slugify`, `papaparse`, `fuse.js`, `croner`. If none fits, add `// No suitable npm package as of YYYY-MM`. Full table in `dev-principles-SKILL.md`.

---

## Plans: Intent-First Design (MANDATORY)

Every plan must address all three lifecycle phases: **Setup** (first-time config), **Maintenance** (edit/monitor over time), **Runtime** (end-user moment-to-moment). UI-touching plans MUST include ASCII mockups — draw it, don't describe it.

Run `plan-reviewer` agent before presenting a plan for approval. It checks phases, mockups, and the intent checklist.

---

## Plan Guards (MANDATORY)

Run `guard-checker` agent:
- **Pre-plan:** guards 1-6, 10-11 (architectural — catch mistakes early)
- **Post-plan / pre-commit:** all 13 guards

Guard definitions in `.claude/agents/guard-checker.md`. Always end a completed story with a guard report.

---

## UI Design System (Zero Tolerance)

No inline `style={{}}` for static properties. No hardcoded hex. No one-off styling.

- **Admin** (`/x/**`): `hf-*` classes — `hf-card`, `hf-btn`, `hf-input`, `hf-banner`, `hf-spinner`, `hf-glow-active`, etc.
- **Auth** (`/login/**`): `login-*` classes
- **Spinner vs Glow**: `hf-spinner` = blocking (user must wait). `hf-glow-active` = background (user can continue). Never mix on same element.
- **FieldHint**: Every wizard intent field MUST have `<FieldHint>`. Data in `lib/wizard-hints.ts`.

Full class list + color map in `hf-nextjs-patterns-SKILL.md`. Run `ui-reviewer` agent after any UI changes.

---

## RBAC

**SUPERADMIN (5) > ADMIN (4) > OPERATOR/EDUCATOR (3) > SUPER_TESTER (2) > TESTER/STUDENT/VIEWER (1) > DEMO (0)**

- `EDUCATOR` (level 3) — educator portal, scoped to own cohorts + students
- `STUDENT` (level 1) — student portal, own data only
- `VIEWER` — deprecated alias for TESTER

Public routes (no auth): `/api/auth/*`, `/api/health`, `/api/ready`, `/api/system/readiness`, `/api/invite/*`, `/api/join/*`

Webhook-secret routes (no session auth, validated via `lib/vapi/auth.ts`): `/api/vapi/*`, `/api/webhook/*`

Sim access: all sim routes use `requireAuth("VIEWER")`.

---

## Seed Data & Docker

Spec JSONs in `docs-archive/bdd-specs/` are seed data only. After seeding, DB owns the data.

```bash
docker build .                    # runner — minimal server.js for production
docker build --target seed .      # seed — full codebase for DB init
docker build --target migrate .   # migrate only
```

Runner image CANNOT run seeds — use seed target or SSH tunnel. Docker NOT available locally or on VM — use Cloud Build.

---

## Cloud Architecture (3 environments)

| Env | Domain | Cloud Run Service |
|-----|--------|-------------------|
| DEV | `dev.humanfirstfoundation.com` | `hf-admin-dev` |
| TEST | `test.humanfirstfoundation.com` | `hf-admin-test` |
| PROD | `lab.humanfirstfoundation.com` | `hf-admin` |

All public URLs route through Cloudflare Tunnel to separate Cloud Run services (europe-west2, Cloud SQL PostgreSQL 16). Full procedures in `docs/CLOUD-DEPLOYMENT.md`.

---

## Deploy Commands

**VM (hf-dev only — does NOT affect Cloud Run):**
- **`/vm-cp`** — commit + push + pull. Use for: components, pages, API routes, CSS, lib code, tests
- **`/vm-cpp`** — commit + push + migrate + pull + restart. Use for: Prisma schema, `next.config.ts`, `middleware.ts`, new deps, env vars

**Always state which command is needed at end of every change**, e.g. "Ready for `/vm-cp`" or "This needs `/vm-cpp` (migration)".

**Cloud Run:** Use `/deploy` (interactive menu — asks env, handles Cloud Build + seed + Cloudflare cache purge) or `/deploy-check` for pre-flight validation.
