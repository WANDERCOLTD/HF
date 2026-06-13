# ADR: PII encryption scope — what we encrypt and in what order

**Date:** 2026-06-13
**Status:** Accepted
**Deciders:** Paul W

## Context

Sibling decision to `2026-06-13-kms-envelope-encryption-prereq.md`. That ADR
establishes the KMS + envelope-encryption substrate; this ADR decides *which
columns* go through it and *in which order*.

The candidate columns, from the reuse-finder pass 2026-06-13:

| Column | Sensitivity | Write sites | Read sites that filter/search |
|---|---|---|---|
| `VoiceProvider.credentials` (JSON) | **High** — live API keys + webhook secrets | 3 (seed + 2 migrations) | 0 (slug-keyed lookup) |
| `Call.transcript` | **High** — conversational PII inside the text | ~70 | 0 directly; many *read* it but none `WHERE transcript LIKE …` |
| `CallMessage.content` | **High** — same shape | 8 | 0 |
| `Caller.email` | **Medium** — PII identifier | 39 routes + 32 seed | **4 legacy seed-only**; modern code does not filter by email |
| `Caller.phone` | **Medium** — PII identifier | (same) | **2 legacy seed-only**; modern code does not filter by phone |
| `Caller.name` | **Low-medium** — display name | (same) | 0 direct `LIKE` filters |
| `User.email` | **Medium** — auth identifier | 31 | **NextAuth depends on `findUnique({where:{email}})`** |
| `User.phone` | **Medium** | (same) | 0 |

The original cost analysis (in conversation 2026-06-13) priced full PII
encryption at "expensive + breaks search + needs KMS + low marginal benefit
vs Cloud SQL at-rest for current threat model." The reuse-finder then
**inverted one of those assumptions**: modern code rarely filters by email
or phone. Search regression cost is much smaller than feared. But **NextAuth
on `User.email` is a hard blocker** for `User` field encryption — the entire
credentials login flow keys off it.

The threat we are defending against is **leaked DB backup or live snapshot
clone reaching an attacker who does not also have live KMS access**. Cloud
SQL transparent at-rest handles disk theft but not snapshot exfiltration to
a 3rd-party storage bucket.

## Options considered

1. **Full PII encryption** — Caller + User + transcripts + credentials.
   ~6 weeks engineering. Forces redesign of NextAuth User.email lookup
   (hash-and-lookup pattern) and the GDPR export flow. Highest defensive
   posture; worst time-to-value.
