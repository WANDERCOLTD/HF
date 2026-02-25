# CLAUDE.md

> **Configuration over Code. Database over Filesystem. Evidence over Assumption. Reuse over Reinvention.**
>
> **Plan creatively. No hardcodes. qmd + graph. Gold UI. Wizards must flow.**

@/Users/paulwander/projects/skills/dev-principles-SKILL.md
@/Users/paulwander/projects/skills/hf-nextjs-patterns-SKILL.md

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

## Plan Guards (MANDATORY — Every Coding Plan)

**Before writing any code** (pre-plan) AND **before declaring done** (post-plan), walk through every guard below. Flag violations explicitly. Do not skip guards because "it's a small change."

### The 13 Guards

| # | Guard | PRE-PLAN check | POST-PLAN check |
|---|-------|----------------|-----------------|
| 1 | **Dead-ends** | Will every computed value surface in UI or API? Trace the data path. | Trace every new value from creation → storage → retrieval → display. If it dead-ends, flag it. |
| 2 | **Forever spinners** | Does the plan include loading, error, AND empty states for every async op? | Every `useState` loading flag, every `useTaskPoll`, every fetch has: timeout, error fallback, empty state. No unbounded waits. |
| 3 | **API dead ends** | Every planned API route has at least one caller. Every planned fetch targets an existing route. | Verify: new routes are called somewhere. New fetch calls target routes that exist. No orphan endpoints. |
| 4 | **Routes good** | Every new `route.ts` has `requireAuth()` or is documented as public/webhook-secret. | Check every new/modified `route.ts` — auth present, correct role level, correct HTTP methods. |
| 5 | **Escape routes** | Can the user cancel, go back, or dismiss every new modal/wizard/dialog/loading state? | Every modal has close/X. Every wizard has back + cancel. Every loading state has abort or timeout. User is never trapped. |
| 6 | **Gold UI** | Plan uses `hf-*` CSS classes, not inline styles. Colors reference CSS vars. | No new inline `style={{}}` for anything with a CSS class. No hardcoded hex. `FieldHint` on wizard intent fields. |
| 7 | **Missing await** | — | Every async call (`ContractRegistry`, `prisma`, `fetch`, DB queries) has `await`. |
| 8 | **Hardcoded slugs** | — | No string literals for spec slugs — all through `config.specs.*`. |
| 9 | **TDZ shadows** | — | No `const config = ...` when `config` is imported. Use `specConfig` or another name. |
| 10 | **Pipeline integrity** | Does the change affect data flow through the adaptive loop? If yes, plan accounts for all stages (EXTRACT → AGGREGATE → REWARD → ADAPT → COMPOSE). | New data flows through the complete loop. No stage skipped. |
| 11 | **Seed / Migration** | Does the plan need schema changes? Flag `/vm-cpp` requirement early. New enum values, new models, new fields = migration. | Migration created if needed. Seed scripts updated if new reference data. State which deploy command is needed. |
| 12 | **API docs** | — | If any `route.ts` was created or modified, `@api` JSDoc annotations are updated. Note to run generator. |
| 13 | **Orphan cleanup** | — | No unused imports, dead components, orphan CSS classes, or leftover code from removed features. |

### How to apply

- **Pre-plan:** After designing the plan but before writing code, scan guards 1-6 and 10-11. These catch architectural mistakes that are expensive to fix later.
- **Post-plan:** After all code is written, scan ALL 13 guards. Report findings as a checklist with pass/flag status.
- **Format:** End every completed plan with a guard report:
  ```
  ## Plan Guards
  1. Dead-ends: PASS — all values surface in [component]
  2. Forever spinners: PASS — loading/error/empty states in [files]
  ...
  13. Orphan cleanup: PASS — no dead imports
  ```

---

## UI Design System (Zero Tolerance)

No inline `style={{}}` for anything that has a CSS class. No hardcoded hex. No one-off styling.

### Admin Pages (`/x/**`) — `hf-*` classes

- Page titles: `hf-page-title` | Subtitles: `hf-page-subtitle`
- Cards: `hf-card` (radius 16, padding 24) | `hf-card-compact`
- Inputs: `hf-input` | Buttons: `hf-btn` + `hf-btn-primary` / `hf-btn-secondary` / `hf-btn-destructive`
- Banners: `hf-banner` + `hf-banner-info` / `hf-banner-warning` / `hf-banner-success` / `hf-banner-error`
- Full list: `hf-page-title`, `hf-page-subtitle`, `hf-card`, `hf-card-compact`, `hf-section-title`, `hf-section-desc`, `hf-info-footer`, `hf-icon-box`, `hf-icon-box-lg`, `hf-label`, `hf-input`, `hf-btn`, `hf-spinner`, `hf-empty`, `hf-list-row`, `hf-banner`, `hf-category-label`
- **FieldHint popovers (MANDATORY)**: Every wizard intent field MUST use `<FieldHint>` with Why/Effect/Examples content. Hint data in `lib/wizard-hints.ts`. CSS: `hf-field-hint-*` classes in `globals.css`. Component: `components/shared/FieldHint.tsx`.

### Auth Pages (`/login/**`) — `login-*` classes

Dark navy/gold theme. Classes: `login-bg`, `login-card`, `login-form-card`, `login-input`, `login-label`, `login-btn`, `login-btn-secondary`, `login-error`, `login-text`, `login-icon-circle`, `login-footer`, `login-logo`

### Color Map (hex → CSS var)

| Hex | CSS Variable |
|-----|-------------|
| `#6b7280`, `#9ca3af` | `var(--text-muted)` |
| `#374151`, `#1f2937` | `var(--text-primary)` |
| `#f3f4f6`, `#f9fafb` | `var(--surface-secondary)` |
| `#e5e7eb`, `#d1d5db` | `var(--border-default)` |
| `#fff` | `var(--surface-primary)` |
| `#2563eb`, `#3b82f6` | `var(--accent-primary)` |
| `#ef4444`, `#dc2626` | `var(--status-error-text)` |
| `#10b981`, `#22c55e` | `var(--status-success-text)` |
| `#F5B856` | `var(--login-gold)` |
| `#1F1B4A` | `var(--login-navy)` |
| `#9FB5ED` | `var(--login-blue)` |

**Gold reference files:**
- Admin: `app/x/settings/settingsclient.tsx` + `app/x/account/page.tsx`
- Auth: `app/login/page.tsx` + `app/login/layout.tsx`

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
