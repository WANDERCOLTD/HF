---
description: Database snapshot — clone environments, take/restore snapshots
---

Interactive guide for database snapshot operations. Supports cross-environment cloning and the existing JSON snapshot system.

## CRITICAL: Ask action first

**Question:** "What snapshot operation do you need?"
**Header:** "Snapshot"
**multiSelect:** false

Options:
1. **Clone environment (Recommended)** — Copy all data from one env to another (pg_dump | psql)
2. **Take snapshot** — Export current VM database to JSON file (layer-aware)
3. **Restore snapshot** — Import a JSON snapshot into VM database
4. **List snapshots** — Show available JSON snapshots

---

## Option 1: Clone Environment

Full database clone using `pg_dump | psql` via the hf-dev VM. All 3 databases are on the same Cloud SQL instance (`hf-db` at `172.23.0.3`), same credentials — only the database name differs.

### Database Map

| Env | Database Name |
|-----|---------------|
| DEV | `hf_dev` |
| TEST | `hf_test` |
| PROD | `hf` |

**Host:** `172.23.0.3` — **User:** `hf_user` — accessible from hf-dev VM (same VPC)

### Step 1: Ask source

**Question:** "Which environment to clone FROM?"
**Header:** "Source"

Options:
1. **TEST** — test.humanfirstfoundation.com (safe, recommended for dev work)
2. **PROD** — lab.humanfirstfoundation.com (real production data)

### Step 2: Ask target

**Question:** "Which environment to clone INTO? (this will REPLACE all data)"
**Header:** "Target"

Options:
1. **DEV (Recommended)** — dev.humanfirstfoundation.com (safe target)
2. **TEST** — test.humanfirstfoundation.com (only if cloning PROD → TEST)

**NEVER allow PROD as a clone target.** If the user picks PROD, refuse and explain why.

### Step 3: Confirm

Show a clear warning:
> **WARNING:** This will REPLACE ALL DATA in `$TARGET_DB` with a copy of `$SOURCE_DB`. This is destructive and cannot be undone. Existing data in the target will be lost.

Ask for explicit confirmation before proceeding.

### Step 4: Get credentials

Fetch the password from the VM's `.env.local`:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "grep DATABASE_URL ~/HF/apps/admin/.env.local | head -1 | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/'"
```

Store the password in a variable `$PW` for the next step.

### Step 5: Run clone

Use `$SOURCE_DB` and `$TARGET_DB` from the database map above:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "PGPASSWORD='$PW' pg_dump -h 172.23.0.3 -U hf_user -d $SOURCE_DB --clean --if-exists --no-owner --no-privileges | PGPASSWORD='$PW' psql -h 172.23.0.3 -U hf_user -d $TARGET_DB -q"
```

If SSH fails with exit code 255, wait 5 seconds and retry once.

For large databases, this may take 1-5 minutes. The `--clean --if-exists` flags drop and recreate tables safely.

### Step 6: Verify

Check row counts in the target database:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "PGPASSWORD='$PW' psql -h 172.23.0.3 -U hf_user -d $TARGET_DB -c \"
SELECT 'Specs' as entity, count(*) FROM \\\"BddFeature\\\"
UNION ALL SELECT 'Domains', count(*) FROM \\\"Domain\\\"
UNION ALL SELECT 'Callers', count(*) FROM \\\"Caller\\\"
UNION ALL SELECT 'Calls', count(*) FROM \\\"Call\\\"
UNION ALL SELECT 'Memories', count(*) FROM \\\"UserMemory\\\"
UNION ALL SELECT 'Users', count(*) FROM \\\"User\\\"
UNION ALL SELECT 'Migrations', count(*) FROM \\\"_prisma_migrations\\\";
\""
```

Report the counts to the user.

### Step 7: Re-seed demo logins (optional)

Cloned data won't have DEV-specific demo login accounts. Ask if the user wants to re-seed them:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && DATABASE_URL='postgresql://hf_user:$PW@172.23.0.3:5432/$TARGET_DB?schema=public' npx tsx prisma/seed-demo-logins.ts"
```

---

## Option 2: Take Snapshot (JSON)

Uses the existing layer-aware snapshot system. Runs on the VM against whatever database `DATABASE_URL` points to (typically the VM's local DB or DEV Cloud SQL).

### Layers
- **L0-L2 (default):** System + Specs + Organisation (no learner data)
- **L0-L3 (`--with-learners`):** Everything including callers, calls, memories

```bash
# Without learner data (smaller, faster):
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx cli/control.ts snapshot:take $NAME"

# With learner data:
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx cli/control.ts snapshot:take $NAME --with-learners"
```

Ask the user for a snapshot name. Must be alphanumeric with hyphens/underscores.

---

## Option 3: Restore Snapshot (JSON)

Restore a previously taken JSON snapshot. **Destructive** — replaces all data in the matching layers.

### Dry run first:
```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx cli/control.ts snapshot:restore $NAME --dry-run"
```

Report what would be changed. Then confirm with the user before running the real restore:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx cli/control.ts snapshot:restore $NAME --yes"
```

---

## Option 4: List Snapshots

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx cli/control.ts snapshot:list"
```

Shows: name, date, layers, row count, file size.

---

## Safety Rules

- **NEVER** allow PROD as a clone target
- **ALWAYS** confirm before any destructive operation (clone or restore)
- **ALWAYS** show what will be replaced before proceeding
- For PROD → anywhere clones, add an extra confirmation: "You are cloning PRODUCTION data. This includes real user data. Are you sure?"
- If SSH fails with exit 255, wait 5 seconds and retry once (IAP rate limiting)
- After any clone or restore, suggest the user verify the target environment's health endpoint
