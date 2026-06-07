---
description: Switch the sandbox VM's DATABASE_URL between sandbox / staging / pilot (refuses prod)
---

Point the sandbox VM's `next dev` server at a different env's Cloud SQL database without redeploying. Used to verify a patch against real staging or pilot data before promoting.

**Sandbox is the canonical default.** Switching to staging or pilot is a *temporary debugging operation*. Switch back to sandbox as soon as you're done.

## Targets

| Target | Default? | Effect | Risk |
|--------|----------|--------|------|
| `sandbox` (`hf_sandbox`) | ✅ default | VM hits its own throwaway DB | none |
| `staging` (`hf_staging`) | no | VM writes are visible to anyone on `staging.humanfirstfoundation.com` | low — colleague-visible |
| `pilot` (`hf_pilot`) | no | **VM writes corrupt live tester data**. Use `prisma migrate deploy` only — never `migrate dev` or `devZZZ` | **high** |
| `prod` (`hf_prod`) | — | **REFUSED.** No override flag, no escape hatch | extreme |

## UI signals when switched

When the VM is pointing at a non-sandbox DB, every page shows:

1. **Browser tab title**: `[VM→PILOT]` or `[VM→STAGING]` (not the default `[VM]`)
2. **StatusBar ENV badge**: two-part chip `[SANDBOX | DB→PILOT]` — right half tinted target-env color (purple for pilot, blue for staging)
3. **UserAvatar**: colored ring around every avatar instance, tinted to match the DB target (purple = pilot, blue = staging)

The ring + chip use CSS vars per HF UI rules — no hardcoded hex.

## Steps

### Step 1: Ask which target

**Question:** "Which database should the sandbox VM point at?"
**Header:** "DB target"

Options:
1. **sandbox (Recommended, default)** — `hf_sandbox` — your own throwaway DB
2. **staging** — `hf_staging` — verify against staging data
3. **pilot** — `hf_pilot` — verify a patch against live tester data
4. **prod** — *refused, do not offer*

If the user types or picks `prod`, refuse:

> ❌ Refused. The sandbox VM cannot be pointed at production data. If you need to inspect prod data, clone PROD → STAGING via `/snapshot` and inspect there.

### Step 2: Confirmation (target-specific)

For `staging`:
> ⚠️ You are about to point the sandbox VM at the STAGING database (`hf_staging`).
> - Any writes from your dev server are visible to anyone hitting `staging.humanfirstfoundation.com`.
> - Avoid `npm run devZZZ`, `prisma migrate dev`, or any destructive script while pointed at staging.
> - The browser tab and avatar ring will show STAGING (blue) while switched.
>
> Confirm? (y/n)

For `pilot`:
> 🚨 You are about to point the sandbox VM at the PILOT database (`hf_pilot`).
> - **Pilot is LIVE TESTER DATA.** Any destructive op (migrate dev, devZZZ, manual deletes) corrupts data testers depend on.
> - Use `prisma migrate deploy` only — NEVER `prisma migrate dev` against pilot.
> - The browser tab + avatar will show PILOT (purple) while switched.
> - Stop the dev server before handing the environment to testers.
>
> Confirm with `yes-i-understand-pilot-is-live` (exact match):

Require the exact string match for pilot. Anything else: abort.

### Step 3: Resolve the new connection string

```bash
# Read the canonical DATABASE_URL for the target from Secret Manager
TARGET_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL_$(echo $TARGET | tr a-z A-Z) --project=hf-admin-prod)
```

If the secret doesn't exist (pilot before Phase 5, etc.), abort with a clear message:

> ❌ Secret `DATABASE_URL_PILOT` does not exist. Pilot infrastructure is provisioned in #726 Phase 5.

### Step 4: Update `.env.local` on the VM

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap --project=hf-admin-prod -- bash <<REMOTE
  set -e
  ENV_FILE=~/HF/apps/admin/.env.local
  # Backup
  cp "\$ENV_FILE" "\$ENV_FILE.bak-pre-switch-\$(date +%s)"
  # Rewrite DATABASE_URL line (or append if missing)
  if grep -q '^DATABASE_URL=' "\$ENV_FILE"; then
    sed -i 's|^DATABASE_URL=.*|DATABASE_URL="${TARGET_URL}"|' "\$ENV_FILE"
  else
    echo "DATABASE_URL=\"${TARGET_URL}\"" >> "\$ENV_FILE"
  fi
  # Set the DB target indicator (read by EnvironmentBanner.tsx + UserAvatar.tsx)
  if grep -q '^NEXT_PUBLIC_DB_TARGET=' "\$ENV_FILE"; then
    sed -i 's|^NEXT_PUBLIC_DB_TARGET=.*|NEXT_PUBLIC_DB_TARGET=${TARGET}|' "\$ENV_FILE"
  else
    echo "NEXT_PUBLIC_DB_TARGET=${TARGET}" >> "\$ENV_FILE"
  fi
REMOTE
```

When switching BACK to sandbox: same script, but `DATABASE_URL` reverts to `DATABASE_URL_SANDBOX` (the canonical sandbox secret post-2026-06-07 cutover) and `NEXT_PUBLIC_DB_TARGET=sandbox` (or remove the line entirely).

### Step 5: Restart the dev server

Same kill/start pattern as `/vm-dev`:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap --project=hf-admin-prod -- bash <<'REMOTE'
  set -e
  cd ~/HF/apps/admin
  killall -9 node 2>/dev/null || true
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 1
  rm -rf .next/dev/lock
  nohup npx next dev --port 3000 > /tmp/hf-dev.log 2>&1 &
  sleep 3
  echo "==> READY"
REMOTE
```

### Step 6: Verify

```bash
curl -s http://localhost:3000/api/system/readiness | python3 -m json.tool | head -20
```

Check that:
1. `database.ok` is `true`
2. `database.message` shows "Connected"
3. Spec count + parameter count are non-zero
4. Browser tab title now shows `[VM→PILOT]` or `[VM→STAGING]`

If readiness fails, switch back to sandbox immediately and investigate.

### Step 7: Report

Tell the user:
1. What was switched (target + DB name)
2. The reminder: "Switch back to sandbox with `/db-switch sandbox` as soon as you're done"
3. For pilot: re-emphasize "Do NOT run devZZZ or migrate dev"
4. For staging: re-emphasize "Colleagues see your writes at staging.humanfirstfoundation.com"

## Hard rules

- **Never** allow `prod` as a target. No flag, no override, no negotiation.
- **Never** run as part of a chained automation (`/vm-cp`, `/deploy`, etc.) — only as an explicit user-invoked command.
- **Backup `.env.local`** every time before edit (`*.bak-pre-switch-$timestamp`).
- **Verify readiness** before reporting success. A green readiness check is the success signal.

## Related

- `feedback_vm_default_db.md` (memory) — VM default DB history
- `/vm-dev` — default sandbox boot path
- `/snapshot` — clone DBs between envs (the alternative to live-switching for read-only inspection)
- Issue #726 — the rename + hotfix epic this skill is part of
