# CLAUDE.md

> **Configuration over Code. Database over Filesystem. Evidence over Assumption. Reuse over Reinvention.**
>
> **Plan creatively. No hardcodes. qmd + graph. Gold UI. Wizards must flow.**

Skills auto-loaded from `.claude/skills/`. Path-scoped rules in `.claude/rules/`.

---

## 🤖 Proactive Agent Team — MANDATORY

**You are the developer in an Agile team. The PM (user) describes intent; you run the team.**

### Recognise building intent — intercept BEFORE coding

When the user says anything matching these patterns, **STOP and run the BA + Tech Lead agents first**:

| User says | What to do |
|-----------|-----------|
| "Let's build a course on [topic]" / proposes a NEW COURSE topic | Run `course-architect` FIRST (upstream of BA/TL). Returns a brief; THEN run BA + Tech Lead with the brief as input. |
| "I'm going to build / implement / add / create [X]" | Run BA + Tech Lead on X |
| "Let's do [feature]" / "Time to work on [feature]" | Run BA + Tech Lead on feature |
| "Can you build / code / write [X] for me" | Run BA + Tech Lead on X |
| "Start on [feature]" / "Work on [feature]" | Run BA + Tech Lead on feature |
| Pastes a spec/doc and says "implement this" | Run BA + Tech Lead on the spec |

**Exception:** If the user references an existing GitHub issue number (e.g. "work on #12"), skip BA/TL — it's already groomed.

**Course Architect skip rules:** Skip `course-architect` if (a) the user already has an approved Course Architect brief in hand, (b) the work is editing an existing course's modules/LOs (BA + Tech Lead handle that), or (c) the work is engineering, not curriculum.

### The interception flow

