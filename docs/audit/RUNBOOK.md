# Production-Strength Audit RUNBOOK

Paste this whole file into a fresh Claude Code session when you want to run
a production-strength audit. It is self-contained and ordered.

The HF audit branch `claude/model-kqgcaq` (2026-06-12) produced this runbook
as a reusable artifact. The original audit ran HF-A → HF-L (auth, secrets,
webhook signing, AI-to-DB guards). The "what other checks" follow-on
surfaced HF-M (IDOR), HF-N (npm audit), HF-O (DOM XSS), HF-P (HTML-safety
annotation). The runbook bakes those Z-axis probes into the FIRST sweep so
future audits don't miss them.

## TL;DR — order of probes

1. [`L1 — Auth & route coverage`](#l1) — every route gate, no quarantined gates
2. [`L2 — IDOR (path + query params)`](#l2) — STUDENT-scope on every entity
3. [`L3 — Secrets at rest & in transit`](#l3) — encryption + bundle scan
4. [`L4 — Webhook signatures`](#l4) — every provider does real verification
5. [`L5 — Input validation / AI-to-DB`](#l5) — validate-then-write
6. [`L6 — AI-read grounding`](#l6) — verify-then-claim
7. [`L7 — DOM XSS`](#l7) — `dangerouslySetInnerHTML` trust chain
8. [`L8 — SQL injection`](#l8) — every raw query is `Prisma.sql`-tagged
9. [`L9 — Headers + cookies`](#l9) — CSP, HSTS, SameSite, Secure
10. [`L10 — Rate limiting`](#l10) — every PII surface bounded
11. [`L11 — Open redirects`](#l11) — server-built paths only
12. [`L12 — Hardcoded config`](#l12) — spec slugs, URLs, env defaults
13. [`L13 — npm audit`](#l13) — high+crit ratchet
14. [`L14 — Test bed hygiene`](#l14) — no quarantined guard tests
15. [`L15 — Complexity hotspots`](#l15) — files >2000 lines
16. [`L16 — Memory / interval leaks`](#l16) — module-scope state + unref()
17. [`L17 — Logging of sensitive data`](#l17) — grep for PII / secrets in console.log
18. [`L18 — Container restart resilience`](#l18) — in-memory state across rolls

Each section is run-and-report: do the probe, capture findings as HF-X rows in
`docs/audit/HF-X-evidence-*.md`, fix in a scoped PR, close on the scorecard.

---

## Pre-flight

```bash
git checkout -b chore/audit-$(date +%Y%m%d)
npm --prefix apps/admin ci
npm --prefix apps/admin run kb:check     # baseline must be GREEN
npm --prefix apps/admin run ratchet:check # baseline locks
```

If `kb:check` or `ratchet:check` are RED on main, **stop the audit and fix
that first** — every probe assumes a clean baseline.

---

## L1 — Auth & route coverage <a id="l1"></a>

Probe:
```bash
# Every route under app/api/ should call requireAuth or requireEntityAccess.
# The HF-D-era test is the canonical check:
npx vitest run apps/admin/tests/lib/route-auth-coverage.test.ts
```

Findings to expect:
- New route landed without `requireAuth(...)`.
- Public-route allow-list expanded without a doc trail.

Cross-check: `tests/lib/route-auth-coverage.test.ts` PUBLIC_ROUTES has the
documented exemptions (intake intentId-as-bearer, webhook secret routes,
session-less invite/join). Anything NEW in the allow-list since the last
audit needs a written reason in the test file.

---

## L2 — IDOR (path + query params) <a id="l2"></a>

The largest finding from the 2026-06-12 audit. HF-M caught 26
`[callerId]` path-param routes that let any STUDENT read any caller's PII
via URL.

Probe:
```bash
# 1. Active ESLint rule fires on the [callerId] family.
npx eslint --no-warn-ignored 'apps/admin/app/api/**/[[]callerId[]]/**/route.ts'

# 2. Manual sweep of the sibling families — same shape, no rule yet.
for entity in playbookId domainId callId cohortId; do
  echo "=== [${entity}] family ==="
  grep -rln "params.*${entity}" "apps/admin/app/api/" --include="route.ts" \
    | xargs -I{} sh -c 'if ! grep -q "studentAllowedToReadCaller\|resolveCallerScopeForReading\|requireAuth(\"OPERATOR\"\|\"ADMIN\"\|\"SUPERADMIN\")" {}; then echo {}; fi'
done

# 3. Confirm the helper has a JWT-claim path for each entity.
grep -n "studentAllowedToReadCaller\|studentAllowedToReadPlaybook\|...etc" apps/admin/lib/learner-scope.ts
```

Build a sibling helper for each entity if missing (`studentAllowedToReadPlaybook`,
etc.). Apply the same pattern as HF-M.

The structural enforcement landed in HF-M.2 is
`hf-security/no-unscoped-caller-id-route`. Extend to other entities as their
helpers land.

---

## L3 — Secrets at rest & in transit <a id="l3"></a>

Probe:
```bash
# 1. No hardcoded keys (high-confidence shapes).
grep -rEn 'sk-[a-zA-Z0-9]{20}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|AIza[a-zA-Z0-9_-]{35}' \
  apps/admin/lib apps/admin/app --include='*.ts' --include='*.tsx'

# 2. No secrets in client bundles (HF-J ESLint rule).
npx eslint --no-warn-ignored 'apps/admin/app/**/*.tsx' 'apps/admin/components/**/*.tsx' \
  | grep "hf-security/no-secrets-in-client"

# 3. Provider API keys at rest — check the schema.
grep -nE "credentials\s+Json|apiKey\s+String" apps/admin/prisma/schema.prisma

# 4. Bundle strip check (run on a build):
NEXT_PUBLIC_APP_ENV=PROD npm --prefix apps/admin run build
grep -r hff2026 apps/admin/.next/static || echo "no demo creds in PROD bundle ✓"
```

For provider API keys: the audit-deferred `provider-factory.ts:24` TODO is
the long-standing AES-256-GCM-at-rest work. Document deferral OR commit to it.

---

## L4 — Webhook signatures <a id="l4"></a>

```bash
# Structural CI gate already exists — HF-K.
npx tsx apps/admin/scripts/capture/check-webhook-signature.ts
```

The gate fires on `lib/voice/providers/*/index.ts::verifyInboundRequest` if
the body is empty or a bare `return null`. If a new provider lands, this
gate is the safety net.

---

## L5 — Input validation / AI-to-DB <a id="l5"></a>

Read `.claude/rules/ai-to-db-guard.md` for the contract. Probe:
```bash
# Every AI tool that mutates the DB should route through a validator
# before prisma.*.create/update. Heuristic grep:
grep -rEn "prisma\.\w+\.(create|update|delete)\(" apps/admin/lib/chat apps/admin/lib/wizard \
  | grep -v "validateManifest\|validate"  # any hits = manual review needed
```

The HF audit found HF-L (resolve-module + disclosure-store had no tests).
The fix: write a vitest that pins the invariant.

---

## L6 — AI-read grounding <a id="l6"></a>

Read `.claude/rules/ai-read-grounding.md`. Probe:
```bash
# Every AI surface that returns natural-language text mentioning a specific
# entity should run through detectUngroundedLearnerClaim or document why not.
grep -rn "@ai-call" apps/admin/lib apps/admin/app --include="*.ts" \
  | xargs -I{} sh -c 'echo {}; grep -l "detectUngroundedLearnerClaim\|factual-grounding" $(echo {} | cut -d: -f1)'
```

#1444 / #1458 contracts apply.

---

## L7 — DOM XSS <a id="l7"></a>

Active ESLint rule from HF-O/HF-P:
```bash
npx eslint --no-warn-ignored 'apps/admin/**/*.tsx' \
  | grep "hf-security/require-html-safety-comment"
```

Every site must carry a `// SECURITY:` annotation OR import an in-scope
sanitizer (`DOMPurify`, `escapeHtml`, `sanitize`, …).

---

## L8 — SQL injection <a id="l8"></a>

```bash
# Raw queries must use Prisma.sql tagged templates, never string concat.
grep -rEn '\$queryRaw|\$executeRaw' apps/admin/lib apps/admin/app --include='*.ts'
# Each hit should be followed by `Prisma.sql\`...\`` — not a bare string.
```

Spot-checked clean on 2026-06-12. Re-probe whenever a new raw query lands.

---

## L9 — Headers + cookies <a id="l9"></a>

```bash
# 1. Security headers — read next.config.ts and confirm the policy:
grep -nE "X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|Strict-Transport-Security|Content-Security-Policy" \
  apps/admin/next.config.ts

# 2. CSP enforcement state — should be 'Content-Security-Policy' for prod:
grep -A 5 "CSP_ENFORCE" apps/admin/next.config.ts

# 3. Cookie flags — every cookie set should have httpOnly + secure + sameSite:
grep -rEn "cookies\.set\(" apps/admin/lib apps/admin/app --include='*.ts'
```

Required: HSTS in prod, CSP enforcing in prod, all session cookies httpOnly +
secure + sameSite "lax" (or "strict" for admin masquerade).

---

## L10 — Rate limiting <a id="l10"></a>

```bash
# Every public POST/PATCH/DELETE + every PII-returning GET should call
# checkRateLimit(getClientIP(req), <key>).
grep -rln "export async function (POST|PATCH|DELETE|GET)" apps/admin/app/api \
  | xargs -I{} sh -c 'if ! grep -q "checkRateLimit\|requireAuth" {}; then echo MISSING_RATELIMIT: {}; fi'
```

HF-D P0 added `intake-pii-read` for the 3 intake GET routes. Repeat for any
PII-returning public surface.

---

## L11 — Open redirects <a id="l11"></a>

```bash
# Any user-supplied returnTo / callbackUrl / redirect_uri should be validated
# against an allow-list. Scan:
grep -rEn "callbackUrl|returnTo|redirect_uri|redirect\\s*=" apps/admin/app/api --include='*.ts'
```

Clean on 2026-06-12 — all redirect candidates were server-built paths.

---

## L12 — Hardcoded config <a id="l12"></a>

```bash
# Spec slugs — active rule.
npx eslint --no-warn-ignored apps/admin/ | grep "hf-config/no-hardcoded-spec-slug"

# Localhost / dev URLs in runtime — heuristic:
grep -rEn "http://localhost|\\.dev\\.|\\.local" apps/admin/lib apps/admin/app \
  --include='*.ts' --include='*.tsx' | grep -v "test\|spec\|config.ts"
```

`config.specs.*` is the single source of truth for spec slugs. Localhost
fallbacks are OK in `lib/config.ts` (they ARE the env defaults) but
suspicious anywhere else.

---

## L13 — npm audit <a id="l13"></a>

```bash
npm --prefix apps/admin run kb:npm-audit-ratchet
```

Monotonic ratchet at `npm_audit_high_crit` in `.ratchet.json` (HF-N).
Count can only drop. When a `dependabot` PR bumps a transitive,
`kb:npm-audit-ratchet` will fail if it introduces a regression.

If the count drops, lock the win:
```bash
# Update .ratchet.json to the new (lower) baseline:
jq '.npm_audit_high_crit = <new-count>' .ratchet.json | sponge .ratchet.json
```

---

## L14 — Test bed hygiene <a id="l14"></a>

```bash
# 11 named guard tests may never be quarantined or deleted (HF-E).
npx tsx apps/admin/scripts/capture/check-guard-tests-not-quarantined.ts

# Every ESLint rule has a sibling test that ACTUALLY runs (HF-F).
npx tsx apps/admin/scripts/capture/check-eslint-rule-tests.ts
```

---

## L15 — Complexity hotspots <a id="l15"></a>

```bash
find apps/admin/lib apps/admin/app -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' \
  -exec awk 'END{if(NR>1000)print NR"\t"FILENAME}' {} \; \
  | sort -rn | head -15
```

Files >2000 lines are review-hostile and hide bugs. See
`docs/audit/HANDOFF-large-file-refactor.md` for the 3 known hotspots
(pipeline/route.ts 4258, admin-tool-handlers.ts 3092, wizard-tool-executor.ts
2900) and the refactor plan.

---

## L16 — Memory / interval leaks <a id="l16"></a>

```bash
# Every setInterval at module scope should call .unref() so it doesn't
# pin the event loop on Cloud Run.
grep -rEn "setInterval\(" apps/admin/lib --include='*.ts'
```

`lib/rate-limit.ts` interval was already .unref()'d at audit time. Re-probe
whenever a new module-scope interval lands.

---

## L17 — Logging of sensitive data <a id="l17"></a>

```bash
grep -rEn "console\\.(log|info|warn|error)" apps/admin/lib apps/admin/app \
  --include='*.ts' | grep -iE "session|cookie|password|secret|apikey|token"
```

False positives expected (variable names, doc comments). Read each hit
manually — `console.log("password hash check failed")` is fine, but
`console.log({ password: req.body.password })` is a leak.

---

## L18 — Container restart resilience <a id="l18"></a>

In-memory state pinned to `globalForX` survives HMR but NOT container
rolls. Scan:
```bash
grep -rn "globalForIntake\|globalForRateLimit\|globalThis as unknown as" \
  apps/admin/lib --include='*.ts'
```

Each match should have an answer to: "What happens to in-flight users when
this container rolls?" If the answer is "they lose state" — is that
acceptable, or does the state need DB persistence?

HF-D Phase 1.5 (PrismaEventStore) is the canonical example.

---

## Post-audit

1. **For every finding, file `docs/audit/HF-<letter>-evidence-*.md`.** Sibling to
   the existing HF-A → HF-P evidence docs. Each carries: SQL/probe query,
   result, classification (live vs latent vs deferred), recommendation.

2. **Update `docs/audit/PRODUCTION-READINESS-SCORECARD.md`.** Add rows to the
   findings table. Refresh the dimension matrix. Bump the REV-N revision.

3. **Wire structural enforcement into `kb:check` where possible.** An ESLint
   rule (`hf-security/*`) prevents the next-of-class. A CI script
   (`scripts/capture/check-*.ts`) catches drift over time. Document each in
   `docs/kb/guard-registry.md`.

4. **Lock the ratchets** (`.ratchet.json`). Any new finding produces a
   measurable baseline that can only drop.

5. **Write a HANDOFF doc** for any finding too big to close in the audit
   session (see `docs/audit/HANDOFF-large-file-refactor.md` for the template).

6. **Run `qmd embed`** so the audit docs are discoverable by future agents.

## When to re-run the audit

- Before every major release.
- Quarterly otherwise.
- After any incident that surfaces a vulnerability class the audit didn't
  catch — add the new probe to this runbook so the next audit covers it.
- When `kb:check` drops a ratchet — that's a signal something improved;
  audit confirms there isn't a sibling regression.
