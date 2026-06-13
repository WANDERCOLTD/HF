# ADR: KMS envelope encryption — prereq substrate for app-layer column encryption

**Date:** 2026-06-13
**Status:** Accepted
**Deciders:** Paul W

## Context

Today HF has no application-layer encryption. PII columns (`Caller.{email,name,phone}`,
`User.{email,phone}`, `Call.transcript`, `CallMessage.content`, `VoiceProvider.credentials`)
live in plaintext. The only protection is Cloud SQL transparent at-rest, which is keyed
by Google's managed KMS and defends against the *disk-theft* threat model — not against
leaked backup snapshots, DB-admin compromise, or insider read access.

The pre-existing TODO at `lib/voice/provider-factory.ts:24-25` calls for AES-256-GCM
on `VoiceProvider.credentials` (tracked as R1 in #1031, non-blocking post-market-test
follow-up). Reuse-finder ran 2026-06-13 and confirmed:

- **Zero AES-GCM / column-cipher usage** in the codebase. HMAC-SHA256 only (webhook
  signatures at `lib/voice/providers/{vapi,retell}/auth.ts`, media token signing at
  `app/api/media/[id]/public/route.ts:47`, content hashing at `lib/storage/utils.ts`).
- **Zero KMS / Secret Manager wrappers** — no `@google-cloud/kms` or
  `@google-cloud/secret-manager` dependency.
- The existing env-secret pattern at `lib/config.ts:101-117`
  (`config.security.internalApiSecret`) is the closest precedent for key injection
  but is single-value, no rotation, no envelope.

Without a key-management substrate, any app-layer encryption is theatre — a leaked
process env or a leaked `.env.local` reveals the master key alongside the ciphertext,
and the attacker has both. **KMS is a prereq, not a story line-item.**

This ADR captures the substrate. The encryption *scope* (which fields, in which order)
is a separate decision (2026-06-13-pii-encryption-scope.md).

## Options considered

1. **No KMS — env-var DEK with manual rotation runbook.** Cheapest. Defended only
   against leaked DB backup snapshot taken without the env. Useless if env + DB are
   exfiltrated together (the realistic incident shape for a Cloud Run breach).
   **Rejected.**
2. **GCP KMS envelope encryption.** Master key in KMS (`hf-pii-kek-<env>`), per-row
   data encryption key (DEK) generated at app layer, DEK wrapped by KMS, wrapped DEK
   stored alongside ciphertext in the row. Standard pattern; matches Google's own
   guidance.
3. **GCP KMS direct encrypt (no envelope).** Every encrypt/decrypt is a KMS API
   round-trip. Latency: ~30ms × every read of every PII row. Rejected — destroys
   list-view performance.
4. **GCP Secret Manager.** Wrong tool — Secret Manager stores secrets but doesn't
   provide a cipher API. Could be used to hold the wrapping key, but that just
   reinvents KMS poorly. **Rejected.**
5. **HashiCorp Vault.** Adds a sidecar dependency. We have no Vault deployment;
   spinning one up for one use case is disproportionate. **Rejected.**
6. **AWS KMS / Azure Key Vault.** We're on GCP. **Rejected.**

## Decision

**Adopt Option 2 — GCP KMS envelope encryption.**

### Substrate

- One **KEK (Key Encryption Key)** per environment in GCP KMS:
  `projects/hf-<env>/locations/europe-west2/keyRings/hf-pii/cryptoKeys/hf-pii-kek`.
- Per-row **DEK (Data Encryption Key)** generated app-side via
  `crypto.randomBytes(32)` (AES-256). DEK is used to AES-256-GCM encrypt the
  plaintext column.
- DEK is wrapped by the KEK via `kmsClient.encrypt(kekName, dek)` and the wrapped
  blob stored alongside the ciphertext (typically in a sibling column or a
  `Bytes` column with a length prefix).
- Decrypt path: read wrapped DEK + ciphertext, call `kmsClient.decrypt(kekName,
  wrappedDek)` → DEK, then AES-256-GCM decrypt locally. KMS round-trip is one per
  *row read*, not per byte. List views can amortise via parallel KMS calls.

### Storage shape

For a single encrypted column `X`, the row carries:

| Column | Type | Contents |
|---|---|---|
| `X_ciphertext` | `Bytes` | AES-256-GCM(plaintext, DEK, IV) ‖ GCM tag |
| `X_iv` | `Bytes` | 12-byte random IV (per-row) |
| `X_wrappedDek` | `Bytes` | KMS-wrapped DEK |
| `X_kekVersion` | `Int` | KMS key version at encrypt-time (for rotation tracking) |

Overhead per row: 16B GCM tag + 12B IV + ~120B wrapped DEK + 4B version = **~152B
fixed** + plaintext size. Negligible storage cost.

### Key rotation

GCP KMS supports automatic key rotation. We enable:
- Rotation period: **90 days** (matches API-key rotation cadence).
- On rotation, KMS generates a new primary version; existing wrapped DEKs continue
  to decrypt against their original version (KMS keeps prior versions enabled).
- A background re-wrap job (out of scope here, future story) walks rows with
  `X_kekVersion < currentVersion` and re-wraps DEKs against the new primary. This
  is the "cryptoshred-old-key" eventual cleanup.

