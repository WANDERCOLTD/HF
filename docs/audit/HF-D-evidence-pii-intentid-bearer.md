# HF-D — PII intentId-as-bearer security review

Follow-up to commit `85fe3d72` ("fix(auth): re-enable route-auth-coverage gate +
add guard-test quarantine sentinel"), which re-enabled the route-auth-coverage
gate by reconciling `PUBLIC_ROUTES` with the 8 EnrollmentIntake routes. The
commit body flagged:

> SECURITY NOTE (HF-D follow-up): intake/session/[intentId] + audit-bundle
> return PII keyed only by intentId. That intentId-as-bearer posture for PII
> is intentional + documented, but warrants a dedicated security review —
> flagged in the PUBLIC_ROUTES comment, not silently blessed.

This doc is that review.

## Scope

8 routes are public-by-design:

| Route                                        | Verb | Body / param          | PII returned?                                         |
| -------------------------------------------- | ---- | --------------------- | ----------------------------------------------------- |
| `/api/intake/bootstrap`                      | POST | (creates intentId)    | No (returns new intentId)                             |
| `/api/intake/v2/start`                       | POST | (creates intentId)    | No (returns new intentId; rate-limited per IP)        |
| `/api/intake/chat`                           | POST | body.intentId         | Echoes session messages on each turn                  |
| `/api/intake/session/[intentId]`             | GET  | URL path              | **Full session** — events, values, messages, state    |
| `/api/intake/audit-bundle?intentId=…`        | GET  | URL query             | **Full bundle** — all PII captured during intake      |
| `/api/intake/audit-bundle/[intentId]`        | GET  | URL path; ?format=jsonl| **Full bundle**; JSONL form includes intentId in `Content-Disposition` filename |
| `/api/intake/disclosure-acknowledge`         | POST | body.intentId         | None (mutates session — appends DisclosureAcknowledged event) |
| `/api/intake/disclosure-signal`              | POST | body.intentId         | None (mutates session — appends DisclosureSignal event) |

The 6 bearer routes admit a request iff the supplied `intentId` matches a
session in the in-memory store (`lib/intake/session-store.ts`). No other
authentication is performed.

## Token shape

`intent-${randomUUID()}` (from `lib/intake/session-store.ts:77`). `randomUUID()`
is `node:crypto`-backed v4 UUID — **122 bits of entropy**. Brute-force
guessing at any plausible attack rate is infeasible (a 2^61 attempt-per-second
attacker would expect a single guess after the heat death of the sun).

**Brute force is not the threat model.** Leakage is.

## Threat model

| #  | Vector                                                          | Severity | Why                                                                                       |
| -- | --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| T1 | Cloud Run / Cloudflare access-log leakage                       | **High** | `intentId` appears in path/query — anyone with log-read on the platform gains PII access  |
| T2 | Browser history / bookmark / shared screenshot                  | High     | Path-form URLs end up in `~/.config/Google/Chrome/History` and screen-share artefacts     |
| T3 | Referer-header leakage on outbound link clicks                  | Medium   | `intake/done?intentId=…` → user clicks an external link → that origin's logs hold the bearer |
| T4 | Filename-as-credential leak (JSONL download)                    | Medium   | `Content-Disposition: filename="enrollment-${intentId}.jsonl"` — the saved file's name IS the bearer; leaks via email attachments, file-share links, archived backups |
| T5 | Enumeration / scraping of an attacker-known intentId set        | Low–Med  | No rate limit on the GET PII routes — an attacker who has scraped a batch of intentIds (e.g. from a log dump) can pull every bundle at line-rate                  |
| T6 | Forever-valid sessions                                          | Medium   | In-memory store has no TTL; sessions live until the container is replaced. Cloud Run rolls every ~1 day, but a leaked intentId remains valid for a full day on a hot container, and longer when traffic keeps a container alive |
| T7 | CSRF on the POST bearer routes                                  | Low      | The body-keyed routes (`disclosure-acknowledge`, `disclosure-signal`, `chat`) would let an attacker mutate session state IF they know the intentId. Auth is bearer-only, so they need the secret first — circular |
| T8 | Disk persistence in PrismaEventStore                            | Medium   | The comment in `audit-bundle/route.ts` mentions "Phase 1.5 wires PrismaEventStore-backed retrieval". Once persisted, sessions outlive the container and the leakage windows of T2/T3/T4 widen accordingly |

The leakage vectors (T1–T4) are the ones to address structurally; T5–T6 are
operational hardening; T7 is a non-issue under the current model; T8 is a
heads-up for the planned persistence move.

## Posture vs industry baselines

| Pattern                                         | Where it'd be a session cookie                | HF-D uses                  |
| ----------------------------------------------- | --------------------------------------------- | -------------------------- |
| Multi-page pre-auth flow (Stripe Checkout)      | `__stripe_sid` httpOnly cookie                | `intent-${uuid}` in URL    |
| Document signing flow (DocuSign)                | Cookie + JWT with `exp` claim                 | URL bearer, no expiry      |
| KYC verification (Persona / Onfido)             | Signed JWT + iframe-isolated origin           | URL bearer, host-shared    |

The URL-bearer posture is consistent with low-stakes anonymous flows (e.g.
guest checkout, support ticket links). It's below baseline for PII-bearing
flows.

## Recommendations

### P0 — Immediate hardening (small, this commit)

1. **Rate-limit the 4 PII-returning GET routes.** Mirror
   `/api/intake/v2/start`: `checkRateLimit(getClientIP(req), "intake-pii-read")`
   with the standard window (5 attempts / 15 min by default). Stops bulk
   scraping of a leaked-intentId batch (T5). Applied in this commit.

2. **Strip `intentId` from the JSONL download filename.** `Content-Disposition:
   filename="enrollment-${intentId}.jsonl"` makes the saved file's NAME the
   bearer. Hash it instead, or use a static name with timestamp.
   Applied in this commit.

### P1 — Structural hardening (next sprint)

3. **Move `intentId` from URL → opaque session cookie.** Mint a
   `__hf_intake_sid` httpOnly + SameSite=Strict + Secure cookie at
   bootstrap/v2-start; bearer routes read the cookie instead of the URL
   param. Eliminates T1–T4 entirely. Cookie path can scope to `/api/intake/` +
   `/intake/`. Requires:
   - server-side bootstrap to `Set-Cookie` the intentId on response.
   - client pages (`/intake/done`, `/intake/audit`) stop reading `intentId`
     from URL params and trust the cookie.
   - audit-bundle download streams via a POST + `Content-Disposition` (no
     URL param at all).

4. **Add session TTL.** 24-hour absolute expiry, 1-hour idle expiry. Reject
   bearer with a 410 Gone (different from 404 so consumers can distinguish
   "never existed" from "expired"). Closes T6. Requires a `expiresAt` field
   on `IntakeSession` and a check in `getSession`.

### P2 — Operational controls

5. **Cloud Run access-log redaction filter** — replace `intentId` path
   parameter with `*` in retained logs (path pattern matching is built in to
   the GCP log sink config).

6. **Audit log of bearer-route access** — write an `AppLog` row on each
   bearer-route hit (intentId hash, IP, UA, route, status). Lets an
   after-the-fact compromise investigation enumerate which intentIds were
   pulled by which IPs.

7. **PrismaEventStore migration design (Phase 1.5)** — when moving to
   persistent storage, the leak windows widen materially. P1 #3 (cookie
   bearer) and P1 #4 (TTL) should land BEFORE this move, not after.

