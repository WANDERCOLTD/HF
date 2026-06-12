# What's Left After the Audit

Companion to `PRODUCTION-READINESS-SCORECARD.md` (REV-1). The scorecard records
findings; this file records open work — both audit follow-ons and the
larger production-readiness backlog the audit doesn't itself own.

Sorted by leverage (each row's BANG / BUCK ratio).

## P0 — Real blockers if they regress (small surface, high impact)

1. **HF-D P1 — intake intentId-as-bearer → opaque session cookie.**
   - Why: HF-D P0 added rate-limit + filename redaction, but `intentId` is
     still in the URL path. Cloud Run access logs, browser history, referer
     headers all hold the bearer. The fix is a `__hf_intake_sid` httpOnly +
     SameSite=Strict + Secure cookie; routes read from the cookie not the URL.
   - Must land before PrismaEventStore Phase 1.5 (disk persistence widens
     every leak window).
   - Effort: 1-2 days. Per `docs/audit/HF-D-evidence-pii-intentid-bearer.md` P1 #3.

2. **HF-M.1 — IDOR sweep for sibling path-param families.**
   - Why: HF-M closed the `[callerId]` family (26 routes). The same shape exists
     for `[playbookId]`, `[domainId]`, `[callId]`, `[cohortId]`. Each is its
     own scan + scope helper + sweep. Probably 30+ more routes total.
   - The HF-M.2 ESLint rule only covers `[callerId]`. Extend per entity as the
     sibling helpers land in `lib/learner-scope.ts`.
   - Effort: 1 sprint per entity family.

3. **`npm audit fix --force` pass.**
   - Why: 6 residual high+crit deps. `next` is a same-major patch (16 → 16.2.9).
     promptfoo + transitive (otlp + protobufjs) are dev-only.
   - Test pass needed because `--force` introduces breaking changes.
   - Ratchet `npm_audit_high_crit` (baseline 6) prevents regression.
   - Effort: half-day controlled sprint slot.

## P1 — Improvements that compound (audit-discovered, structural)

4. **HF-M.3 — promote `route-auth-coverage.test.ts` to also check scope guards.**
   - Today the gate asserts every route calls `requireAuth(...)`. Promote to
     also assert every STUDENT-admitting `[callerId]` route calls the scope
     guard. This is the testable form of HF-M.2 (the ESLint rule already
     prevents the next bug; the test verifies the fix is durable).
   - Effort: 2-4 hours.

5. **CSP enforce flip.**
   - Why: current default is `Content-Security-Policy-Report-Only` unless
     `CSP_ENFORCE=true`. Policy already includes `'unsafe-inline'` for scripts
     + styles (themeInitScript dependency), so flipping enforce is a no-op
     safety improvement at first. Operator time it with a deploy.
   - Follow-up: nonce-based replacement of `'unsafe-inline'` for scripts.
   - Effort: 1 hour to flip; 1 sprint to nonce.

6. **Provider API key encryption-at-rest (#1031 R1).**
   - Why: `VoiceProvider.credentials` is plaintext Json. AES-256-GCM
     application-layer encryption with a Cloud KMS DEK is the standard.
   - Threat model is bounded by DB-access discipline; the deferral is
     explicit per the author's TODO comment.
   - Effort: 1-2 sprints (KMS integration + transparent transformer + migration
     for existing rows).

7. **HF-M.4 — generalize the scope-guard pattern.**
   - Today: 2 helpers (`studentAllowedToReadCaller` JWT-sync,
     `resolveCallerScopeForReading` DB-async). One pattern per entity.
   - Idea: a single `requireOwnership({ session, entity: "caller", id })` helper
     that resolves the right check per entity, with the JWT cache as fast path.
   - Effort: 1 week refactor; reduces per-route boilerplate from 5 lines to 1.

## P1 — Code health (audit-adjacent)

8. **Refactor the 3 hotspots.** See `HANDOFF-large-file-refactor.md`.
   - `app/api/calls/[callId]/pipeline/route.ts` (4258 lines)
   - `lib/chat/admin-tool-handlers.ts` (3092 lines)
   - `lib/chat/wizard-tool-executor.ts` (2900 lines)
   - Recommended order: wizard (coldest) → admin-tool-handlers → pipeline (hottest).
   - Effort: 2-4 sprints. Each is its own branch + PR + deploy slot.

9. **HF-H knip ratchet burn-down.**
   - Baseline 161 unused exports/types. Pure deletion + verification.
   - Effort: per-cluster pull requests (e.g. 10-20 exports per PR).
   - Each PR lowers `knip_unused` in `.ratchet.json` and locks the win.

10. **HF-G per-file tsc burn-down.**
    - 9 guard-bearing files have per-file zero-tolerance. Migrate more files
      into the protected set as the global `tsc_errors` baseline drops.
    - Effort: per-PR clean-up.

## P2 — Hardening the audit pipeline itself

11. **CI integration of `kb:npm-audit-ratchet`.**
    - The ratchet runs in `kb:check`, but is `kb:check` actually in the GitHub
      Actions workflow? Verify and wire if missing. Without CI, the ratchet
      only fires when humans run it locally.
    - Effort: 1 hour.

12. **`dependabot.yml`** — weekly auto-PR for transitive dep bumps. Let
    `kb:npm-audit-ratchet` decide which PRs are safe.
    - Effort: 30 minutes.

13. **Schedule the next audit.**
    - This audit ran 2026-06-11/12. The natural cadence is quarterly OR
      before major releases, whichever comes first. Add a `croncreate`
      reminder or a calendar entry.
    - Effort: 5 minutes.

## P2 — Things the audit did NOT cover (out-of-scope but visible)

14. **Performance / load testing.**
    - Market test bounded to 100 users; synthetic load probe is still useful
      before scaling beyond that.
    - Use `k6` or `artillery` against the hf-staging environment.
    - Effort: 1 week to build harness + 1 day per run.

15. **Disaster recovery / backup restore drill.**
    - Cloud SQL has point-in-time recovery enabled per `docs/CLOUD-DEPLOYMENT.md`.
    - Never tested. Schedule a tabletop exercise.
    - Effort: half-day exercise; the operator runs the restore on a copy.

16. **Accessibility / WCAG conformance.**
    - Out of scope for a code audit; `ui-reviewer` + `ux-reviewer` agents own.
    - Effort: ongoing.

17. **GDPR DSAR completeness.**
    - The `/api/callers/[callerId]/export` route exists (HF-M-patched).
    - Has anyone verified it ACTUALLY exports everything? E.g. recent calls,
      voice config, last-selected-module, etc.
    - Effort: 2 hours to enumerate model coverage; pin with a test.

18. **API documentation freshness.**
    - The `@api` JSDoc comments are scanned by `scripts/api-docs/generator.ts`.
    - Run `npm run docs:api:check` and see if every route is documented.
    - Effort: continuous; check per-PR.

19. **TODO / FIXME debt triage.**
    - `lib/cascade/resolvers/identity-spec.ts` carries 6 TODOs.
    - `lib/cascade/resolvers/behavior-target.ts` carries 5.
    - Could be intentional (recent code under design) — triage call.
    - Effort: 1-2 hours.

20. **Container restart resilience review for in-memory state.**
    - `lib/intake/session-store.ts` is in-memory (`globalForIntake.__hfIntakeSessions`).
    - `lib/rate-limit.ts` is in-memory.
    - `lib/voice/provider-factory.ts` cache is in-memory.
    - For each: what happens on Cloud Run cold start / roll? In-flight users
      lose state. Acceptable for some (rate-limit re-arms); not for others
      (intake mid-flight).
    - Effort: 1 day analysis + design + per-store decision.

## How to triage what to do next

After the audit closes, the highest-leverage next step depends on the release
timeline:

- **Pre-market-test:** HF-D P1 + HF-M.1 + the `npm audit fix --force` pass.
  These three close the remaining production-blocker shapes.
- **Post-market-test:** the 3 file refactors + provider encryption-at-rest +
  performance/load harness. These compound: each lowers ongoing
  change-cost by enough that the team gets back ~1-2 weeks per quarter.
- **Anytime:** schedule the next audit. Without a scheduled re-audit, the
  baselines drift.

Don't try to do all 20. Pick the top 3-5 for the next sprint, write tickets
for the rest, and re-prioritize when the sprint plans.
