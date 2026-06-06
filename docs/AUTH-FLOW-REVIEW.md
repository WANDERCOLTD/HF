# Auth & Enrolment Flow Review

> Captured 2026-06-06. Walk-through of every auth touchpoint in HF today, framed as scenarios, with industry comparisons and design forks. **Phone-first is the stated priority.** This document is a review brief to align on before scoping the SMS adapter (#1133) and any V2 / `/login` changes.

## 1. The mental model

There are three distinct things HF treats as auth, and they get confused in conversation. Worth separating:

| Concept | Purpose | Lifetime | Tool |
|---|---|---|---|
| **Identity proof** | "Is this account really controlled by the human in front of us?" | One-time, per channel | PIN over email/SMS (a.k.a. OTP / verification code) |
| **Session** | "We've already proven this human; don't ask again" | Days–weeks, scoped to a device | NextAuth JWT cookie (30 days) |
| **Recovery** | "I lost my device/session — let me back in" | Triggered on demand | Magic link, OAuth, password, phone OTP |

Industry: WhatsApp uses (1) only — phone OTP every time you set up a new device, no passwords, no email. Slack uses (1)+(2)+(3) with email as the recovery channel. Stripe forces (1)+(2)+(3) with 2FA on top.

HF today: (1) is half-built (email-only PIN at first-call), (2) is fine (JWT 30d), (3) is uneven (email magic-link works, OAuth env-gated, phone rejected).

## 2. Scenario walk-through

### S1 — New learner, has both phone + email (the easy one)

| Step | HF V2 today | What happens |
|---|---|---|
| Hit `/intake/v2/<token>` | Enters email | Server creates `User` + `Caller`, issues email PIN, mints session, redirects to finish page |
| Enter PIN from email | Verified | Drops into spec-driven chat; chat collects firstName / lastName / phone / ageRange |
| First sim call | Sees `FirstCallPinGate` | But the PIN was *already* issued at intake and verified — gate skipped because `verifiedAt` is set |

**Industry equivalent:** Notion / Stripe — email first, OAuth second, MFA-by-app later. This path is fine.

**Note the redundancy:** the "first-call PIN gate" was designed for the V1 flow (chat-first → email-after → PIN gates the *call*). In V2 the PIN is verified at intake, so the call gate is a no-op for V2 learners. That's intentional — same component, two entry points. Not a bug, but worth knowing it's a single one-shot gate, not a recurring check.

### S2 — New learner, **phone only** (the priority)

This is where HF breaks today.

| Surface | Today | What's needed for phone-first |
|---|---|---|
| `/intake/v2/<token>` | Auto-detects phone, but does nothing with it; only `EMAIL_RE.test()` proceeds | Accept phone → create `User` with `phone` (not `email`) → issue SMS OTP → finish flow |
| PIN delivery | `lib/messaging/adapters/noop-sms.ts` is stubbed but never wired | Real SMS adapter (Twilio Verify or equivalent) registered in `MessagingProvider` table |
| `User` schema | `email` is unique-but-nullable; `phone` lives on `Caller`, not `User` | `User.phone` mirror so NextAuth can identify the principal by phone |
| NextAuth provider | No phone provider exists | Custom CredentialsProvider that accepts `{phone, otp}` and looks up `User.phone` |
| Recovery | `/login` rejects phone | Phone field needs to mint SMS OTP and a session, same shape as magic-link |

**Industry equivalents:**

- **WhatsApp** — phone only, every device set-up is a fresh SMS OTP. No password, no email. Loses the phone = loses everything (until they added "two-step verification" PIN as a soft recovery).
- **Telegram** — phone primary; you can later add email as recovery. Multi-device with cloud key.
- **Uber / Deliveroo** — phone OTP at sign-up, magic-link or OAuth on top, account is the phone number.
- **Indian fintech (PhonePe / Paytm)** — phone OTP is the *only* auth most users ever see.

**Design forks for HF:**

1. **Phone as identifier, email optional later.** WhatsApp pattern. Simplest mental model. Highest lockout risk — losing the phone is losing the account. Recovery requires admin escalation or, eventually, a recovery email.
2. **Phone OR email, either is sufficient.** Telegram / Uber pattern. Slightly more complex schema (`User.phone` AND `User.email` both unique + nullable; OAuth needs to attach to whichever is present). Best UX for global audiences.
3. **Phone primary + mandatory email after first session.** Banking pattern (e.g. Monzo). Highest recovery floor. Friction at the wrong moment for learners.

For HF's learner profile (Crawcus, IELTS, ELT — non-US, often sub-18, family-shared email), **(2)** is the best fit. But it doubles your messaging-spend exposure (every PIN now might go SMS) so the `MessagingProvider` resolver needs a real cost model.

### S3 — First call, PIN gate

| Today | Industry |
|---|---|
| Gate fires on first sim visit if `CallerIdentityChallenge.verifiedAt IS NULL`. One challenge per caller, 24h expiry, 5-attempt lockout, 3-resend cap. PIN goes to email only. | Closest analog is WhatsApp Voice — when you call from a new device, it OTP-verifies before the call. Banking IVR adds voice-print over time. |

**What's missing:**

- **Re-verification on suspicious events.** A new device, a long absence, a phone-number change → today, none of these re-trigger a PIN. Industry would re-OTP on any of these.
- **Voice-print attestation.** The PIN gate is the proxy for now. SpeechAce/SpeechSuper could fingerprint the voice on the first verified call and flag drift on subsequent calls. (Parked.)
- **Channel choice.** Caller's `preferredContactMethod` is captured but `issueFirstCallPin` hard-codes email (open issue #1133). Phone-first means this *must* be fixed before market test.

### S4 — Returning learner, day 31 (session expired)

| Channel they have | What works today | What should work |
|---|---|---|
| Email only | `/login` → magic link → in | Same |
| Phone only | `/login` rejects phone with "coming soon" — **stuck** | SMS OTP, mirror of magic link |
| Email + Google OAuth used at signup | If `GOOGLE_CLIENT_ID` is set, "Continue with Google" works | Same; needs creds in env (operator task) |
| Forgot which email they used | No discovery path | Common gap — Slack handles by emailing all their accounts on request |

**Industry pattern for returning user:**

- **Slack** — email field → if known, magic link; if not, "We don't recognize that email" + signup flow. Account is global; workspaces are joined.
- **Notion** — email field → magic link OR OAuth (if you've linked Google/Apple before). No password by default.
- **Discord** — email + password mandatory, "forgot password" via email reset.
- **WhatsApp** — phone field → SMS OTP every time on new device. No "remember me" across reinstalls.

HF's magic-link is the right pattern; the gap is phone parity.

### S5 — Returning learner, new device (most common in practice for learners)

Same as S4 — JWT cookie lives in one browser. Learners switching from school laptop to home phone is just S4 with extra steps. This is the killer case for phone-first: a learner who enrolled on a school Chromebook hitting `/login` from their phone has to either remember the email *they* used (often shared with a parent) or have OAuth/phone available.

### S6 — Learner enrolled via OAuth, then OAuth account compromised

| Today | Industry |
|---|---|
| `/login` → Google OAuth → in. No fallback if Google is lost. `AUTH_OAUTH_REQUIRE_INVITE` controls whether OAuth signup is auto-create or invite-only. | Slack / Notion: OAuth attaches to the same `User` row keyed on verified email — you can lose Google but still receive a magic link. Discord: requires a separate email + password as a fallback regardless. Apple OAuth ("Hide my email") creates per-app aliases that *do* forward — but if you revoke them, account recovery is grim. |

HF inherits NextAuth's `PrismaAdapter` behaviour: OAuth `Account` rows link to a `User` by verified email. So a learner who signed up with Google + the same email as a prior magic-link is one human, recoverable via the email channel. **Good default.** Only Apple's "Hide My Email" breaks this — the per-app alias means a future magic-link to that alias still routes to the human, but it's brittle. Filed in #1175.

### S7 — Family-shared email (sub-13 / ESL reality)

Two siblings enrolled in the same cohort with `parent@gmail.com`. Today:

- V2 sees `email` matches an existing `User` → attaches new `Caller` to that user → both kids end up as the *same* logged-in identity, just toggling between callers.
- This may or may not be what you want. WhatsApp solves it by phone-per-child. ClassDojo solves it with a parent account that owns multiple students.

If phone-first ships, this almost solves itself — each kid has their own phone (or each gets their own SMS PIN to a parent's phone with a label).

### S8 — Admin / educator session

`requireAuth` levels are independent of identity-channel. Admins sign in via password today; the magic-link / OAuth paths work for them too. The `?as=learner` query-param hotfix shipped 2026-06-06 lets admin demo the gate without signing out. No phone-first concerns here — admins are email-and-password-driven by convention.

## 3. Where HF lands vs the industry today

| Capability | HF today | Slack | WhatsApp | Notion | Stripe | What HF needs |
|---|---|---|---|---|---|---|
| Email magic link | ✓ | ✓ | — | ✓ | ✓ | — |
| Password login | ✓ (toggle) | ✓ | — | — | ✓ | — |
| Google OAuth | env-gated | ✓ | — | ✓ | ✓ | Operator adds creds |
| Microsoft OAuth | env-gated | enterprise | — | ✓ | enterprise | Operator adds creds |
| Apple OAuth | not built | ✓ | — | ✓ | — | #1175 (waiting on iOS app) |
| Phone OTP | rejected | — | ✓ (primary) | — | optional 2FA | **Top priority per current steer** |
| WhatsApp OTP | not built | — | — | — | — | Optional — high-value in IN / BR / SEA |
| Session length | 30d JWT | 30d | indefinite (device-bound) | 30d | 14d + 2FA refresh | — |
| Re-OTP on new device | no | yes (email confirm) | yes (full re-OTP) | yes (email confirm) | yes (2FA challenge) | Gap — no device fingerprint today |
| Account recovery (lost channel) | manual / no path | "email me my workspaces" | 2-step verify PIN | email reset | identity verification | Gap |

## 4. Concrete sequence: what phone-first would look like

If we decide to go phone-first, here's the cleanest ordering. Each row is roughly one PR. None of this is built yet — sketched for the design conversation.

1. **SMS adapter.** `lib/messaging/adapters/sms-twilio.ts` implementing the `MessagingProvider` interface. Seed a `MessagingProvider` row pointing at Twilio Verify (or a SignalWire equivalent for cheaper EU/UK SMS). Issue #1133 names this.
2. **`User.phone` mirror.** Schema migration: `User.phone` (unique, nullable). Backfill from `Caller.phone` where exactly one Caller per User has a phone. Resolves the "is phone on User or Caller" ambiguity that's been latent since #1101.
3. **Phone CredentialsProvider in NextAuth.** Accepts `{phone, otp}`, looks up `User.phone`, verifies against a fresh `CallerIdentityChallenge` keyed on phone instead of email. PIN flow becomes channel-agnostic; `issueFirstCallPin` reads `preferredContactMethod`.
4. **V2 entry — accept phone.** Drop the `EMAIL_RE` reject. Branch: `email` → existing path; `phone` → SMS adapter, otherwise identical.
5. **/login — accept phone.** Same branch, sending to NextAuth's new phone CredentialsProvider. Mirror of the magic-link UX.
6. **Recovery story.** If a learner has both phone *and* email recorded, allow either at `/login`. If only one is recorded, surface an "add a recovery channel" nudge after first sign-in (Telegram's pattern).
7. **WhatsApp OTP (optional).** WhatsApp Business Cloud API can deliver template messages with a code. Same `MessagingProvider` interface, different adapter. Cheaper than SMS in IN / BR; many learners have WhatsApp but no SMS plan.

Industry-grade: **Twilio Verify** is the boring-correct choice — handles rate-limiting, lockout, OTP generation, multi-channel fallback. Costs ~$0.05/verification in the UK. Cheap **but** the SMS itself is ~$0.04/message — call it $0.10 per phone PIN. Vs $0/email PIN. Worth modelling against expected re-auth frequency.

## 5. Questions worth deciding before phone-first ships

1. **Phone OR email, or phone primary?** (S2 forks). Affects schema + recovery UX.
2. **What happens to the existing email-only Users?** Migration or grandfather?
3. **When does a session re-trigger PIN?** New device today is silent. Phone-first means the answer matters more — losing your phone == losing access if no re-PIN on new device.
4. **Family-shared phone?** Two siblings sharing one parent's number — same problem as shared email (S7), but harder because the OTP has no name on it.
5. **SMS budget per learner.** Cohort of 500 learners × 1 re-PIN per term × £0.04/SMS = trivial. But if you re-PIN every new device → 4-5× that. Still small but worth knowing.
6. **WhatsApp OTP for non-UK?** Big saving in IN/BR/SEA, zero relevance in UK. Operator-configurable per institution via `MessagingProvider` rows.

## 6. Related issues + prior art in-repo

- [#1133](https://github.com/WANDERCOLTD/HF/issues/1133) — SMS adapter / channel choice in `issueFirstCallPin`
- [#1141](https://github.com/WANDERCOLTD/HF/issues/1141) — V2 auth-first epic (shipped 2026-06-06)
- [#1175](https://github.com/WANDERCOLTD/HF/issues/1175) — Apple Sign In + OAuth signup-policy decision
- [#1101](https://github.com/WANDERCOLTD/HF/issues/1101) — First-call PIN gate (shipped)
- `lib/messaging/` — `MessagingProvider` adapter registry + resolver
- `lib/voice/phone-format.ts` — E.164 normalisation (shipped 2026-06-06)
- `lib/identity/pin.ts` — PIN hashing + verify
- `app/api/identity/{challenge-status,verify-pin,resend-pin}/route.ts` — PIN endpoints

## 7. Status

- [ ] Reviewed with Paul
- [ ] Decision on S2 fork (1 / 2 / 3)
- [ ] Decision on re-OTP on new device
- [ ] BA + Tech Lead groom #1133 once fork is decided
- [ ] Update this doc with the decision + link out to an ADR
