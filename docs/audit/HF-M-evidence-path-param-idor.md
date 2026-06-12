# HF-M — Path-param `[callerId]` IDOR sweep

A late finding from the production-strength audit closeout (see
`PRODUCTION-READINESS-SCORECARD.md` and the follow-on "what other checks"
sweep on 2026-06-12). Promoted to its own row because it's a real PII leak
that any STUDENT can exploit today.

## The leak

`lib/permissions.ts::requireAuth(minRole)` checks
`userLevel >= ROLE_LEVEL[minRole]`. Per `lib/roles.ts`:

```
SUPERADMIN  = 5
ADMIN       = 4
OPERATOR    = 3
EDUCATOR    = 3
SUPER_TESTER= 2
TESTER      = 1
STUDENT     = 1   ← admitted by requireAuth("VIEWER")
DEMO        = 0
VIEWER      = 1   ← @deprecated alias for TESTER level
```

`requireAuth("VIEWER")` therefore admits **STUDENT, TESTER, SUPER_TESTER, EDUCATOR,
OPERATOR, ADMIN, SUPERADMIN**.

The #977 fix added `resolveCallerScopeForReading` to bolt STUDENT-scope onto
`?callerId=` query-param routes (then wired it into `/api/calls`, `/api/goals`,
`/api/memories`). The path-param family (`/api/callers/[callerId]/...`,
`/api/caller-graph/[callerId]/...`) was **never patched**. STUDENT could
supply any victim's callerId in the URL and read the response.

The worst-case route was
`/api/callers/[callerId]/snapshot` — it returns name, email,
**personality profile**, **all memories**, **all call scores**, **all calls with
transcripts**, **caller identities**, and composed prompts in a single GET.

## The other auth pattern

A second batch of routes use `requireEntityAccess("callers", "R")` instead of
`requireAuth(...)`. That helper loads the `ENTITY_ACCESS_V1` contract from
`SystemSetting`. The contract's STUDENT × callers cell is **`OWN:R`** (verified
via psql on hf_sandbox 2026-06-12):

```
STUDENT → callers: OWN:R
```

`requireEntityAccess` returns `{ session, scope: "OWN" }` for STUDENT. The
caller is expected to apply the scope via `buildScopeFilter(scope, session,
ownerField)` before the Prisma query. **None of the 5 path-param routes that
use this helper actually consumed the `scope`** — they treated it as a plain
auth gate and let STUDENT read any callerId.

Same blast radius as the requireAuth class.

## Routes patched in HF-M (this commit)

26 handler-sites across 26 route files (most files = 1 handler; the base
`callers/[callerId]/route.ts` has 3 handlers — GET/PATCH/DELETE — all guarded
for defence-in-depth even though `requireEntityAccess(..., "U"|"D")`
blocks STUDENT at the contract gate today).

### Pattern A — `requireAuth("VIEWER")` (20 handlers in 15 files)

