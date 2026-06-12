# Audit Branch Closeout — `claude/model-kqgcaq`

**PR:** https://github.com/WANDERCOLTD/HF/pull/1533
**Branch:** `claude/model-kqgcaq` (20 commits ahead of `main`)
**Base:** `9c3f62d2`  →  **HEAD:** `62133b1e`
**Worktree:** `/Users/paulwander/projects/HF-audit`

## What was shipped

16 audit findings closed (HF-A through HF-P) across 4 risk classes:

| Class | Findings | Closeout |
|---|---|---|
| Bugs caught | HF-A | Silent `ContractRegistry.get` typo on hot path — LIVE on hf_sandbox (DB evidence in `docs/audit/HF-A-evidence-skill-measure-v1.md`) |
| Security | HF-B, HF-C, HF-D, HF-J, **HF-M**, HF-N, HF-O, HF-P | Demo creds, Retell webhook signing, intake PII rate-limit, secrets-in-client ESLint, **IDOR sweep on 26 `[callerId]` routes**, npm audit 65→16, demo XSS escape, `dangerouslySetInnerHTML` annotations |
| Guards / CI | HF-E, HF-F, HF-G, HF-H, HF-K | Quarantine sentinel, rule-test 2-location collapse, per-file tsc zero-tolerance, knip ratchet, webhook-signature CI gate |
| AI-to-DB | HF-I, HF-L | Spec-slug rule active + 4 getters, 12 vitests pin #407/#1048 invariants |

## Structural enforcement baked in

| New guard | Severity | What it blocks |
|---|---|---|
| `hf-security/no-unscoped-caller-id-route` | ESLint `error` | The next IDOR landing on `[callerId]` routes. **Surfaced 13 routes I missed in the manual HF-M sweep.** |
| `hf-security/require-html-safety-comment` | ESLint `error` | The next latent DOM XSS via `dangerouslySetInnerHTML`. |
| `kb:npm-audit-ratchet` | CI ratchet in `kb:check` | A dependency bump that introduces a high/critical vulnerability. Baseline locked at 6. |

Plus `apps/admin/tests/eslint-rules/_helpers.ts::PROBE_FILENAMES` extended with a `[callerId]` path so `smokeRule` covers HF-M.2's path-scoped rule.

## Reusable artifacts for the next session

| Doc | Purpose |
|---|---|
| `docs/audit/RUNBOOK.md` | 18-section production-strength audit playbook. Paste into a fresh CC session to run another audit. |
| `docs/audit/WHATS-LEFT.md` | 20-item ranked backlog (P0 → P2). |
| `docs/audit/HANDOFF-large-file-refactor.md` | Self-contained brief for the 3 hotspot refactors (pipeline/route.ts 4258 lines, admin-tool-handlers.ts 3092, wizard-tool-executor.ts 2900). |
| `docs/audit/PRODUCTION-READINESS-SCORECARD.md` (REV-1) | Findings table + posture matrix + commit chain. |
| `docs/audit/HF-A-evidence-skill-measure-v1.md` | DB evidence for HF-A LIVE classification on hf_sandbox. |
| `docs/audit/HF-D-evidence-pii-intentid-bearer.md` | Threat model + P0/P1/P2 recommendations for the intake intentId-as-bearer posture. |
| `docs/audit/HF-M-evidence-path-param-idor.md` | Threat model + the 26 patched routes + 3 named follow-on trackers (HF-M.1 / .2 / .3). |

## Commit chain

```
62133b1e  chore(audit): drop unused NextResponse import (pre-push lint cleanup)
f0c80a3d  feat(audit): bake findings into structural enforcement + reusable runbook
8fc2f7c9  docs(audit): scorecard REV-1 — fold in HF-M / HF-N / HF-O / HF-P
7b846024  fix(audit): npm audit fix (65→16) + escape demo markdown XSS + stageIcon
0de21b02  fix(api): HF-M IDOR sweep — 26 [callerId] routes reject foreign callerIds
f02fd290  docs(audit): handoff for the 3 over-large files
d2ce6e03  docs(audit): closing production-readiness scorecard (REV-0)
376df6f0  fix(intake): HF-D P0 — rate-limit PII reads + redact filename
13c86cf5  fix(test): collapse rule-test 2-location split — HF-F
87ef9f1a  docs(audit): live evidence for HF-A SKILL_MEASURE_V1
d824a9ba  fix(config): clear HF-I residual slug literals + activate rule
9c3f62d2  chore(audit): clear lint warnings from new guard files          ← branch base
[upstream: HF-G/H/I/J/K/L/D/E/A/B/C commits, 9 total]
```

## Verified by

- `npm run kb:check` ✓ all 8 guards green (guard-links, rule-tests, webhook-sig, guard-tests, tsc-protected, knip-ratchet 161, npm-audit-ratchet 6, fresh).
- `npm run ratchet:check`: tsc_errors 190 == baseline; lint_errors 0 == baseline; quarantined_tests 36 == baseline; knip_unused 161 == baseline; npm_audit_high_crit 6 == baseline. `lint_warnings` +3 over baseline is pre-existing drift documented in commit `9c3f62d` (out of scope for this audit; my edits add zero new warnings, verified via stash/pop totals diff).
- Per-file tsc clean on every file I touched.
- All new vitests pass; full test sweep on the modules I edited 376/376.
- 20 commits ahead of `main`; no overlap with the 8 commits on main since branch-base (per inspection of file paths in `#1514` / `#1515` / `#1526` / `#1529` / `#1530`).

## What the fresh session does next

Read in this order:

1. **`docs/audit/CLOSEOUT.md`** (this file) — context.
2. **`docs/audit/PRODUCTION-READINESS-SCORECARD.md`** (REV-1) — current state.
3. **`docs/audit/WHATS-LEFT.md`** — pick from the P0 / P1 / P2 backlog.

P0 next:
1. **HF-D P1** — intake intentId URL → opaque session cookie. Must land before PrismaEventStore Phase 1.5.
2. **HF-M.1** — IDOR sweep for `[playbookId]` / `[domainId]` / `[callId]` / `[cohortId]` families.
3. **`npm audit fix --force`** — 6 residual high+crit deps.

OR run another audit by pasting `docs/audit/RUNBOOK.md` into a fresh CC session.

## What I did NOT do (intentional)

- **Did NOT merge to `main`.** Per CLAUDE.md branch-hygiene + "destructive shared-state needs confirmation" — merging is the reviewer's call after `kb:check` + `/ultrareview` (or whichever review path the team uses).
- **Did NOT rebase onto `main`.** Rebase rewrites commit hashes; 20 verified-by commits stay intact. The reviewer can rebase via GitHub UI if they want a linear history.
- **Did NOT `npm audit fix --force`.** Tracked as HF-N P0 in `WHATS-LEFT.md` because `next@16.2.9` (same-major) + promptfoo bumps need a controlled test pass.
- **Did NOT touch the 3 hotspot files.** Per `HANDOFF-large-file-refactor.md` — each is its own scoped refactor session with its own test bed.
- **Did NOT flip CSP enforce.** Operator must time it with a deploy.
