# Schema Migrations — Working Around the Shadow DB Bug

> **TL;DR:** `npx prisma migrate dev` is broken in this repo. Use `apps/admin/scripts/generate-migration.sh` instead. Real envs (dev/staging/pilot/prod) are unaffected — `migrate deploy` works normally there.

## The bug, briefly

The first ~6 weeks of HF development (Dec 2025 → mid-Feb 2026) used `prisma db push` rather than formal migrations. Ten tables were created in that period — `Caller`, `ContentAssertion`, `ContentSource`, `ConversationArtifact`, `Curriculum`, `Domain`, `Playbook`, `PlaybookGroup`, `Subject`, `SubjectSource` — and their `CREATE TABLE` statements were never captured in `prisma/migrations/`.

When `prisma migrate dev` runs, it spins up a fresh empty **shadow database** and replays every migration from scratch to validate the new one. Replay fails at the first migration that references one of those ten tables in an FK constraint — historically `20260213_expand_user_roles` (`User.assignedDomainId → Domain.id`) — with:

```
Error: P3006
Migration `20260213_expand_user_roles` failed to apply cleanly to the shadow database.
Error code: P1014
The underlying table for model `Domain` does not exist.
```

Real envs don't hit this because the ten tables already exist there (from the original `db push`). The replay only runs in shadow.

## The workaround — what to use instead

`apps/admin/scripts/generate-migration.sh` wraps `prisma migrate diff --from-url` to bypass the shadow DB entirely. It diffs the **live database** against your updated `schema.prisma` and writes the SQL straight into a migration directory, then applies it directly.

### Usage

```bash
# 1. Edit apps/admin/prisma/schema.prisma — add your new model / column / index.
# 2. On the hf-dev VM (where Postgres is reachable):
cd ~/HF/apps/admin
./scripts/generate-migration.sh my_new_thing

# That's it. The script:
#   - Generates apps/admin/prisma/migrations/<timestamp>_my_new_thing/migration.sql
#   - Applies it to whatever DB DATABASE_URL points at
#   - Registers it as applied in _prisma_migrations
#   - Regenerates the Prisma client
#   - You then git add / commit / push the migration directory
```

### Why on the VM (not local)?

Prisma needs a live Postgres connection to read the current DB state. The hf-dev VM has Postgres reachable on the wireguard network; local Macs typically don't.

### Pitfalls of `migrate diff --from-url`

Because the script compares the **live DB** to your **new schema**, the diff includes any **drift** between them — things that someone changed in the DB outside the migration history. Examples seen in the wild:

- `ALTER TABLE "CurriculumModule" ALTER COLUMN "coversModules" DROP DEFAULT` — a default that the schema doesn't declare but the DB had
- `DROP TABLE "tallyseal_*"` — the tallyseal-prisma-adapter tables, which are managed by raw-SQL migrations outside Prisma

**Always read the generated `migration.sql` before letting the script apply it.** The script prints the SQL to stdout and pauses for confirmation. If the diff includes anything beyond your intended change, either:

1. **Hand-edit the SQL** to remove the unrelated drift — keep only your change.
2. **Manage drift first** — fix the schema or DB, then re-generate.

For #1101's `CallerIdentityChallenge` we hand-edited the SQL to drop tallyseal/CurriculumModule drift. See the migration file at `apps/admin/prisma/migrations/20260605162259_caller_identity_challenge/` for an example of a clean, hand-curated migration written this way.

## When `prisma migrate dev` will work again

When the latent issue is fixed — see GitHub issue **#1108** for the cross-env surgery (scaffold migration + `migrate resolve --applied` across dev / staging / pilot / prod). Until then, the workflow above is canonical.

## Deploy path is unchanged

`prisma migrate deploy` (what runs in real envs) **works normally**. It applies any migration directories not yet recorded in `_prisma_migrations`, in order. No shadow DB involved. So commits made via this workflow ship to staging/pilot/prod via the existing `/deploy` flow without any special handling.

## See also

- `apps/admin/scripts/generate-migration.sh` — the wrapper script
- `apps/admin/scripts/apply-tallyseal-migrations.ts` — separate raw-SQL migration runner for tallyseal tables (must run after `prisma generate`)
- `.claude/skills/vm-cpp.md` — the VM deploy flow, which calls `prisma migrate deploy`
