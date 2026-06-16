# VM Migration Lock

> When two operators share the `hf-dev` VM + `hf_sandbox` DB, simultaneous
> `npx prisma migrate dev` calls produce non-deterministic migration history
> divergence. The lock makes the second operator wait.
>
> Story: [#1763](https://github.com/WANDERCOLTD/HF/issues/1763) (S8 of release-pipeline epic #1723).

## Rule

On the `hf-dev` VM, run migrations via the wrapper:

```bash
scripts/vm-migrate.sh --name <slug>
```

**Not** the bare `npx prisma migrate dev --name <slug>` command.

The wrapper:
1. Refuses to start if another operator holds a fresh lock (<30 min)
2. Acquires the lock for you on entry
3. Releases on success; retains on failure (you investigate + retry)

## When this applies

- The VM `hf-dev` shared by Paul + Boaz, both running migrations against `hf_sandbox`
- Any future shared dev surface (e.g., remote pair-programming session)

**Not** applicable when:
- Single operator on the VM (lock acquired + released by the same person — no contention)
- Local Mac (no shared filesystem; per CLAUDE.local.md operators don't run dev locally)
- Cloud Run migrate jobs (run via `hf-migrate-*` job, single-threaded by GCP)

## Lock file convention

- Location: `<repo-root>/.vm-migration-lock` (git-ignored — local only)
- Format: `<owner>|<iso-timestamp>|<branch>|<intent>` on a single line
- Stale threshold: 30 min of mtime age. Stale locks warn-only; can be reclaimed.

## Session-start warning

`.claude/hooks/session-start.sh` calls `scripts/check-vm-migration-lock.sh`
on session open. If a fresh lock is held by another operator, the warning
surfaces immediately so you know not to start a migration.

## Failure modes the lock prevents

1. **History divergence** — both operators run migrate dev with the same starting state; second migration's parent SHA in `_prisma_migrations` differs from what `migrate deploy` expects upstream
2. **Drift between operator's local migration file and pushed migration** — Paul writes migration A locally, Boaz pulls + writes migration B without seeing A, two migration files target the same starting state
3. **Mid-shadow-db races** — Prisma's shadow DB used during `migrate dev` doesn't tolerate two writers; symptoms are confusing "table already exists" errors

## Bypass (rare)

`HF_VM_MIGRATE_BYPASS=1 scripts/vm-migrate.sh ...` skips the pre-flight check. Use only when:
- You confirmed via Slack/voice the other operator is done
- Their lock file is stale (>30 min) AND you can't reach them
- A real emergency requires the migration immediately

Document the bypass in the migration's commit body.

## Related

- [`scripts/check-vm-migration-lock.sh`](../../scripts/check-vm-migration-lock.sh) — the standalone check
- [`scripts/vm-migrate.sh`](../../scripts/vm-migrate.sh) — the wrapper
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) — for the broader concurrency model
- CLAUDE.md "No concurrent claude sessions" section — the working-tree lock sibling
