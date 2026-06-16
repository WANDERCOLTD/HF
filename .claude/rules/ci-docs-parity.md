# CI ⇔ Docs Parity

> When you change the CI/CD/infra surface, you change its docs in the same PR.
> When you don't, the gate fails (L3) or warns (L2). Override: `## CI Docs Skip` PR-body section with one-line justification.
>
> Sibling rules: [`verify-before-fix.md`](./verify-before-fix.md) (developer-side cite-before-act),
> [`agent-report-verification.md`](./agent-report-verification.md) (orchestrator-side inverse-probe).
> Story: [#1802](https://github.com/WANDERCOLTD/HF/issues/1802).

## Rule

A PR that touches any path in the **Watched paths** table MUST also touch at least one of its paired docs in the same PR.

```
CI/infra change → operator-runbook update in the same commit/PR
```

## Why

Untracked drift between CI surface and operator runbooks is how production footguns survive merge review. The destructive `gcloud sql backups restore --restore-instance=hf-db` in `CLOUD-DEPLOYMENT.md §"Worst case"` survived 12+ months of deploy infra evolution because nobody touched that section when adjacent infra changed. The DR-S2 patch (#1756, 2026-06-16) removed it; this rule prevents the next one.

## Watched paths (authoritative — `scripts/check-ci-docs-parity.sh` reads this map)

| Touched path (regex anchored at repo root) | At least one paired doc must change |
|---|---|
| `\.github/workflows/deploy-.*\.yml` | `docs/CLOUD-DEPLOYMENT.md` OR `docs/RELEASE-PROCESS.md` |
| `apps/admin/Dockerfile` | `docs/CLOUD-DEPLOYMENT.md` |
| `apps/admin/cloudbuild-.*\.yaml` | `docs/CLOUD-DEPLOYMENT.md` |
| `apps/admin/scripts/deploy-gate\.sh` | `docs/CLOUD-DEPLOYMENT.md` OR `docs/RELEASE-PROCESS.md` |
| `\.claude/commands/(deploy\|db-route\|db-switch)\.md` | `docs/CLOUD-DEPLOYMENT.md` OR `docs/RELEASE-PROCESS.md` |
| `apps/admin/scripts/cloud-sql-restore-drill\.sh` | `docs/DR-POSTURE.md` OR `docs/runbooks/RB-1394-.*\.md` |
| `apps/admin/prisma/fixtures/.*\.ts` | `docs/RELEASE-PROCESS.md` |
| `scripts/(backup\|restore)-.*\.(sh\|ts)` | `docs/DR-POSTURE.md` |

The map lives in the script (single source-of-truth, no markdown parsing). This file is the human-readable mirror — keep them in sync. Any PR that edits one without the other fails its own check.

## Override syntax

When a CI change genuinely doesn't need a doc update (comment-only edit, build-arg tweak, test fixture), include in the PR body:

```markdown
## CI Docs Skip

cosmetic: workflow YAML comment-only change
```

One-line justification. The gate's parser is intentionally strict — multi-line or empty justification fails.

## Layers

| Layer | Behaviour | Hook | Status |
|---|---|---|---|
| **L1** | This rule + the script's hardcoded map (single source of truth) | n/a | **Live** |
| **L2** | `.githooks/pre-push` calls `scripts/check-ci-docs-parity.sh` — **warns** on parity miss but does not block | pre-push | **Live** |
| **L3** | `scripts/gh-pr-create.sh` calls the same script with `--strict` — **blocks** PR creation on parity miss without an override | gh pr create | **Pending #1802** |
| **L4** | Cron + `Last verified:` header — flags docs >180 days stale | cron | **Pending #1802** |

## When this rule does NOT apply

- PRs that touch ONLY docs — no CI/infra change to pair against.
- PRs that touch ONLY tests — no operator-runbook impact.
- Documentation typo fixes — covered by the override.
- Auto-generated files (e.g., `docs/API-INTERNAL.md` from the JSDoc generator) — the upstream generator is the watched path, the generated file is excluded from the diff check.

## Bypass (operator-intent override)

`SKIP_CI_DOCS_PARITY=1 git push ...` bypasses the pre-push warning for one push. Use sparingly — repeated bypasses are an anti-pattern flagged by `broken-windows` agent.

## Related guards

- [`scripts/check-schema-has-migration.sh`](../../scripts/check-schema-has-migration.sh) — pairs `prisma/schema.prisma` changes with migration files (same pattern; different surface)
- [`scripts/check-reciprocal-edit.sh`](../../scripts/check-reciprocal-edit.sh) — pre-push gate against AP-1 chase pattern
- [`scripts/gh-pr-create.sh`](../../scripts/gh-pr-create.sh) — `## Verified by` enforcement (analogous PR-body convention)