| Route | Pre-HF-M auth | PII surface |
|---|---|---|
| `/api/caller-graph/[callerId]` (GET) | `requireAuth("VIEWER")` | Full graph: caller, identities, memories, calls, goals, targets |
| `/api/callers/[callerId]/calls` (GET) | `requireAuth("VIEWER")` | All calls per caller |
| `/api/callers/[callerId]/trust-progress` (GET) | `requireAuth("VIEWER")` | Trust progression timeline |
| `/api/callers/[callerId]/snapshot` (GET) | `requireAuth("VIEWER")` | **Everything** — full export incl. transcripts (worst-case) |
| `/api/callers/[callerId]/artifacts` (GET) | `requireAuth("VIEWER")` | Generated artifacts |
| `/api/callers/[callerId]/voice-provider` (GET) | `requireAuth("VIEWER")` | Active voice config |
| `/api/callers/[callerId]/media-history` (GET) | `requireAuth("VIEWER")` | Media play history |
| `/api/callers/[callerId]/lo-progress` (GET) | `requireAuth("VIEWER")` | Per-LO mastery scores |
| `/api/callers/[callerId]/module-progress` (GET) | `requireAuth("VIEWER")` | Per-module progress |
| `/api/callers/[callerId]/slugs` (GET) | `requireAuth("VIEWER")` | Resolved slug map |
| `/api/callers/[callerId]/journey-progress` (GET) | `requireAuth("VIEWER")` | Journey state |
| `/api/callers/[callerId]/learning-trajectory` (GET) | `requireAuth("VIEWER")` | Skills/module trajectory |
| `/api/callers/[callerId]/effective-behavior-targets` (GET) | `requireAuth("VIEWER")` | Resolved behavior targets |
| `/api/callers/[callerId]/active-playbook` (GET) | `requireAuth("VIEWER")` | Active enrollment |
| `/api/callers/[callerId]/available-media` (GET) | `requireAuth("VIEWER")` | Media options |
| `/api/callers/[callerId]/actions` (GET) | `requireAuth("VIEWER")` | Pending actions |
| `/api/callers/[callerId]/aggregate` (GET) | `requireAuth("VIEWER")` | Aggregate scores |
| `/api/callers/[callerId]/exam-readiness` (GET) | `requireAuth("VIEWER")` | Exam-readiness signal |
| `/api/callers/[callerId]/enrollments` (GET) | `requireAuth("VIEWER")` | Enrolled playbooks |
| `/api/callers/[callerId]/compose-prompt` (GET) | `requireAuth("VIEWER")` | Most-recent composed prompt |
| `/api/callers/[callerId]/last-selected-module` (POST) | `requireAuth("VIEWER")` | **Mutation:** writes Caller.lastSelectedModuleId |

### Pattern B — `requireEntityAccess("callers", "R")` (5 handlers in 5 files)

| Route | Pre-HF-M auth | PII surface |
|---|---|---|
| `/api/callers/[callerId]` (GET) | `requireEntityAccess("callers", "R")` returning `scope: OWN` for STUDENT — but scope ignored | Full caller payload — profile, memories, calls, scores, goals, learner profile |
| `/api/callers/[callerId]` (PATCH) | `requireEntityAccess("callers", "U")` — STUDENT blocked at contract gate | (no IDOR today; guard is defence-in-depth in case STUDENT gets U scope later) |
| `/api/callers/[callerId]` (DELETE) | `requireEntityAccess("callers", "D")` — STUDENT blocked at contract gate | (defence-in-depth) |
| `/api/callers/[callerId]/status` (GET) | `requireEntityAccess("callers", "R")` | Recent calls status (lightweight poll endpoint) |
| `/api/callers/[callerId]/cohorts` (GET) | `requireEntityAccess("cohorts", "R")` | Cohorts owned by caller (teacher/tutor) |
| `/api/callers/[callerId]/uplift` (GET) | `requireEntityAccess("callers", "R")` | Uplift metrics (survey deltas, score trends) |
| `/api/callers/[callerId]/export` (GET) | `requireEntityAccess("callers", "R")` | **GDPR SAR export** — full data dump |

## The guard

Each handler now carries this 5-line preamble right after the auth check + the
`const { callerId } = await params;` extraction:

```ts
// HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
// a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
// their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
if (!studentAllowedToReadCaller(<authVar>.session, callerId)) {
  return callerScopeMismatchResponse();
}
```

`studentAllowedToReadCaller` (`lib/learner-scope.ts:76`) is a synchronous
JWT-claim check — no DB hit. The pattern:

- **Non-STUDENT roles** (TESTER, OPERATOR, ADMIN, etc.): `return true` —
  passthrough, all existing admin browsing behaviour preserved.
- **STUDENT**: returns `true` iff `resourceCallerId === session.user.learnerCallerId`
  (stamped on the JWT at sign-in by A5). A foreign callerId returns false →
  the handler returns `callerScopeMismatchResponse()` (403).
