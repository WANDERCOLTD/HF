---
description: Commit locally + push + pull on VM
---

Commit local changes, push to remote, then pull on the hf-dev VM.

**NOTE:** This updates the hf-dev VM only (localhost:3000 via SSH tunnel). It does NOT deploy to Cloud Run environments (dev/test/prod). To deploy to `dev.humanfirstfoundation.com` etc., use `/deploy`.

## 1. Check local status

```bash
git status --short
```

Show the user what's changed. If there are no changes, tell them and stop.

**IMPORTANT:** Never pass `apps/admin/` as a git pathspec — bracket dirs like `[courseId]` are misread as globs, producing `could not open directory 'apps/admin/apps/admin/'` warnings. Use plain `git status --short` and `git diff --stat` without path filtering.

## 2. Auto version bump

```bash
cd apps/admin && npx tsx scripts/bump-version.ts
```

Report the version change (e.g. `Version: 0.5.0 -> 0.5.1`). Stage the bumped `package.json`.

## 3. Stage and commit

Show the diff summary (`git diff --stat`) so the user can see what's being committed.

Ask the user for a commit message using AskUserQuestion if none was provided as an argument ($ARGUMENTS).

Stage relevant files (avoid playwright-report, .env, credentials). Then commit:

```bash
git commit -m '<message>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'
```

## 4. Push

```bash
git push
```

If the push is rejected, suggest `git pull --rebase` first.

## 5. Pull + restart on VM (single SSH call)

First, check locally what changed in the commit:

```bash
git diff --name-only HEAD~1 HEAD -- 'apps/admin/prisma/seed*.ts' 'apps/admin/prisma/schema.prisma'
git diff --name-only HEAD~1 HEAD -- 'apps/admin/lib/**/*.ts' 'apps/admin/prisma/schema.prisma'
```

**Cache decision:** If `lib/**/*.ts` or `schema.prisma` changed, use `rm -rf .next` (full nuke — Turbopack caches stale module refs causing RSC payload leaks). Otherwise use `rm -rf .next/dev/lock` (lock only).

Then run **everything in ONE SSH connection**. Build the bash script dynamically:
- Include the seed block only if seed files changed
- Include `rm -rf .next` if lib/schema changed, otherwise `rm -rf .next/dev/lock`

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  set -e
  echo "==> Pulling..."
  cd ~/HF && git stash 2>/dev/null || true
  git pull --rebase
  git stash pop 2>/dev/null || true

  echo "==> Installing deps..."
  cd apps/admin && npm install --prefer-offline

  echo "==> Regenerating Prisma client..."
  npx prisma generate

  # ONLY if seed files changed — include this block:
  # echo "==> Seeding..."
  # npx tsx prisma/seed-full.ts

  echo "==> Restarting dev server..."
  killall -9 node 2>/dev/null || true
  fuser -k 3000/tcp 2>/dev/null || true
  fuser -k 3001/tcp 2>/dev/null || true
  fuser -k 3002/tcp 2>/dev/null || true
  sleep 1

  # If lib/schema changed: rm -rf .next
  # Otherwise: rm -rf .next/dev/lock
  rm -rf .next/dev/lock

  nohup npx next dev --port 3000 > /tmp/hf-dev.log 2>&1 &
  sleep 2
  echo "==> READY"
'
```

If the SSH command fails with exit code 255, wait 3 seconds and retry once.

Report what changed on the VM and whether seed ran.

## 6. Open tunnel

Kill stale local tunnels and open a new one:

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; sleep 1
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- -L 3000:localhost:3000 -N
```

Run the tunnel in the background. Report success: committed, pushed, pulled, restarted at localhost:3000.
