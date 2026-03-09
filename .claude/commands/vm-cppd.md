---
description: Commit + push + migrate + pull + restart on VM + quick deploy to DEV
---

Full pipeline: vm-cpp then quick deploy to DEV Cloud Run. No environment prompt — always DEV.

## 1. Check local status

```bash
git status --short
```

Show the user what's changed. If there are no changes, tell them and stop.

## 2. Auto version bump

```bash
cd apps/admin && npx tsx scripts/bump-version.ts
```

Report the version change. Stage the bumped `package.json`.

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

## 5. Pull + migrate + restart on VM (single SSH call)

First, check locally if seed files changed in the commit:

```bash
git diff --name-only HEAD~1 HEAD -- 'apps/admin/prisma/seed*.ts' 'apps/admin/prisma/schema.prisma'
```

Then run **everything in ONE SSH connection**. Build the bash script dynamically — include the seed block only if seed files changed above. The `set -e` ensures migration failures stop execution before restarting:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  set -e
  echo "==> Pulling..."
  cd ~/HF && git stash 2>/dev/null || true
  git pull --rebase
  git stash pop 2>/dev/null || true

  echo "==> Installing deps..."
  cd apps/admin && npm install --prefer-offline

  echo "==> Running migrations..."
  npx prisma migrate deploy

  # ONLY if seed files changed — include this block:
  # echo "==> Seeding..."
  # npx tsx prisma/seed-full.ts

  echo "==> Restarting dev server..."
  killall -9 node 2>/dev/null || true
  fuser -k 3000/tcp 2>/dev/null || true
  fuser -k 3001/tcp 2>/dev/null || true
  fuser -k 3002/tcp 2>/dev/null || true
  sleep 1
  rm -rf .next/dev/lock
  nohup npx next dev --port 3000 > /tmp/hf-dev.log 2>&1 &
  sleep 2
  echo "==> VM READY"
'
```

If the SSH command fails with exit code 255, wait 3 seconds and retry once.

If migrations fail (`set -e` will cause the script to exit), report the error and stop — do NOT continue to deploy.

Report what changed: pull results, migration output, seed status.

## 6. Open tunnel

Kill stale local tunnels and open a new one:

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; sleep 1
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- -L 3000:localhost:3000 -N
```

Run the tunnel in the background.

## 7. Build runner image via Cloud Build (on VM)

Build the DEV runner image on the VM (source is already pulled from step 5):

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  cd ~/HF/apps/admin && gcloud builds submit --config cloudbuild-runner.yaml \
    --project hf-admin-prod --region europe-west2 \
    --substitutions=_TAG=latest,_APP_ENV=DEV .
'
```

## 8. Deploy to DEV Cloud Run

```bash
gcloud run deploy hf-admin-dev \
  --image=europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-admin:latest \
  --region=europe-west2 --project=hf-admin-prod
```

## 9. Seed demo accounts (DEV always)

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash -c '
  cd ~/HF/apps/admin && gcloud builds submit --config cloudbuild-seed.yaml \
    --project hf-admin-prod --region europe-west2 \
    --substitutions=_TAG=latest .
'

gcloud run jobs update hf-seed-dev \
  --set-env-vars=SEED_PROFILE=full \
  --region=europe-west2 --project=hf-admin-prod
gcloud run jobs execute hf-seed-dev --region=europe-west2 --project=hf-admin-prod --wait
```

## 10. Smoke tests

```bash
APP_URL="https://hf-admin-dev-311250123759.europe-west2.run.app"
curl -f "$APP_URL/api/health"
curl -f "$APP_URL/api/ready"
curl -f "$APP_URL/api/system/readiness"
```

## 11. Cloudflare cache purge

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/a75655f1818c73eaaecc232b1076dbf3/purge_cache" \
  -H "X-Auth-Email: paul@thewanders.com" \
  -H "X-Auth-Key: 1422f925b4284c70c43a15fca3e08d10fdc9b" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

## 12. Deploy tagging

```bash
git tag -f deploy-dev-latest
git push origin deploy-dev-latest --force
git tag deploy-dev-$(date +%Y%m%d-%H%M%S)
git push origin deploy-dev-$(date +%Y%m%d-%H%M%S)
```

Report: committed, pushed, VM updated, DEV deployed, smoke tests passed.