## Quick wins applied in the same commit as this doc

See the sibling commit:
- `lib/rate-limit.ts` — new key family `intake-pii-read` (mirrors
  `intake-v2-start` configuration).
- `app/api/intake/session/[intentId]/route.ts` — `checkRateLimit` on GET.
- `app/api/intake/audit-bundle/route.ts` — `checkRateLimit` on GET.
- `app/api/intake/audit-bundle/[intentId]/route.ts` — `checkRateLimit` on
  GET + sanitised `Content-Disposition` filename
  (`enrollment-<intentId-prefix>-<timestamp>.jsonl`, dropping the full UUID).

These do not eliminate the URL-bearer posture, but they remove the two largest
single-incident vectors (filename-as-credential leak; line-rate scraping of a
batch) without restructuring the cookie surface. P1 + P2 remain for the
follow-on sprint.

## What this review does NOT do

- It does NOT bless the URL-bearer posture as the long-term design.
- It does NOT cover the `bootstrap` / `v2/start` entry routes' anti-abuse
  posture beyond noting that `v2/start` IS rate-limited and bootstrap is not.
- It does NOT cover the `disclosure-acknowledge` / `disclosure-signal` body-
  schema integrity (those are covered by `lib/intake/hf-adapter/disclosure-store.ts`
  and the `deriveDisclosureId` guard documented in `.claude/rules/ai-to-db-guard.md`).

## Follow-on tracker

After this commit:
- Open issue: "HF-D P1 — move intake intentId from URL → opaque session cookie"
- Open issue: "HF-D P1 — add 24h TTL to IntakeSession"
- Open issue: "HF-D P2 — Cloud Run access-log redaction of `intent-` path params"
- Open issue: "HF-D P2 — audit log on bearer-route hits"
- Open issue: "HF-D — landmine check before PrismaEventStore migration (Phase 1.5 prereq)"

The route-auth-coverage gate stays green (PUBLIC_ROUTES unchanged); the
exemptions documented in the test file's header comment are now backed by
this review.
