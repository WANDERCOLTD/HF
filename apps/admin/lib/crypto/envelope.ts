/**
 * Envelope encryption substrate — GCP KMS-backed column-level cipher.
 *
 * Per ADR `docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md`.
 *
 * **The pattern in one paragraph.** Each row carries its own DEK (Data
 * Encryption Key), generated app-side via `crypto.randomBytes(32)`. The DEK
 * encrypts the plaintext column locally via AES-256-GCM. The DEK itself is
 * wrapped (encrypted) by a KMS-managed KEK (Key Encryption Key) and the
 * wrapped DEK is stored alongside the ciphertext. KMS sees one round-trip
 * per row read/write — not per byte. Decryption reverses the steps.
 *
 * **Bypass mode (dev/test only).** When `config.security.kmsBypass === true`
 * — i.e., `KMS_KEK_NAME` is unset AND `NEXT_PUBLIC_APP_ENV !== "PROD"` —
 * `encryptColumn` returns the plaintext bytes verbatim and stamps
 * `kekVersion: 0` (the sentinel). `decryptColumn` recognises the sentinel
 * and returns the bytes as UTF-8 string. This makes tests pass without a
 * real KMS keyring; the production build-time guard (in `config.ts`) makes
 * sure this branch never reaches prod.
 *
 * **Storage shape (per encrypted column on a row):**
 *
 * | Suffix       | Type    | Contents                                   |
 * |--------------|---------|--------------------------------------------|
 * | `_ciphertext`| Bytes   | AES-256-GCM(plaintext, DEK, IV) ‖ GCM tag  |
 * | `_iv`        | Bytes   | 12-byte random IV (per-row)                |
 * | `_wrappedDek`| Bytes   | KMS-wrapped DEK                            |
 * | `_kekVersion`| Int     | KMS key version at encrypt-time            |
 *
 * **List views** should batch via `encryptColumnBatch` /
 * `decryptColumnBatch` to amortise KMS round-trips across `Promise.all`.
 *
 * **What this substrate does NOT do:**
 *  - Key rotation re-wrap. KMS supports it; the background job that walks
 *    `_kekVersion < currentVersion` rows is a follow-on story when any
 *    encrypted column has been live for 90+ days.
 *  - Searchable encryption. Encrypted columns lose `WHERE x = ?` filtering.
 *    Hash-shadow columns (per ADR Option 4) are out of scope here.
 *
 * @see docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md
 * @see #1977 (this story) · #1976 (Privacy II epic)
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { config } from "@/lib/config";

/** Wire format for an encrypted column. Stored as 4 sibling DB columns. */
export interface EncryptedColumn {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrappedDek: Uint8Array;
  /**
   * KMS key version at encrypt-time. Sentinel value `0` means "bypass mode —
   * plaintext in ciphertext field, no real cipher applied." This sentinel
   * MUST NOT appear in production (enforced by `config.ts` build-time guard).
   */
  kekVersion: number;
}

const BYPASS_KEK_VERSION = 0;
const DEK_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard
const GCM_TAG_BYTES = 16;

// Cached KMS client + key version lookup. Both initialised lazily on first
// non-bypass call to avoid the `@google-cloud/kms` import in dev/test paths.
let kmsClientPromise: Promise<KmsClientHandle> | null = null;

interface KmsClientHandle {
  encrypt(name: string, plaintext: Buffer): Promise<{ ciphertext: Buffer }>;
  decrypt(name: string, ciphertext: Buffer): Promise<{ plaintext: Buffer }>;
  getCurrentVersion(name: string): Promise<number>;
}