### Helpers

New `lib/crypto/envelope.ts`:

- `encryptColumn(plaintext: string): Promise<EncryptedColumn>` — generates DEK,
  encrypts, wraps DEK against the current KEK, returns the four-field tuple.
- `decryptColumn(blob: EncryptedColumn): Promise<string>` — unwraps DEK against
  the appropriate KEK version, decrypts.
- `encryptColumnBatch(plaintexts: string[])` / `decryptColumnBatch(blobs[])` —
  amortise KMS round-trips for list views via `Promise.all`.

The helper interface intentionally hides the DEK lifecycle. Call sites see a
plaintext-in / blob-out interface and never touch the KEK directly.

### Env vars / config

Add to `lib/config.ts::config.security`:

- `kmsKekName: string` — required in production, optional in dev with a
  **plaintext-passthrough fallback** that returns the input unchanged and stamps
  the row with `X_kekVersion = 0` (a sentinel meaning "not encrypted, dev only").
- The dev fallback is what makes tests pass without a real KMS; it must
  **fail-closed in production** (config validation rejects empty `kmsKekName`
  when `NEXT_PUBLIC_APP_ENV=PROD`).

### Local dev / tests

Tests never hit real KMS. The plaintext-passthrough fallback is the test mode.
This is the deliberate "encryption in tests is theatre — verify the pipeline
shape, not the cipher" trade-off. **The fallback MUST NOT compile into the
production bundle when `NEXT_PUBLIC_APP_ENV=PROD`** — enforce via a build-time
guard that aborts if both `NEXT_PUBLIC_APP_ENV=PROD` and `kmsKekName` is empty.

A small integration test runs against an actual KMS keyring on hf-dev (one
KEK, one decrypt round-trip) — proves the pipeline end-to-end, doesn't gate the
unit suite.

### IAM

- Cloud Run service account gets `roles/cloudkms.cryptoKeyEncrypterDecrypter` on
  the KEK only. No admin permissions.
- KMS admin roles held by Paul + ops (not the runtime SA).
- Audit log: GCP automatically logs every encrypt/decrypt against the KEK. We
  retain this as the auditor surface — "X decrypts of Caller PII at time T from
  service S" is queryable in Cloud Logging.

## Consequences

### Positive

- App-layer column encryption becomes a tractable next step. Any field can be
  added to the encrypted set with `encryptColumn` / `decryptColumn` wrapping —
  no per-field cipher boilerplate.
- KMS audit log is auditor-grade and free.
- Cryptoshred-on-rotation is a real capability (re-wrap job).
- Defends against the realistic threat: leaked backup + leaked env. Attacker
  needs the live KMS KEK to decrypt; KMS is not in the backup or the env.

### Negative

- Adds `@google-cloud/kms` dep tree (~500KB transitive).
- One KMS round-trip per row read on cold cache. List views need batching to
  stay under 100ms.
- GCP KMS is not free: ~$0.06 per 10K operations. At market-test scale
  (~50 learners × 5 reads/day × 10 PII fields = 2,500 ops/day) this is
  **~$0.45/year**. At pilot scale (10K learners) it climbs to ~$1.80/year.
  Always cheap.
- Dev experience: developers must remember the plaintext-passthrough fallback
  exists in dev; calling `.toLowerCase()` on what they think is `email` will
  still work, but tests that grep DB directly for "alice@example.com" must
  decrypt first.
- Rollback path: complex. Once a column is encrypted in prod, rolling back
  means decrypting every row before disabling encryption — a forward-only
  decision.

### Open follow-ons

- **DEK caching** — short-lived in-memory cache (60s TTL) of unwrapped DEKs to
  cut KMS round-trips on hot rows. Not part of v1; add if KMS cost ever bites.
- **Re-wrap on rotation** worker. Schedule via Cloud Scheduler once a column is
  encrypted in prod and the 90-day rotation completes.
- **Per-tenant KEK** (multi-tenancy future) — different KEK per
  Institution/Domain. Out of scope today; the column carries `X_kekName` if we
  ever need this.

## Implementation order

This ADR is a prereq, not a story. The actual story sequence is:

1. **Land KMS infrastructure** — terraform/gcloud the KEKs in DEV / STAGING /
   PROD KMS keyrings; add SA bindings; add config env vars. ~1d.
2. **Land `lib/crypto/envelope.ts`** — encrypt/decrypt helpers, fallback,
   integration test. ~1d.
3. **Apply to first column** — `VoiceProvider.credentials` (smallest, lowest
   blast radius, already TODO'd). Migration + backfill + decrypt-on-read in
   `provider-factory.ts`. ~1d.
4. **Then** the broader scope decision in
   `2026-06-13-pii-encryption-scope.md` rolls in.

**Total prereq budget: ~3d.** Story-tracked separately once approved.

## References

- [GCP KMS envelope encryption guidance](https://cloud.google.com/kms/docs/envelope-encryption)
- `lib/voice/provider-factory.ts:24-25` — original TODO
- #1031 — voice provider rationalisation epic (where R1 lives)
- Sibling ADR: `2026-06-13-pii-encryption-scope.md` (which fields, what order)
- Reuse-finder report 2026-06-13 (in conversation)
