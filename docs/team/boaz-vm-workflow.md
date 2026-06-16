# Boaz — VM workflow from your local machine

The **hf-dev VM** (Google Cloud) is where code, DB, and dev server converge for live testing. Your **local machine** is where you edit + test units + push branches. You never run `npm run dev` locally — the VM is the single dev runtime everyone shares.

All `/vm-*` slash commands are project-scoped (live in `.claude/commands/`). Run them inside a `claude` session in your worktree. They do `gcloud compute ssh hf-dev …` under the hood — you need gcloud auth + IAP permissions on the VM (you should already have these as a team member).

---

## ⚠️ UPDATE YOUR LOCAL FIRST (before starting your next story)

Main has moved several times since you last pushed #1702. **Do this before opening your next worktree** for #1704 or any new story:

```bash
# 1. From your main HF tree (NOT a worktree)
cd ~/projects/HF
git checkout main
git pull --ff-only

# 2. Verify you have the recent merges:
git log --oneline -8
#    Expect to see (most-recent first):
#      ... — #1701 G8 settings (#1719)         ← Paul
#      ... — Lattice survey rule (#1722)       ← Paul, NEW — read this!
#      ... — #1702 segmentKey (#1739)          ← YOU
#      ... — Migration bundle A/B/C/D (#1714)  ← Paul
#      ... — #1703 incomplete-attempts (#1741) ← Paul, ships AuthoredModuleSettings type
#                                                  you'll need for #1704

# 3. READ the Lattice rule (mandatory discipline for all DB-touching work):
less .claude/rules/lattice-survey.md
#    The pre-coding sibling-writer survey is now MANDATORY for any code
#    that mutates shared DB columns, crosses chain-stage boundaries,
#    registers new guards, or extends AI write/read paths.

# 4. Re-install deps in case anything changed:
cd apps/admin && npm install --prefer-offline

# 5. Regenerate Prisma client (Migration B added incompleteAttempts —
#    your local Prisma client may not know about it):
npx prisma generate

# 6. Refresh the hf-dev VM (now possibly several commits behind):
#    (open a claude session in ~/projects/HF first if not already in one)
/vm-pull

# Now you're synced. New worktree for #1704:
cd ~/projects/HF
git worktree add ~/projects/HF-1704 -b feat/1704-theme10-profile-capture origin/main
```

**Specifically — `AuthoredModuleSettings` type** (the typed shape for the G8 module-scoped settings keys) lives in `apps/admin/lib/types/json-fields.ts` after #1741 lands. Your #1704 work extends it with `profileFieldsToCapture` — paste-snippet ready in the comment posted on the parent issue #1700.

---

## 1. Initial setup (one-time)

1. `gcloud auth login` (if not already done) — confirms your Google account has IAP access to the hf-dev VM.
2. `gcloud config set project <hf project id>` — ask Paul for the project id.
3. `cd ~/projects/HF && git pull origin main` — local main on the latest.
4. `cd apps/admin && npm install` — populates `node_modules` (the worktrees symlink to this).

## 2. Start a new story (always)

5. **Pull main first:** `cd ~/projects/HF && git fetch origin && git checkout main && git pull --ff-only`
6. **Create your worktree** (mandatory — CLAUDE.md rule, never work on main):
   ```bash
   git worktree add ~/projects/HF-<story> -b feat/<issue#>-<slug> origin/main
   ```
   Example for the next story: `git worktree add ~/projects/HF-1704 -b feat/1704-theme10-profile-capture origin/main`
7. `cd ~/projects/HF-<story>/apps/admin && ln -s ~/projects/HF/apps/admin/node_modules node_modules` — symlink shared deps (saves 2-3 min reinstall).
8. **Start claude in the worktree:** `cd ~/projects/HF-<story> && claude` — this is your isolated session for this story.

## 3. Refresh hf-dev VM (before you start editing, especially after main moves)