```
1. Detect building intent (patterns above)
2. Say: "Before we start coding — let me run a quick check."
3. Spawn **reuse-finder** + **BA** in parallel → reuse-finder maps existing code; BA waits for the brief, then drafts/finds the GitHub issue with **Already exists** pre-populated
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
| "End of sprint" / "Sprint review" | Run retro-bot + velocity-tracker agents |
| Fix chain detected (3+ fix: commits on same topic) | Flag it, run `root-cause` agent, create a story |
| About to commit | Run `scope-enforcer` — one concern per commit |
| Prompt file changed (`*system-prompt*`, `chat/route.ts`, `lib/prompt/**`) | Run `prompt-diff` — flag risk, identify evals needed. **Enforce:** update/create promptfoo eval covering the change (`evals/wizard/v5-*.yaml`) |
| `prisma/schema.prisma` changed | Run `migration-checker` before any `migrate dev` |
| "Something broke in prod" / production incident | Run `post-mortem` agent |
| "Is memory up to date?" / after major refactor | Run `memory-sync` agent |
| "Clean up" / before sprint planning / monthly | Run `broken-windows` agent |
| Making a significant architectural decision | Use `/adr` to record it in `docs/decisions/` |

### Definition of Done (every story)

- [ ] All acceptance criteria checked off
- [ ] `qa-engineer` agent run (vitest + promptfoo evals if applicable)
- [ ] `guard-checker` agent run (all 15 guards)
- [ ] `standards-checker` agent run — READY TO MERGE verdict
- [ ] `/check` passes (tsc + lint + tests)
- [ ] Issue closed on GitHub

---

## ⚠️ MANDATORY: Branch Hygiene — never work on `main`

**Before the first edit of any non-trivial change, create a feature branch.** Working directly on `main` causes clashes with `/vm-cp`, breaks deploy flows, and pollutes history with mid-task state.

```bash
git checkout -b fix/<issue#>-<slug>      # bug fix
git checkout -b feat/<issue#>-<slug>     # feature
git checkout -b chore/<slug>             # tooling, docs, deps
```

Naming: include the GitHub issue number when one exists (e.g. `fix/202-call-playbook-stamping`). PR title and commit body reference the issue with `Closes #N`.

**Trivial changes that may stay on main:**
- A single-line typo fix
- README/CLAUDE.md edits with no code

**Everything else gets a branch.** That includes "small" bug fixes touching one file — they often grow.

If you discover work has started on `main`, stop and move it: `git checkout -b <name>` carries uncommitted changes onto the new branch and leaves `main` clean. Do this before continuing.

---

## ⚠️ MANDATORY: No concurrent claude sessions on this working tree

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `.claude/settings.json` and multiple terminal `claude` processes can land in `/Users/paulwander/projects/HF` simultaneously. They all share **one** `.git/` directory — `git checkout` is process-wide, so any peer's branch switch silently moves HEAD for everyone. Observed live during PR #836 / #838 / #839 (2026-05-25): branch was swapped under the active session 4 times in one sitting; commits landed on the wrong branch twice; recovery cost ~30 min.

**Rules:**

1. **Check at session start.** The `SessionStart` hook prints `🚨 N concurrent claude processes detected` when peers exist, and also reports the working-tree lock role (PRIMARY / SECONDARY / RECLAIMED). Treat the SECONDARY banner as a hard signal — destructive git in this tree will be blocked.
2. **`PreToolUse:Bash` runs two hooks:** `branch-drift-detector.sh` (warn-only, fires on unexplained HEAD swap between tool calls) and `git-lock-enforcer.sh` (hard block on destructive git from secondary sessions — `checkout`, `switch`, `reset --hard`, `pull`, `merge`, `rebase`, `stash pop/apply/drop`, `clean`, `branch -f/-D`, `push --force`). Read-only git (`status`, `log`, `diff`, `branch`, `rev-parse`, `fetch`) and all non-git commands always pass.
3. **All concurrent sessions MUST use worktrees.** Three layers enforce this:
   - **`~/.zshrc` `claude` shell wrapper (2026-06-07):** typing `claude` inside `~/projects/HF` (main tree) auto-creates `~/projects/HF-wt-<branch>` via `git worktree add` and `cd`s there before exec'ing the real binary. No flags, no friction — this is the path of least resistance. Source: `~/.zshrc`. Per-session opt-out: `HF_FORCE_SHARED_TREE=1 claude` (skips both the wrapper and the SessionStart block).
   - **Harness SessionStart block (#904):** if the wrapper is bypassed and a peer is already alive, `session-start.sh` exits 2 with a `git worktree add ../HF-myrole feat/your-branch && cd ../HF-myrole` instruction before the session reaches its first tool call.
   - **PreToolUse `git-lock-enforcer.sh` (#849):** defence-in-depth for anything that slips past the first two — blocks destructive git from secondary sessions sharing a tree.

   When you spawn peer agents that touch code, use `isolation: "worktree"` on the `Agent` tool — the agent gets its own `git worktree add ../HF-feat-X feat/X-…` checkout, lock-keyed on `git rev-parse --show-toplevel`, so every worktree is its own PRIMARY slot.

   **Agent-worktree GC:** The Agent tool's contract auto-deletes the worktree only if the agent made no changes. Productive agents leave their worktree behind; across many sessions these pile up under `.claude/worktrees/agent-*` (21 GB observed 2026-06-10, 14 of 17 zombies). Run `bash scripts/cleanup-agent-worktrees.sh --dry-run` after a PR-closing session to see what's GC-able; drop `--dry-run` to actually remove (script keeps `main`, OPEN PRs, and no-PR branches; only removes MERGED/CLOSED). The SessionStart hook nudges when the count exceeds 6.
4. **Operator override (one-shot, per command):** export `HF_FORCE_GIT=1` before the blocked git command. Use only when you have confirmed the peer is finished or you accept the HEAD-swap risk.
5. **Recovery when drift hits anyway:**
   - `git stash --include-untracked -m '<work-description>'`
   - `git reflog | head -10` — find your last known-good HEAD (the one *before* the unexplained `checkout: moving from X to Y`)
   - `git branch -f <correct-branch> <commit>` and `git checkout <correct-branch>`
   - `git stash pop` — should apply cleanly since the working tree is at the expected base
6. **Don't shell out to `pkill claude` to fix this.** Peer sessions may be doing legitimate work the operator launched intentionally. Ask before killing.

Memory: [feedback_concurrent_claude_processes.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_concurrent_claude_processes.md), [feedback_concurrent_claude_pidlock_design.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_concurrent_claude_pidlock_design.md).

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

**qmd auto-sync (local only):** Git hooks keep qmd fresh — `pre-commit` updates before commit, `post-commit` + `post-merge` run `qmd embed` synchronously (~30s) after the ref lands. Not needed on hf-dev VM. **`gh pr merge --squash` bypasses `post-merge` entirely** — run `qmd embed` manually after large remote merges (or after any squash-merge that brings in new docs / specs).

---

## ⚠️ MANDATORY: The Lattice — survey before you touch it

**The Lattice** is HF's umbrella for four interlocked guard systems: **Chain Contracts** (cross-stage invariants — [`docs/CHAIN-CONTRACTS.md`](./docs/CHAIN-CONTRACTS.md)) × **Guards** (ESLint rules — [`docs/kb/guard-registry.md`](./docs/kb/guard-registry.md)) × **Cascade** (effective-value resolvers — `apps/admin/lib/cascade/`) × **Rules** (`.claude/rules/*.md`).

**Before writing OR modifying any code that mutates a shared DB column, crosses a chain-stage boundary, registers a new guard/contract, or extends an AI write/read path, you MUST run the 60–90 second sibling-writer survey** in [`.claude/rules/lattice-survey.md`](./.claude/rules/lattice-survey.md).

The survey: identify the surface → map every existing writer/reader (qmd + grep) → read the contract catalogues row-by-row → cross-check the 4 classic risk shapes (sibling-writer drift, default-deny gates, cascade respect, convention conflict) → decide convergence → only then write.

Skipping the survey is how the 2026-06-16 #1703 fingerprint happened — three contract risks introduced silently in a single helper because no one mapped sibling writers first. Every PR's `## Verified by` section MUST cite the survey result for code that touches the Lattice.

---

## ⚠️ MANDATORY: You CAN hit authenticated API routes via the VM

**Do not say "I can't authenticate"** — you can. The hf-dev VM has seeded SUPERADMIN credentials (`admin@test.com` / `admin123`) on the local DB and can mint a next-auth session cookie via curl. Use this whenever you need to verify a session-gated endpoint without asking the operator to load it in the browser.

```bash
# Run on hf-dev VM (via gcloud compute ssh or SSH command block).
COOKIES=/tmp/hf-cookies.txt
CSRF=$(curl -sS -c $COOKIES http://localhost:3000/api/auth/csrf | python3 -c 'import sys,json; print(json.load(sys.stdin)["csrfToken"])')
curl -sS -b $COOKIES -c $COOKIES \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@test.com&password=admin123&csrfToken=$CSRF&callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F&json=true" \
  -X POST http://localhost:3000/api/auth/callback/credentials -o /dev/null
# Now $COOKIES contains authjs.session-token — reuse it for every subsequent curl.
curl -sS -b $COOKIES http://localhost:3000/api/callers/<id>/learning-trajectory | python3 -m json.tool
```

The cookie is good for ~30 days (NextAuth default). Re-mint when an SSH session needs one.

**For server-to-server routes** (those that handle `x-internal-secret` themselves — e.g. `/api/calls/[callId]/pipeline`, `/api/test-harness/run-sim`), use the `INTERNAL_API_SECRET` from the VM's `.env` as the `x-internal-secret` header — no session cookie needed. `scripts/sim-drive-call.ts` uses this pattern.

If a route doesn't check `x-internal-secret` and isn't on the public allowlist, use the credentials-cookie flow above. Both paths bypass the "I can't access it" trap.

---

## Debugging — verbose voice diagnostics (`VOICE_DIAG_VERBOSE`)

The voice path has a three-tier observability model documented in `lib/voice/diag.ts`:

1. **Audit** (always on) — `FailureLog` + `log()` to `AppLog`
2. **Operator-visible** (always on) — structured detail in error responses (e.g. `vapiDetails: string[]` on the outbound-dial 502 → modal toast)
3. **Verbose voice-trace** (OFF in prod by default) — gated on env-var `VOICE_DIAG_VERBOSE=1`

**When to flip ON for an incident:** silent VAPI rejection with no actionable error in the modal, schema drift suspected, WebRTC `[Talk Here]` failing before mic-permission, "end-of-call never landed" reports.

**Dump sites today:** `voice.outbound_dial.assistant_payload` (PSTN), `voice.calls_start.assistant_payload` (WebRTC), `voice.webhook.body` (every inbound webhook arrival). All strip `model.secret` before emit.

**Flip ON:**
- Local: `VOICE_DIAG_VERBOSE=1 npm run dev`
- hf-dev VM: append to `~/HF/apps/admin/.env.local`, restart `next dev`
- Cloud Run: `gcloud run services update <svc> --region=europe-west2 --set-env-vars VOICE_DIAG_VERBOSE=1`

**Flip OFF:**
- Cloud Run: `gcloud run services update <svc> --remove-env-vars VOICE_DIAG_VERBOSE`
- VM: `sed -i "/^VOICE_DIAG_VERBOSE=/d" .env.local` + restart

**View the dumps:**
- VM: `tail -200 /tmp/hf-dev.log | grep -E "assistant_payload|webhook.body"`
- Cloud Run: `gcloud run services logs read <svc> --region=europe-west2 --limit=100 | grep voice.outbound_dial`
- `/x/logs` admin UI: filter subject contains `voice.outbound_dial.assistant_payload` etc.

**After the incident: flip OFF.** The verbose tier writes structured records to `AppLog` on every voice call — high signal, but log volume scales with traffic. Cost when off: one `process.env === "1"` compare per call site (effectively zero).

To extend the verbose tier with a new dump point, call `voiceDiagDump(subject, payload)` from `lib/voice/diag.ts` — same env-var gate, same no-op-when-off semantics.

---

## Reference Docs (read before re-reading code)

These memory files are kept in sync with the codebase. Consult them first.

| Doc | Contents | Update when |
|-----|----------|-------------|
| [memory/entities.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/entities.md) | Entity hierarchy, canonical file map, terminology | Schema migration, new model or relation |
| [memory/holographic.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/holographic.md) | 8 sections, state shape, permissions, Phase 2 pattern | Section added/changed, new Phase 2 component |
| [memory/async-patterns.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/async-patterns.md) | useTaskPoll / useAsyncStep / WizardShell / spinner-vs-glow | New hook, polling pattern, wizard framework change |
| [memory/extraction.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/extraction.md) | DocumentTypes, resolution chain, ContentAssertion shape, trust levels | New DocumentType, extraction category, new resolveExtractionConfig caller |
| [`docs/glossary-skills-mastery.md`](./docs/glossary-skills-mastery.md) | Canonical vocab: Course/Source/Skill/LO/TP/Mastery. Educator label ↔ DB shape. Surfaced at `/x/help/glossary`. | New entity in the 7 layers; UI label change; new tier scheme; new mastery store |
| [`docs/DR-POSTURE.md`](./docs/DR-POSTURE.md) | RPO/RTO targets, top-8 disaster scenarios + runbook links, known unmitigated risks (single-region, GDPR §17 re-emergence, unguarded `gcloud run jobs execute`), cross-region trigger event | DR target changes; new scenario added; drill RTO re-measured; PROD provisions |

### Hard-prereq contract docs (read before touching the surface)

| Doc | Read before touching |
|-----|----------------------|
| [`docs/CHAIN-CONTRACTS.md`](./docs/CHAIN-CONTRACTS.md) | Any code crossing an adaptive-loop stage boundary (EXTRACT, AGGREGATE, REWARD, ADAPT, SUPERVISE, COMPOSE). |
| [`docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`](./docs/CONTRACTS-PLAYBOOK-CURRICULUM.md) | Any code that writes/reads `Curriculum`, `PlaybookCurriculum`, `CurriculumModule`, or any `CallerAttribute` keyed by `curriculum:` or `playbook:`. Active during Epic #1177 collapse. |

### Flow Maps (call chains — consult before tracing logic)

| Doc | Contents | Update when |
|-----|----------|-------------|
| [memory/flow-prompt-composition.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-prompt-composition.md) | CompositionExecutor → loaders → transforms → assembly → persistence | New transform, loader, or section definition change |
| [memory/flow-pipeline.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-pipeline.md) | 7-stage pipeline: EXTRACT → ... → COMPOSE, data flow between stages | Pipeline stage added/changed, new spec runner |
| [memory/flow-call-lifecycle.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-call-lifecycle.md) | Call start → VAPI → transcript → pipeline → recomposition | VAPI webhook change, new call source, sim runner change |
| [memory/flow-goal-tracking.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-goal-tracking.md) | Goal measurement → reward → adaptation → guidance generation | New goal type, progress calc change, adaptation rule change |
| [memory/flow-journey-stops.md](~/.claude/projects/-Users-paulwander-projects-HF/memory/flow-journey-stops.md) | Auto-include stops wrapping teaching sessions, contract, student nav | Stop type added/changed, survey config change, journey-position logic change |

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

Teachers never see Playbooks, Specs, or Roles. All UI is organized by educator intent. System auto-scaffolds when readiness checks fail.

### SpecRole Taxonomy & Pipeline Details

See `.claude/rules/pipeline-and-prompt.md` (auto-loaded for pipeline/prompt files).

---

## Commands

All commands run from `apps/admin/` unless noted.

### Health & Status
```bash
npm run ctl ok           # Quick health check (git, types, MCP, server)
npm run ctl check        # Full checks: lint → tsc → unit → integration → FK consistency (slug-scope #407 / #415)
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

Search npm before hand-rolling. Key packages: `jsonrepair`, `p-retry`, `p-limit`, `slugify`, `papaparse`, `fuse.js`, `croner`. Full table in `.claude/skills/dev-principles/SKILL.md`.

---

## Plans: Intent-First Design (MANDATORY)

Every plan must address all three lifecycle phases: **Setup** (first-time config), **Maintenance** (edit/monitor over time), **Runtime** (end-user moment-to-moment). UI-touching plans MUST include ASCII mockups — draw it, don't describe it.

Run `plan-reviewer` agent before presenting a plan for approval. It checks phases, mockups, and the intent checklist.

---

## Plan Guards (MANDATORY)

Run `guard-checker` agent:
- **Pre-plan:** guards 1-6, 10-11 (architectural — catch mistakes early)
- **Post-plan / pre-commit:** all 15 guards

Guard definitions in `.claude/agents/guard-checker.md`. Always end a completed story with a guard report.

---

## UI Design System (Zero Tolerance)

See `.claude/rules/ui-design-system.md` (auto-loaded for UI files). After any UI changes, run `ui-reviewer` + `ux-reviewer` agents.

---

## RBAC

See `.claude/rules/rbac.md` + `.claude/rules/api-conventions.md` (auto-loaded for API files).

---

## AI Guards (read-side + write-side)

See `.claude/rules/ai-to-db-guard.md` (validate-then-write — AI output driving DB mutations) + `.claude/rules/ai-read-grounding.md` (verify-then-claim — AI text asserting facts about specific entities; #1444 contract + `factual-grounding-intercept.ts`).

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
