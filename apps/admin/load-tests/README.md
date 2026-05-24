# HF Load Tests

k6-based HTTP load-test harness for HF's API surface. Tests run against the **staging** env (`staging.humanfirstfoundation.com` after #726 Phase 4, currently still at `dev.humanfirstfoundation.com`). Never against pilot or prod with real data.

Closes #762 Phase 1. See issue for full background, audit links, and risk register.

## Prerequisites

```bash
brew install k6                # one-time
node --version                 # 20+ for fixture scripts
```

## Required env vars

Create `apps/admin/load-tests/.env.load-test` (gitignored — copy from `.env.load-test.example`):

```sh
STAGING_BASE_URL=https://dev.humanfirstfoundation.com   # canonical for now; flips to staging.* in #726 Phase 4
LOAD_TEST_INTERNAL_SECRET=...                            # matches INTERNAL_API_SECRET on staging (pipeline scenario)
VAPI_WEBHOOK_SECRET=...                                  # matches VAPI_WEBHOOK_SECRET on staging
LOAD_TEST_CALLER_ID=...                                  # pre-seeded test caller (set by fixtures/seed)
RATE_LIMIT_DISABLED=true                                 # required during load runs; reset after
```

> **Rate-limiter** (#189): the in-memory per-IP limiter is 5 req/15min. Load tests WILL trip it unless `RATE_LIMIT_DISABLED=true` is set on the staging Cloud Run service for the duration of the run. **Unset it after.** Document the on/off in `results/RUN_LOG.md`.

> **VAPI webhook secret** (#762 open question): if `VAPI_WEBHOOK_SECRET` is unset on staging, the verifier passes through in dev mode — webhook scenario is trivially green. Confirm the secret is set before relying on `vapi-webhook.js` results.

## Running

```bash
# From repo root
cd apps/admin/load-tests

# 1. Seed test fixtures (caller, course, etc.)
npx tsx fixtures/seed-load-test-data.ts --env=staging --callers=10

# 2. Run a profile
k6 run --env BASE_URL=$STAGING_BASE_URL --env VAPI_SECRET=$VAPI_WEBHOOK_SECRET --out json=results/run-$(date +%s).json profiles/01-baseline.js

# 3. Summarise
npx tsx summarise.ts results/run-LATEST.json

# 4. Teardown
npx tsx fixtures/teardown-load-test-data.ts --env=staging
```

## Profiles

| File | VUs | Duration | What it exercises | When to run |
|------|-----|----------|---------------------|-------------|
| `profiles/01-baseline.js` | 10 | 5 min | health + readiness + webhook | Pre-deploy smoke, anytime |
| `profiles/02-market-test-target.js` | 100 | 30 min | all scenarios | Before market test launch |
| `profiles/03-burst-stress.js` | 50 in 60s | ~7 min total | webhook burst | Recovery-time check |

## Scenarios

| File | Target | Notes |
|------|--------|-------|
| `scenarios/health-check.js` | `/api/health`, `/api/system/readiness` | No auth needed |
| `scenarios/vapi-webhook.js` | `POST /api/vapi/webhook` | HMAC-SHA256 signed (matches `lib/vapi/auth.ts`) |
| `scenarios/pipeline-trigger.js` | `POST /api/calls/[id]/pipeline` | Internal secret auth — TBD Phase 1B |
| `scenarios/chat-stream.js` | `POST /api/chat` | Streaming reads — TBD Phase 1B |
| `scenarios/extraction-trigger.js` | `POST /api/courses/[id]/re-extract` | Needs seeded course — TBD Phase 1B |
| `scenarios/prisma-singleton-probe.js` | 5 routes from #191 | 50 VU concurrent — TBD Phase 1B (the #191 smoking-gun test) |

## Reading results

```bash
npx tsx summarise.ts results/run-1779634000.json
```

Output:
```
Scenario: health-check
  /api/health        p50=42ms  p95=88ms  p99=121ms  errors=0/1247  PASS (target <200ms)
  /api/system/ready  p50=89ms  p95=312ms p99=487ms  errors=0/1247  PASS (target <500ms)
Scenario: vapi-webhook
  POST /api/vapi/webhook  p50=210ms p95=380ms p99=620ms  errors=2/847  WARN (target <500ms p95; 0.24% err)
Overall: PASS (baseline profile)
```

## Escalation when Profile 1 fails

Per #762 open question 2 — any threshold failure on the baseline profile is a market-test blocker. Sequence:

1. Capture the run JSON + Cloud Run logs (`gcloud logging read --service=hf-admin-dev --limit=200`)
2. If DB pool errors appear (`too many clients`, `connection pool timeout`) — file a fix PR against #191 (`new PrismaClient()` → shared singleton on the 23 offending routes)
3. If AI 429 errors appear — escalate to #479 (prompt trimming) + #188 (instance-level AI cap)
4. Re-run Profile 1; do not promote to Profile 2 until baseline is clean

## Out of scope

- Real VAPI voice calls — only synthetic webhook posts
- Browser-based testing — HTTP API only
- Production / pilot env testing — staging only
- CI regression gate — Phase 3 follow-on story

## Files

```
load-tests/
├── README.md                       (this file)
├── .env.load-test.example          (template — copy + fill)
├── k6.config.js                    (shared thresholds + env plumbing)
├── summarise.ts                    (Node script — reads k6 JSON, prints verdict)
├── profiles/
│   ├── 01-baseline.js              (10 VU × 5 min — Phase 1A ✅)
│   ├── 02-market-test-target.js    (100 VU × 30 min — Phase 1B)
│   └── 03-burst-stress.js          (50 VU in 60s — Phase 1B)
├── scenarios/
│   ├── health-check.js             (Phase 1A ✅)
│   ├── vapi-webhook.js             (Phase 1A ✅)
│   ├── pipeline-trigger.js         (Phase 1B)
│   ├── chat-stream.js              (Phase 1B)
│   ├── extraction-trigger.js       (Phase 1B)
│   └── prisma-singleton-probe.js   (Phase 1B — #191 smoking-gun test)
├── fixtures/
│   ├── seed-load-test-data.ts      (Phase 1A ✅ — minimal: N callers)
│   └── teardown-load-test-data.ts  (Phase 1A ✅)
└── results/                        (gitignored except RUN_LOG.md)
    └── RUN_LOG.md                  (one entry per run — date, env, profile, verdict)
```
