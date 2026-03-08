---
description: Run Playwright e2e tests — local (via tunnel) or cloud environment
---

Run Playwright end-to-end UI tests from this Mac against a target environment.

Ask the user using AskUserQuestion:

**Question:** "Which environment?"
**Header:** "E2E Tests"

Options:
1. **Local (VM tunnel)** — Run against localhost:3000 (requires `/vm-dev` or `/vm-tunnel` running)
2. **DEV** — Run against dev.humanfirstfoundation.com
3. **TEST** — Run against test.humanfirstfoundation.com
4. **PROD** — Run against lab.humanfirstfoundation.com

Then ask which tests to run:

**Question:** "Which tests?"
**Header:** "Test Scope"

Options:
1. **Smoke only** — Quick health check (cloud smoke tests)
2. **All cloud tests** — Full cloud test suite (smoke + golden path + sim + quick launch)
3. **All tests** — Everything (authenticated + unauthenticated + mobile)
4. **Specific file** — Ask for path

## Execution

### Local (VM tunnel)

Check tunnel is up first:
```bash
curl -sf http://localhost:3000/api/health > /dev/null 2>&1 || echo "NO_SERVER"
```

If NO_SERVER, tell user: "No server on localhost:3000 — run `/vm-dev` or `/vm-tunnel` first."

Then run based on test scope:

**Smoke only:**
```bash
cd /Users/paulwander/projects/HF/apps/admin && CLOUD_E2E=1 npx playwright test tests/cloud/smoke.spec.ts --project=cloud
```

**All cloud tests:**
```bash
cd /Users/paulwander/projects/HF/apps/admin && CLOUD_E2E=1 npx playwright test tests/cloud/ --project=cloud
```

**All tests:**
```bash
cd /Users/paulwander/projects/HF/apps/admin && npm run test:e2e
```

**Specific file:**
```bash
cd /Users/paulwander/projects/HF/apps/admin && npx playwright test <path>
```

### Cloud environments (DEV / TEST / PROD)

Map environment to URL:
- DEV → `https://dev.humanfirstfoundation.com`
- TEST → `https://test.humanfirstfoundation.com`
- PROD → `https://lab.humanfirstfoundation.com`

```bash
cd /Users/paulwander/projects/HF/apps/admin && CLOUD_E2E=1 NEXT_PUBLIC_API_URL=<URL> npx playwright test tests/cloud/<scope> --project=cloud
```

Where `<scope>` is `smoke.spec.ts`, `tests/cloud/`, or omitted for all.

**IMPORTANT:** Cloud environments use `SEED_ADMIN_PASSWORD` env var for login. If not set, it defaults to `admin123`. Tell the user if auth fails — they may need to set the password.

## Output

Report results concisely:
```
E2E: PASS (X/Y tests passed) against <environment>
```
or
```
E2E: FAIL (X/Y passed, Z failed)
  - test name: error summary
```

If failures, mention that HTML report is at `playwright-report/index.html` — they can open it with:
```bash
npx playwright show-report
```
