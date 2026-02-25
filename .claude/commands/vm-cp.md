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

## 5. Pull on VM

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF && git stash 2>/dev/null; git pull --rebase && git stash pop 2>/dev/null; cd apps/admin && npm install --prefer-offline"
```

If the SSH command fails with exit code 255, wait 3 seconds and retry once.

Report what changed on the VM.

## 6. Re-seed if needed

Check if any seed files were modified in the commit. If prisma/seed*.ts or prisma/schema.prisma changed, run:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx prisma/seed-full.ts"
```

If no seed files changed, skip this step and tell the user.

## 7. Restart dev server

Kill existing server, clean .next lock, and start fresh:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "killall -9 node 2>/dev/null; fuser -k 3000/tcp 2>/dev/null; fuser -k 3001/tcp 2>/dev/null; fuser -k 3002/tcp 2>/dev/null; sleep 1; rm -rf ~/HF/apps/admin/.next/dev/lock; echo CLEANED"
```

Wait 5 seconds for IAP cooldown, then start the server:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "nohup bash -c 'cd ~/HF/apps/admin && npx next dev --port 3000' > /tmp/hf-dev.log 2>&1 & echo STARTED"
```

Wait 5 seconds, then kill stale local tunnels and open new one:

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; sleep 1
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- -L 3000:localhost:3000 -N
```

Run the tunnel in the background. Report success: committed, pushed, pulled, restarted at localhost:3000.
