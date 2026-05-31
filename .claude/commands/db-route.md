---
description: Pivot a Cloud Run service's DATABASE_URL binding between per-env secrets (sandbox / staging / pilot / prod) — atomic, reversible, no rebuild
---

Re-bind which secret a Cloud Run service reads for `DATABASE_URL`. Atomic — each invocation creates a new Cloud Run revision. Reversible in one command. **Does not change secret values** — only which secret the service consumes.

This is the cloud-side counterpart to `/db-switch` (which edits the VM's `.env.local`). The two together let you flexibly pivot ANY service at ANY DB without touching code or rebuilding images.

**Default state assumed (post-Phase-4):**

| Service | Default secret | DB |
|---|---|---|
| `hf-admin-dev` (STAGING) | `DATABASE_URL_STAGING` | `hf_staging` |
| `hf-admin-pilot` (PILOT, after Phase 5) | `DATABASE_URL_PILOT` | `hf_pilot` |
| `hf-admin-prod` (PROD, after Phase 6) | `DATABASE_URL_PROD` | `hf_prod` |

Switching to a NON-default binding is a **temporary debugging operation**. Always state the default at the end of the report so the user remembers to revert.

## Targets per service

| Service | Allowed pivot targets |
|---|---|
| `staging` (`hf-admin-dev`) | `sandbox`, `staging` (default), `pilot` (after Phase 5) |
| `pilot` (`hf-admin-pilot`) | `pilot` (default), `staging`, `sandbox` |
| `prod` (`hf-admin-prod`) | `prod` (default) — **all other targets REFUSED**, no override flag |

## Steps

### Step 0: Parse args

Invocations:

```
/db-route                                  → show current bindings for all cloud services
/db-route <service>                        → show current binding for one service
/db-route <service> <target>               → pivot <service> to read DATABASE_URL_<target>
```

Where `<service>` ∈ {staging, pilot, prod} and `<target>` ∈ {sandbox, staging, pilot, prod}.

### Step 1: Show current bindings (no-arg or single-arg form)

```bash
for svc in hf-admin-dev hf-admin-pilot hf-admin-prod; do
  binding=$(gcloud run services describe "$svc" --region=europe-west2 --project=hf-admin-prod \
    --format='value(spec.template.spec.containers[0].env[].valueFrom.secretKeyRef.name)' 2>/dev/null \
    | tr ';' '\n' | grep -E '^DATABASE_URL' | head -1)
  printf "  %-20s → %s\n" "$svc" "${binding:-<not configured>}"
done
```

Report as a table.

### Step 2: Refuse PROD as a target

If `<target>` is `prod` AND `<service>` is not `prod`, refuse with:

> ❌ Refused. Cannot pivot a non-prod service to read PROD's database. If you need to compare against prod data, use `/snapshot` to clone PROD → STAGING and inspect there.

### Step 3: Confirmation for non-default pivots

For `staging sandbox`:

> ⚠️ You are about to pivot the STAGING Cloud Run service (`hf-admin-dev`) to read `hf_sandbox` (the VM's DB).
> - Anyone hitting `dev.humanfirstfoundation.com` will see VM scratch data and your writes there will be visible to colleagues.
> - This is reversible in one command: `/db-route staging staging`.
> - The new Cloud Run revision is preserved — you can also `gcloud run services update-traffic` to roll back instantly.
>
> Confirm? (y/n)

For `staging pilot` (after Phase 5):

> 🚨 You are about to pivot the STAGING service to read PILOT's live tester data.
> - Read-only on the staging side is safe, but ANY write via the staging URL goes to pilot.
> - Consider `/snapshot pilot → staging` instead if you only need to inspect.
>
> Confirm with `yes-i-understand-pilot-is-live` (exact match):

For `pilot sandbox` (after Phase 5):

> Same warning shape — pilot service pointing at sandbox = pilot testers see VM scratch data.

For default-reverts (e.g. `staging staging`): no confirmation needed — restoring default is always safe.

### Step 4: Verify the secret exists

```bash
gcloud secrets describe "DATABASE_URL_$(echo $TARGET | tr a-z A-Z)" --project=hf-admin-prod >/dev/null 2>&1
```

If absent, abort with:

> ❌ Secret `DATABASE_URL_<TARGET>` does not exist. Has the env been provisioned yet?

### Step 5: Re-bind

```bash
SERVICE_NAME=$(case "$SERVICE" in
  staging) echo "hf-admin-dev" ;;
  pilot)   echo "hf-admin-pilot" ;;
  prod)    echo "hf-admin-prod" ;;
esac)

SECRET_NAME="DATABASE_URL_$(echo $TARGET | tr a-z A-Z)"

gcloud run services update "$SERVICE_NAME" \
  --region=europe-west2 --project=hf-admin-prod \
  --update-secrets="DATABASE_URL=${SECRET_NAME}:latest"
```

The `update-secrets` flag rewrites just the one binding. Cloud Run spins a new revision (typically <30s) and shifts 100% traffic to it. Old revision stays available for rollback via `update-traffic`.

### Step 6: Smoke against the direct Cloud Run URL

```bash
DIRECT_URL=$(gcloud run services describe "$SERVICE_NAME" --region=europe-west2 --project=hf-admin-prod --format='value(status.url)')
echo "=== smoke after re-bind ==="
curl -fsS "$DIRECT_URL/api/health"
curl -fsS "$DIRECT_URL/api/ready"
curl -fsS "$DIRECT_URL/api/system/readiness" | python3 -m json.tool | head -20
```

Verify:
1. All 3 return 200
2. `/api/system/readiness` shows `database.ok: true`
3. Schema-bound counts are non-zero (spec count, parameter count) — proves the new DB has data

If any fails, **revert immediately**:

```bash
gcloud run services update "$SERVICE_NAME" --region=europe-west2 --project=hf-admin-prod \
  --update-secrets="DATABASE_URL=DATABASE_URL_$(echo $SERVICE | tr a-z A-Z):latest"
```

…or roll back to the previous revision:

```bash
gcloud run revisions list --service="$SERVICE_NAME" --region=europe-west2 --project=hf-admin-prod --limit=3
gcloud run services update-traffic "$SERVICE_NAME" --to-revisions=<previous-revision>=100 \
  --region=europe-west2 --project=hf-admin-prod
```

### Step 7: Report

Tell the user:
1. What was pivoted (`<service>` → `<target>` secret/DB)
2. The new Cloud Run revision name (from step 5 output)
3. **Reminder of the default** and how to revert: e.g. "Default for STAGING is `staging`. Revert with `/db-route staging staging`."
4. For non-default pivots: a one-line reminder that VM ↔ cloud isolation is collapsed until reverted.

## Hard rules

- **Never** pivot any service to PROD's DB unless the service IS prod. No flag, no override.
- **Never** pivot PROD's service to a non-prod DB. (Would route real users' traffic at sandbox — catastrophic.) Refuse without a confirmation flow.
- **Always smoke** after re-bind, before reporting success.
- **Always state the default** in the report so the user knows what to revert to.
- This skill **does NOT modify secret VALUES** — only which secret a service reads. To rotate a secret's value, use `gcloud secrets versions add` directly.

## Status-bar chip behaviour

The bottom-status chip (`STAGING · DB:sandbox`) and avatar ring derive from `useDbState()` in `components/shared/EnvironmentBanner.tsx`, which fetches `/api/system/db-target` on mount. That endpoint reads the **runtime** `DATABASE_URL` (server-side) and returns the live DB target. So after a `/db-route` re-bind:

1. The new Cloud Run revision is serving traffic (< 30s after the gcloud call).
2. The browser hits any HF page → React mounts → `useDbState()` fetches → chip flips to the live target within ~1 fetch tick.
3. If a stale tab is open, the chip will still show the old value until the next page navigation (the hook only fetches on mount).

If a chip stuck on the wrong value isn't updating, force-reload the tab — the fetch only runs on mount. The Cloudflare cache doesn't cover `/api/system/db-target` (the route is `dynamic = 'force-dynamic'`), so a hard reload is enough.

Historical note: pre-2026-05-31, the chip read `process.env.NEXT_PUBLIC_DB_TARGET` which is build-baked into the client bundle and could not follow a `/db-route` re-bind. The runtime endpoint + `useDbState()` hook fixed this.

## Related

- `/db-switch` — sibling skill for editing the VM's `.env.local` DATABASE_URL
- `/snapshot` — clone DBs between envs (read-only alternative to live pivoting)
- Issue #726 — env rename epic (Phase 4 = staging cutover; Phase 5 = pilot provisioning; Phase 6 = prod)
- Memory: `monday-plan-phase4-db-cutover.md` — the plan that introduces this skill
