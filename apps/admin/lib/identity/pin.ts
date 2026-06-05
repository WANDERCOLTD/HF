import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const PIN_LENGTH = 6;
const BCRYPT_ROUNDS = 10;

/**
 * Generate a 6-digit numeric PIN using a CSPRNG.
 * Range: 000000–999999, zero-padded. Never returns a value shorter than 6 chars.
 */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(PIN_LENGTH, "0");
}

/** Hash a PIN for storage. Matches the auth module's bcryptjs choice. */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/**
 * Verify a candidate PIN against a stored hash. Constant-time via bcrypt.compare
 * so timing does not leak whether the PIN was correct (relied upon by the
 * expired-PIN flow at /api/identity/verify-pin).
 */
export async function verifyPinHash(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