- **STUDENT with no `learnerCallerId` claim**: returns false (defence in depth
  — a STUDENT without a LEARNER profile shouldn't read any caller's data).

This is **identical** to the pattern #977 used for query-param routes; HF-M
just sweeps it into the path-param family.

## Routes NOT patched (and why)

Routes that ALREADY had STUDENT-scope enforcement, OR are OPERATOR-only at the
auth gate:

- `/api/callers/[callerId]/phone` (PATCH) — already routes through
  `resolveCallerScopeForReading` per #977. No change needed.
- `/api/callers/[callerId]/behavior-targets` (GET/PATCH) — `requireAuth("OPERATOR")`,
  STUDENT can't reach.
- `/api/callers/[callerId]/eval-prompt` (POST) — `requireAuth("OPERATOR")`.
- `/api/callers/[callerId]/prompt-staleness` (GET) — `requireAuth("OPERATOR")`.
- `/api/callers/[callerId]/session-flow-progress` (GET) — `requireAuth("OPERATOR")`.
- `/api/callers/[callerId]/reset` (POST) — `requireAuth("OPERATOR")`.
- `/api/callers/[callerId]/actions` (POST) — `requireAuth("OPERATOR")`. (The
  same file's GET handler IS patched — it admits VIEWER.)
- All `aggregate / exam-readiness / enrollments / compose-prompt` POST handlers
  in the same files — OPERATOR-gated.

## What this commit does NOT cover

- **STUDENT-scoped mutations** — the guard rejects writes that target a foreign
  callerId, but there are no audit-side mutations a STUDENT can do today
  (every PATCH/POST/DELETE on caller-scoped routes is OPERATOR+ at the gate
  OR already STUDENT-strict). If a STUDENT-writable mutation lands later, it
  MUST add the same `studentAllowedToReadCaller` check before the DB write.
- **Non-`callers/[callerId]/...` path-param families** — `[playbookId]`,
  `[domainId]`, `[callId]`, `[cohortId]` etc. should each get their own
  parallel sweep. STUDENT's role-level admits them too. Filed as a follow-on
  tracker below.
- **The query-param family covered by #977** — `/api/calls`, `/api/goals`,
  `/api/memories` already use `resolveCallerScopeForReading`. Pattern is the
  same; helper is the only difference (sync JWT vs async DB).

## Follow-on tracker

- HF-M.1 — apply the same sweep to `[playbookId]`, `[domainId]`, `[callId]`,
  `[cohortId]` path-param families (probably 30+ more routes).
- HF-M.2 — add a structural ESLint rule
  `hf-security/no-unscoped-path-param-route` that fires on any route file
  whose path contains `[<entity>Id]` and whose handlers don't either:
  (a) call `studentAllowedToReadCaller` / `resolveCallerScopeForReading`, OR
  (b) `requireAuth(minRole)` where `minRole` admits no scopes-bearing roles
  (i.e. minRole >= OPERATOR). The rule would have caught HF-M structurally
  rather than via manual audit.
- HF-M.3 — promote the existing `route-auth-coverage.test.ts` from "every
  route calls requireAuth" → "every STUDENT-admitting `[callerId]` route
  calls the scope guard". This is the testable form of HF-M.2.

## Verified by

- `tests/api/idor-path-param-callerid.test.ts` (new in this commit) — pins
  the guard fires on snapshot (worst-case) for a STUDENT supplying a foreign
  callerId, AND passes through for OPERATOR.
- `npx tsc --noEmit` count unchanged from baseline (335 == 335 verified via
  stash/pop diff — proves zero new tsc errors introduced).
- `npx vitest tests/api/idor-path-param-callerid.test.ts` passes.
- `npm run kb:check` ✔ all 7 guards green.
- Spot-check via `grep -c "studentAllowedToReadCaller" app/api/callers/\[callerId\]/*/route.ts`:
  every patched route returns 2 (import + guard) for single-handler files;
  base `callers/[callerId]/route.ts` returns 4 (import + 3 guards).