9. `/vm-pull` — pulls latest main on the VM and restarts the dev server.
   - Run this whenever Paul has merged a schema-touching PR (you'll see "🟢 migrations live" in the #1700 thread).
   - Run this any time you've been idle > 30 min — keeps your DB schema and Paul's `/vm-cpp` aligned.

## 4. Open the tunnel for browser testing

10. `/vm-tunnel` — opens `localhost:3000` proxied to the VM's port 3000.
    - Browse to `http://localhost:3000` (auto-redirects to `/login`).
    - Seeded SUPERADMIN credentials: `admin@test.com` / `admin123` (from CLAUDE.md).
    - **Only ONE tunnel can be open at a time on `localhost:3000`** — if Paul has one open, your `/vm-tunnel` will fail. Ask before stealing.

## 5. Edit + unit-test locally

11. Edit files in `~/projects/HF-<story>/apps/admin/...`.
12. Run unit tests locally — they're fast, don't need the VM:
    ```bash
    cd ~/projects/HF-<story>/apps/admin
    npx vitest run tests/lib/<your test file>.test.ts
    ```
13. Tsc check before push: `npx tsc --noEmit` (pre-push hook runs this anyway, but faster to catch early).

## 6. Push to GitHub + sync VM (code-only changes)

14. Stage + commit (use the Lattice-survey `## Verified by` template in PR body):
    ```bash
    git add <files>
    git commit -m "<conventional commit message>"
    ```
15. `/vm-cp` — commits any pending → pushes branch to origin → `gcloud compute ssh hf-dev` → pulls + restarts dev server. **Use this for ANY code-only PR (no schema change).**
16. Open the PR via `gh pr create --base main --head feat/<issue#>-<slug> --body-file pr-body.md`.

## 7. Migration / schema changes — DO NOT USE `/vm-cpp`

17. **Paul owns `/vm-cpp` on this VM.** Two devs running migrations on the same DB will race. If your story needs a schema change, ping Paul.
18. Workflow when you need schema:
    1. Edit `apps/admin/prisma/schema.prisma` locally.
    2. Hand-write the migration SQL: `apps/admin/prisma/migrations/<timestamp>_<issue#>_<slug>/migration.sql` (mirror the pattern in the most recent migration directory).
    3. `git add` + commit + push branch.
    4. Ping Paul to run `/vm-cpp` for you (or wait for him to merge + run it as part of his next cycle).
    5. After Paul confirms migration is live, `/vm-pull` your VM and continue.

## 8. View live logs on the VM (debugging)

19. SSH directly when needed:
    ```bash
    gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap
    ```
20. Inside the VM:
    ```bash
    tail -200 /tmp/hf-dev.log                     # general dev server output
    tail -200 /tmp/hf-dev.log | grep voice        # voice-related
    grep "module.incomplete" /tmp/hf-dev.log      # specific AppLog subjects
    ```
21. For AppLogs in the DB (durable record): browse `/x/logs` in your tunnelled browser. Filter by subject.

## 9. Hit authenticated API routes from your terminal (no browser needed)

22. From the VM:
    ```bash
    COOKIES=/tmp/hf-cookies.txt
    CSRF=$(curl -sS -c $COOKIES http://localhost:3000/api/auth/csrf | python3 -c 'import sys,json; print(json.load(sys.stdin)["csrfToken"])')
    curl -sS -b $COOKIES -c $COOKIES \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "email=admin@test.com&password=admin123&csrfToken=$CSRF&callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F&json=true" \
      -X POST http://localhost:3000/api/auth/callback/credentials -o /dev/null
    curl -sS -b $COOKIES http://localhost:3000/api/<your route> | python3 -m json.tool
    ```
    (CLAUDE.md "You CAN hit authenticated API routes" section — full pattern there.)

## 10. After PR merges

23. **Wait for Paul's "🟢 merged + live on hf-dev"** comment on the parent issue, OR if you merged your own:
    1. `/vm-cp` (it'll pull main + restart, even though there's nothing local to push)
    2. Smoke the live behaviour at `http://localhost:3000`
24. Clean up your worktree (don't have to, but tidy):
    ```bash
    cd ~/projects/HF && git worktree remove ~/projects/HF-<story>
    git branch -d feat/<issue#>-<slug>
    ```

## 11. Coordination rules — never break

25. **NEVER work on `main`** locally (CLAUDE.md branch hygiene). Always a feature branch in a worktree.
26. **NEVER run `/vm-cpp` if Paul might have a migration in flight.** Code-only PRs use `/vm-cp`. If you need schema, ping Paul.
27. **One tunnel at a time on `localhost:3000`.** If yours fails to open, Paul's probably has it.
28. **Run the Lattice survey before any code that touches `.claude/rules/lattice-survey.md` scope** (DB writes, chain-stage boundaries, new guards, AI write/read paths). Cite the survey result in your PR's `## Verified by` section.
29. **`git pull --rebase origin main`** before every `/vm-cp` — keeps your branch on top of Paul's recent merges.
30. **Status check before any session-start:** `gh pr list --state open --search "1700 in:body OR 1700 in:title"` shows what's in flight on the epic.

---

## Quick reference — commands

| Command | What |
|---|---|
| `/vm-pull` | Refresh VM from latest main + restart dev server |
| `/vm-cp` | Commit local → push → pull on VM → restart (code-only) |
| `/vm-tunnel` | Open SSH tunnel `localhost:3000` ↔ VM |
| `/vm-status` | Check VM CPU / RAM / disk / processes |
| `/vm-kill` | Kill stale node processes + clean .next on VM |
| `/vm-seed` | Run full seed (rare — usually only after destructive migration) |
| `gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap` | Direct SSH for log inspection |

---

## What "the code meets" means

The hf-dev VM is the **single shared dev runtime**. Your local edits become testable only after they land on the VM via `/vm-cp` (yours) or `/vm-cpp` (Paul's, for schema). The DB is the VM's Postgres. The dev server is the VM's `next dev`. The logs live on the VM filesystem.

Your local machine never runs the dev server — it's edit + push only. The tunnel makes the VM's `localhost:3000` accessible from your browser as if it were local.

When Paul says "🟢 merged + live on hf-dev" in a comment, that means his `/vm-cpp` has pulled + migrated + restarted, and the VM is at that commit. You `/vm-pull` to sync your VM (well — it's the same VM, so `/vm-pull` just refreshes the running process from origin main).

Right. One VM, two devs, code meets there. The `/vm-*` commands are the bridge.
