---
name: deploy-preflight
description: Pre-deployment validation — checks types, lint, tests, uncommitted changes, and migration status. Use before deploying to any environment. Auto-triggers when user mentions deploying or pushing to cloud.
allowed-tools: Bash, Read, Grep, Glob
model: haiku
context: fork
---

# Deploy Preflight Check

Run these checks in order, stop on first failure:

## 1. Uncommitted changes
```bash
cd /Users/paulwander/projects/HF && git status --porcelain
```
If dirty: WARN — "Uncommitted changes won't be deployed"

## 2. Branch check
```bash
git branch --show-current
```
If not `main`: WARN — "Not on main branch"

## 3. Type check
```bash
cd apps/admin && npx tsc --noEmit 2>&1 | tail -20
```

## 4. Lint
```bash
cd apps/admin && npm run lint 2>&1 | tail -20
```

## 5. Unit tests
```bash
cd apps/admin && npm run test 2>&1 | tail -20
```

## 6. Migration status
```bash
cd apps/admin && npx prisma migrate status 2>&1
```

## Report
Output a table:
| Check | Status |
|-------|--------|
| Clean working tree | PASS/WARN |
| On main branch | PASS/WARN |
| TypeScript | PASS/FAIL |
| Lint | PASS/FAIL |
| Tests | PASS/FAIL |
| Migrations | PASS/WARN |

If any FAIL: "BLOCKED — fix before deploying"
If only WARN: "READY with warnings"
If all PASS: "READY TO DEPLOY"