2. **Credentials only (R1 / #1031)** — just `VoiceProvider.credentials`.
   ~1d after KMS substrate lands. Defends the realistic, highest-impact
   threat (leaked DB → 3rd-party billing fraud via stolen API keys). Doesn't
   touch any auditor-visible PII story.
3. **Credentials + transcripts** — the high-sensitivity content tier.
   Covers conversational PII (which is most of what an external auditor will
   ask about) without touching identifier columns. ~5d after KMS substrate.
   No search regression. No NextAuth blocker.
4. **Credentials + transcripts + Caller PII** — option 3 plus
   `Caller.{email,name,phone}`. ~10d total. Search regression is small
   (legacy seed sites only) but introduces a hash-shadow column pattern for
   the legacy filters and the `findUnique` on Caller.email if it exists.
   Touches `User` only at the edges.
5. **Defer indefinitely** — the do-nothing option. Cost: zero today, but
   the threat is real and the post-market-test pickup cost grows linearly
   with rows.

## Decision

**Adopt Option 3 — Credentials + transcripts.** Phased rollout:

### Phase 1 (immediate, on KMS substrate landing)

**`VoiceProvider.credentials`** — closes R1 / #1031 TODO.

- Column shape per the KMS ADR (`credentials_ciphertext`, `_iv`, `_wrappedDek`,
  `_kekVersion`). The existing `credentials Json` field is renamed
  `credentials_legacy_plaintext` for migration window, then dropped after backfill.
- Read site: `lib/voice/provider-factory.ts::getVoiceProvider` — calls
  `decryptColumn` before passing to the adapter. The 5-minute cache means KMS
  round-trip is amortised across many calls.
- Write site: admin UI `/x/settings/voice-providers/[id]` calls
  `encryptColumn` before `prisma.voiceProvider.update`.
- Backfill: idempotent migration script reads every row, encrypts plaintext,
  writes the encrypted tuple, leaves `_legacy_plaintext` populated until the
  follow-up drop migration.
- Effort: ~1d.

### Phase 2 (after Phase 1 ships)

**`Call.transcript` + `CallMessage.content`.**

- Same column-tuple shape on both. Existing column becomes the ciphertext
  field; the redacted/raw decision from `C3` (separate story) determines
  what plaintext we feed into encrypt.
- **Order with C3:** C3 (redaction) lands FIRST. Phase 2 encryption then
  encrypts both `transcriptRaw` and `transcript`. Inverting the order means
  Phase 2 encrypts the raw transcript, then C3 has to decrypt-redact-re-encrypt
  on every existing row.
- Pipeline read sites (`priorCallFeedback.ts`, `adaptive-loop-invariants.ts`,
  pipeline runners) all gain a `decryptColumn` call. Batch decrypt where
  list views fetch many rows.
- Admin transcript views (`/x/calls/[id]`, Course Design Preview) gain
  the same decrypt step.
- AppLog / verbose voice diag: per C3 read-path rules these always read the
  redacted column, which is still encrypted at rest but cheap to decrypt
  because it's already PII-scrubbed.
- Effort: ~3d after Phase 1, **plus** the dependency on C3 landing first.

### Out of scope (deferred or rejected)

| Item | Reason |
|---|---|
| `Caller.{email,name,phone}` encryption | NextAuth depends on `User.email` `findUnique` and the auth flow's design (#1133 SMS adapter epic) is in flux. Encrypting Caller PII without Encrypting User PII leaves a gap. Defer until the auth flow stabilises and we have a defensible end-to-end story. |
| `User.{email,phone}` encryption | NextAuth credentials provider keys off `User.email`. Encrypting it requires a hash-shadow column and a NextAuth adapter rewrite. Disproportionate cost — better to defer until we move to passkeys / OIDC where the email isn't on the auth hot path. |
| `CallerMemory.{key,value}` encryption | These are AI-derived structured facts, often quoting PII. Encrypting them solves a smaller surface than encrypting transcript (the transcript is the source). Wait until transcript encryption proves the pattern. |
| `CallerAttribute.value` encryption | Same as CallerMemory. |
| `IntakeEvent.payload` encryption | This is the auditor chain. Encryption would impede the auditor surface. Better to keep `intake_event` accessible in plaintext and rely on database access controls + retention to protect it. (Open follow-on: row-level access policies — separate decision.) |
| `Caller.externalId` encryption | Opaque token already; defeats the threat. |
| Indexed-search on encrypted columns (HMAC-hash sibling) | Not needed yet — modern code doesn't filter by email/phone. Add when a future feature requires it. |
| Re-encryption with new KEK version after rotation | Cron job, separate story. Phase 1 + Phase 2 just stamp `_kekVersion`; the re-wrap worker comes later. |

## Consequences

### Positive

- The realistic threat is closed quickly (Phase 1 — ~1d after KMS substrate).
- Conversational PII (the biggest auditor narrative item) gets encrypted in
  Phase 2 without breaking auth or search.
- No NextAuth rewrite required.
- Caller / User PII deferral is a real cost saving on the test-fixture burden
  (Caller is constructed in 100+ test fixtures; not having to thread
  encryption helpers through all of them is meaningful engineering hours).

### Negative

- **The Caller / User identifier columns remain in plaintext.** A leaked
  backup still reveals who-is-who at the identifier level. The defence
  applies only to the *content tier*. Document this honestly in the
  auditor-facing security page — don't claim full PII encryption.
- C3 (transcript redaction) is now a hard prereq of Phase 2. If C3 slips,
  Phase 2 slips.
- The "credentials are encrypted" Phase 1 win is small in surface area but
  defends a real-money threat (stolen API keys → 3rd-party billing fraud);
  it doesn't move the GDPR / auditor needle much.

### Reversibility

- Phase 1 (credentials): forward-only. Rolling back means decrypting every
  row before disabling. Cost: small (~10s of rows in prod).
- Phase 2 (transcripts): forward-only. Rolling back at scale is expensive
  (decrypt all calls). Mitigation: a feature flag `HF_PII_ENCRYPT_ENABLED`
  during the rollout window so we can disable new-write encryption while
  leaving existing rows encrypted-and-readable.

### Open follow-ons

- **Auth flow stabilisation** (#1133) — when SMS-first / passkey design
  lands, revisit Caller + User PII encryption.
- **Row-level access policies** for `intake_event` — if database-admin
  threat model tightens, restrict who can `SELECT` from the chain.
- **DEK cache + KMS cost analysis** — review actual KMS spend at Phase 2 +
  30d. Re-enable batching/caching if cost rises faster than expected.

## Implementation order

1. **KMS substrate** — per sibling ADR. ~3d.
2. **Phase 1 — credentials encryption** — ~1d after substrate.
3. **C3 — transcript redaction** — separate story, separate ADR if needed.
4. **Phase 2 — transcript encryption** — ~3d after C3.

**Total: ~7d of focused engineering across two stories, sequenced behind KMS.**

## References

- Sibling ADR: `2026-06-13-kms-envelope-encryption-prereq.md`
- `lib/voice/provider-factory.ts:24-25` — original TODO
- #1031 — R1 follow-on
- C3 story (transcript redaction) — TL ruling 2026-06-13
- Reuse-finder report 2026-06-13 (in conversation) — write/read site counts
