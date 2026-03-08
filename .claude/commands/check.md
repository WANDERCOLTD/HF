---
description: Quality gate — pre-commit checks, branch review, or both
---

Code quality checks. Combines pre-commit gate and branch review into one command.

Ask the user using AskUserQuestion:

**Question:** "Which quality checks do you want to run?"
**Header:** "Check"
**multiSelect:** true

Options:
1. **Pre-commit (Recommended)** — tsc, lint, unit tests, auth coverage, spot-check staged files
2. **Branch review** — Hardcoding, auth, test coverage, code smells across full branch diff
3. **Journey check** — Integration tests: course → extraction → lesson plan → prompt composition → prompt diff
4. **All** — Run everything: pre-commit gate + branch review + journey check

If the user selects "Both" (or nothing specific), run all checks.

## Pre-commit Gate

Run in order — stop early if a step fails:

### 1. Type Check
```bash
npx tsc --noEmit
```
Report: PASS or list of errors.

### 2. Lint
```bash
npm run lint 2>&1 | head -50
```
Report: PASS or list of errors.

### 3. Unit Tests
```bash
npm run test
```
Report: PASS (X tests) or list of failures.

### 4. Auth Coverage
```bash
npm run test -- tests/lib/route-auth-coverage.test.ts
```
Report: PASS or list of uncovered routes.

### 5. Quick Spot-Check
Search staged/modified files for:
- Hardcoded spec slugs outside config.ts/seed files
- `const config =` shadowing the config import
- ContractRegistry calls without `await`

Report: PASS or list of findings.

## Journey Check

Run the educator journey integration tests against the real database.
Requires: database running and seeded (specs must exist). No server needed.

```bash
cd apps/admin && npm run test:integration -- tests/integration/journey/
```

Report: PASS (5 steps validated) or list of failures with step details.

Steps validated:
1. Course structure — domain + playbook + subject + content source linked
2. Assertions extracted — correct shape, categories, tags, LO refs
3. TP assignment — teaching points mapped to lesson plan sessions via learningOutcomeRefs
4. Prompt composition — Call 1 produces valid llmPrompt with activated sections
5. Prompt diff — Call 2 shows changes (memories, call history, section activation)

## Branch Review

### 1. Zero Hardcoding
- Scan changed files for magic strings, hardcoded slugs, literal config values
- Spec slugs must come from `config.specs.*`
- Runtime data must come from DB, not hardcoded arrays/objects

### 2. Auth Coverage
- Every new/modified API route must call `requireAuth("ROLE")`
- Check with `isAuthError()` immediately after
- Role must be appropriate: VIEWER for reads, OPERATOR for writes, ADMIN for system ops
- Run `npm run test -- tests/lib/route-auth-coverage.test.ts`

### 3. Test Coverage
- New functions in `lib/` should have `.test.ts` coverage
- New API routes should have input validation tests
- Run `npm run test` and report failures

### 4. Code Smells
- No `any` types (use `unknown` if truly unknown)
- No TDZ: never shadow `config` import with `const config = ...`
- All ContractRegistry calls use `await`
- CSS colors use `color-mix()`, never hex alpha suffixes
- No N+1 queries (use Prisma `include` or `select`)

## Output

For pre-commit:
```
Pre-commit: READY (5/5 checks passed)
```
or
```
Pre-commit: NOT READY
  - TypeScript: 3 errors
  - Tests: 1 failure
```

For branch review: each category PASS / FAIL / WARN with file:line references.

If all pass, suggest a commit message based on staged changes.
If issues found, end with "Issues to fix" numbered list.