async function getKmsClient(): Promise<KmsClientHandle> {
  if (kmsClientPromise) return kmsClientPromise;
  kmsClientPromise = (async () => {
    // Dynamic import keeps the `@google-cloud/kms` dependency out of the
    // dev/test boot path; only loaded when we actually need it.
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const client = new KeyManagementServiceClient();
    return {
      async encrypt(name: string, plaintext: Buffer) {
        const [res] = await client.encrypt({ name, plaintext });
        return { ciphertext: Buffer.from(res.ciphertext as Uint8Array) };
      },
      async decrypt(name: string, ciphertext: Buffer) {
        const [res] = await client.decrypt({ name, ciphertext });
        return { plaintext: Buffer.from(res.plaintext as Uint8Array) };
      },
      async getCurrentVersion(name: string) {
        // KMS returns a primary version ref like:
        // ".../cryptoKeys/X/cryptoKeyVersions/N"
        const [key] = await client.getCryptoKey({ name });
        const primary = key.primary?.name;
        if (!primary) {
          throw new Error(`KMS key ${name} has no primary version`);
        }
        const match = primary.match(/\/cryptoKeyVersions\/(\d+)$/);
        if (!match) {
          throw new Error(`Unexpected KMS primary version format: ${primary}`);
        }
        return parseInt(match[1], 10);
      },
    };
  })();
  return kmsClientPromise;
}

/** Test-only: reset the cached KMS client (e.g., between Vitest fixtures). */
export function __resetKmsClientForTests(): void {
  kmsClientPromise = null;
}

/**
 * Encrypt one plaintext column value. Returns the four-field tuple.
 *
 * In bypass mode: returns the UTF-8 bytes verbatim with `kekVersion: 0`.
 */
export async function encryptColumn(plaintext: string): Promise<EncryptedColumn> {
  if (config.security.kmsBypass) {
    return {
      ciphertext: Buffer.from(plaintext, "utf8"),
      iv: new Uint8Array(0),
      wrappedDek: new Uint8Array(0),
      kekVersion: BYPASS_KEK_VERSION,
    };
  }

  const kek = config.security.kmsKekName;
  const dek = randomBytes(DEK_BYTES);
  const iv = randomBytes(IV_BYTES);

  // AES-256-GCM local encrypt with the per-row DEK
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([ct, tag]); // append GCM tag

  // Wrap the DEK against the KEK via one KMS round-trip
  const kms = await getKmsClient();
  const [{ ciphertext: wrappedDek }, kekVersion] = await Promise.all([
    kms.encrypt(kek, dek),
    kms.getCurrentVersion(kek),
  ]);

  return { ciphertext, iv, wrappedDek, kekVersion };
}

/**
 * Decrypt one encrypted-column blob back to its plaintext string.
 *
 * In bypass mode (`kekVersion === 0`): returns the bytes as UTF-8.
 */
export async function decryptColumn(blob: EncryptedColumn): Promise<string> {
  if (blob.kekVersion === BYPASS_KEK_VERSION) {
    // Sentinel: plaintext in ciphertext field. This branch SHOULD never
    // reach prod — the build-time guard rejects bypass mode in prod.
    return Buffer.from(blob.ciphertext).toString("utf8");
  }

  const kek = config.security.kmsKekName;
  const kms = await getKmsClient();
  const { plaintext: dek } = await kms.decrypt(kek, Buffer.from(blob.wrappedDek));

  if (dek.length !== DEK_BYTES) {
    throw new Error(`Unwrapped DEK has wrong length: ${dek.length} (expected ${DEK_BYTES})`);
  }
  if (blob.iv.length !== IV_BYTES) {
    throw new Error(`IV has wrong length: ${blob.iv.length} (expected ${IV_BYTES})`);
  }
  if (blob.ciphertext.length < GCM_TAG_BYTES) {
    throw new Error(`Ciphertext too short (${blob.ciphertext.length}) — missing GCM tag`);
  }

  const ctBytes = Buffer.from(blob.ciphertext);
  const tag = ctBytes.subarray(ctBytes.length - GCM_TAG_BYTES);
  const ct = ctBytes.subarray(0, ctBytes.length - GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(blob.iv));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Encrypt a batch of plaintext values. Order is preserved. KMS round-trips
 * run in parallel via `Promise.all`. Use for list views or bulk write paths.
 */
export async function encryptColumnBatch(
  plaintexts: string[],
): Promise<EncryptedColumn[]> {
  return Promise.all(plaintexts.map((p) => encryptColumn(p)));
}

/**
 * Decrypt a batch of encrypted columns. Order is preserved. KMS unwraps
 * run in parallel via `Promise.all`. Use for list views.
 */
export async function decryptColumnBatch(
  blobs: EncryptedColumn[],
): Promise<string[]> {
  return Promise.all(blobs.map((b) => decryptColumn(b)));
}
