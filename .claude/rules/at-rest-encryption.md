# At-rest column encryption — when to wrap a column

> Any PII or secret column declared as encrypted MUST be written via
> `encryptColumn` and read via `decryptColumn` from `lib/crypto/envelope.ts`.
> Direct reads / writes against the underlying `_ciphertext` / `_legacy_plaintext`
> column outside the helper + backfill sites are a Lattice violation.
>
> Sibling to [`data-retention.md`](./data-retention.md) (retention column
> discipline) and [`privacy-redaction.md`](./privacy-redaction.md) (read-side
> tier projection). This file holds the **at-rest cipher** discipline.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md).
> Born of epic #1976 child #1977.

## Rule

When you ship a new column declared as encrypted (per ADR
`docs/decisions/2026-06-13-pii-encryption-scope.md`):

1. **Storage shape** — 4 sibling columns:
   - `<name>_ciphertext: Bytes`
   - `<name>_iv: Bytes`
   - `<name>_wrappedDek: Bytes`
   - `<name>_kekVersion: Int`
2. **Migration window** — keep the original column as
   `<name>_legacy_plaintext: <Type>?` for the verification window (~7d on
   hf-dev). Drop in a follow-on PR after the backfill is confirmed and no
   reads of the legacy column remain in the codebase.
3. **Write path** — every writer routes through `encryptColumn(plaintext)`
   and spreads the 4 fields into the Prisma create / update payload.
4. **Read path** — every reader fetches the 4 columns + calls
   `decryptColumn({...})`. List views use `decryptColumnBatch` to amortise
   KMS round-trips.
5. **Backfill** — idempotent script reads `<name>_legacy_plaintext`, calls
   `encryptColumn`, writes the 4 new columns, leaves the legacy column
   intact until the cleanup PR drops it.
6. **ESLint guard** — add `hf-privacy/no-direct-<column>-read` to block bare
   `prisma.<Model>.findX({...select: { <name>_legacy_plaintext: true }})`
   access outside the backfill + cleanup PR allow-list.

## When this applies

- Any new column declared as carrying PII or secrets (e.g.
  `VoiceProvider.credentials`, `Call.transcript`, `CallMessage.content`)
- Adding encryption to an existing column (the more common case in
  this epic)

NOT applicable to:

- Columns whose contents are not PII (timestamps, FKs, status enums)
- Hash-only columns (already non-reversible — no benefit from cipher)
- Audio recording URLs (the URL is a pointer; the file itself is GCS-managed
  separately)

## Pattern: encrypt-then-write, fetch-then-decrypt

```typescript
// WRITE
import { encryptColumn } from "@/lib/crypto/envelope";

const enc = await encryptColumn(JSON.stringify(rawCredentials));
await prisma.voiceProvider.update({
  where: { id },
  data: {
    credentials_ciphertext: enc.ciphertext,
    credentials_iv: enc.iv,
    credentials_wrappedDek: enc.wrappedDek,
    credentials_kekVersion: enc.kekVersion,
  },
});

// READ
import { decryptColumn } from "@/lib/crypto/envelope";

const row = await prisma.voiceProvider.findUnique({
  where: { id },
  select: {
    credentials_ciphertext: true,
    credentials_iv: true,
    credentials_wrappedDek: true,
    credentials_kekVersion: true,
  },
});
const credentialsJson = await decryptColumn({
  ciphertext: row.credentials_ciphertext,
  iv: row.credentials_iv,
  wrappedDek: row.credentials_wrappedDek,
  kekVersion: row.credentials_kekVersion,
});
const credentials = JSON.parse(credentialsJson);
```

## Bypass mode (dev / test)

When `KMS_KEK_NAME` is unset AND `NEXT_PUBLIC_APP_ENV !== "PROD"`:

- `encryptColumn` returns a sentinel blob (`kekVersion: 0`, plaintext bytes
  in `ciphertext`)
- `decryptColumn` recognises the sentinel and returns the bytes as UTF-8

This makes tests pass without a real KMS keyring. The build-time guard in
`lib/config.ts` (added by #1977) **fails the prod build** when
`NEXT_PUBLIC_APP_ENV=PROD` and `KMS_KEK_NAME` is empty, so the bypass
branch cannot ship to production.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/crypto/envelope.ts` (#1977) | Single chokepoint for encrypt / decrypt | Drift between adoption sites — every site uses the same DEK envelope |
| `lib/config.ts::config.security.kmsKekName` validation (#1977) | Build-time guard | Shipping bypass mode to prod (would silently store plaintext) |
| `tests/lib/crypto/envelope.test.ts` (#1977) | 8 vitests | Round-trip identity, sentinel shape, batch order, decrypt-shape rejection |
| Per-column ESLint rules (#1978 onwards) | Edit-time | Bare reads against `_legacy_plaintext` outside backfill + cleanup |

## When NOT to apply

- Schema changes that don't touch a declared-encrypted column
- Test fixtures and seed scripts under `prisma/fixtures/` — they may seed
  plaintext rows that the backfill will encrypt on first prod run
- Migration scripts that run during the verification window — they
  legitimately read `_legacy_plaintext` to perform the encrypt-and-write
  step

## Escalation

If you're adding a new encrypted column and can't add the per-column
ESLint rule in the same PR, add a `// TODO(at-rest-encryption):` comment
explaining why. Tracked by `broken-windows` agent.

## Related

- [`docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md`](../../docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md) — substrate ADR
- [`docs/decisions/2026-06-13-pii-encryption-scope.md`](../../docs/decisions/2026-06-13-pii-encryption-scope.md) — scope ADR (Option 3: credentials + transcripts)
- [`data-retention.md`](./data-retention.md) — sibling rule on retention column discipline
- [`privacy-redaction.md`](./privacy-redaction.md) — sibling rule on read-side tier projection
- Epic [#1976](https://github.com/WANDERCOLTD/HF/issues/1976) — Privacy II
- Story [#1977](https://github.com/WANDERCOLTD/HF/issues/1977) — this substrate
