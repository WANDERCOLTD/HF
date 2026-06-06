/**
 * Phone normaliser for PSTN providers (VAPI today, others later).
 *
 * Why this exists: VAPI rejects anything that isn't strict E.164
 * (`+44…`, `+1…`, etc.). HF surfaces let learners type their phone in
 * whatever format they like (`07768 485 153`, `+44 (0) 7768 485153`,
 * `077-68-485-153`, `4477684851​53`) — all of those mean the same
 * number to a person but only one is valid for VAPI.
 *
 * Discovered live in production: a UK learner enrolled with phone
 * `07768485153`, hit the [Call me] button, VAPI returned 400, the
 * outbound-dial route wrapped it as our 502. Hour-zero fix is to
 * normalise at three layers — storage (join + JIT capture), use
 * (outbound-dial right before the VAPI request), and a one-shot
 * backfill of the existing Caller rows.
 *
 * Default country is GB (United Kingdom) per the current market test.
 * Future learners outside the UK will set their own country when the
 * intake spec adds a country field — for now an explicit `+` prefix
 * always wins.
 */

/** ISO-3166 alpha-2 country codes we know about. Easy to add more. */
type CountryCode = "GB" | "US";

const COUNTRY_DIAL_CODES: Record<CountryCode, string> = {
  GB: "44",
  US: "1",
};

/** Strip every character that isn't a digit or the leading `+`. */
export function stripPhone(input: string): string {
  const trimmed = input.trim();
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  return leadingPlus ? `+${digits}` : digits;
}

/**
 * Best-effort convert to E.164. Heuristics:
 *
 *   - If the input already starts with `+`, trust it (strip non-digits).
 *   - If it starts with `00` (international trunk prefix), replace with `+`.
 *   - If it starts with `0` and we have a default country, treat as that
 *     country's domestic format → strip the leading `0`, prefix with
 *     the dial code.
 *   - Otherwise prefix with the default country's dial code.
 *
 * Returns null when the input is empty or contains no digits at all.
 *
 * NOT a deliverability check — we don't validate that the number is
 * reachable, only that it's syntactically E.164-shaped. VAPI / the
 * carrier will reject unreachable numbers downstream.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "GB",
): string | null {
  if (!raw) return null;
  const cleaned = stripPhone(raw);
  if (cleaned.length === 0 || cleaned === "+") return null;

  // Already E.164 (modulo our character strip) — but may still carry a
  // trunk-prefix `0` after the country code, which some carriers (and
  // VAPI) treat as invalid. Strip it post-prefix.
  if (cleaned.startsWith("+")) {
    return stripTrunkZero(cleaned);
  }

  // International access prefix `00` (e.g. UK dialing out: `00 1 415 555 0123`)
  if (cleaned.startsWith("00")) {
    return stripTrunkZero(`+${cleaned.slice(2)}`);
  }

  const dialCode = COUNTRY_DIAL_CODES[defaultCountry];

  // Domestic format with trunk `0` — strip and prefix
  if (cleaned.startsWith("0")) {
    return `+${dialCode}${cleaned.slice(1)}`;
  }

  // No leading 0, no +. Could be a US 10-digit or someone already pasted
  // a country-coded number without the +. Treat as default country.
  return `+${dialCode}${cleaned}`;
}

/**
 * After we know the `+CC` prefix, if the very next digit is `0` AND
 * stripping it leaves a plausible-length number (≥ 6 more digits), it's
 * the domestic trunk prefix written for human readability (the UK
 * `+44 (0) …` convention). Drop it.
 */
function stripTrunkZero(plusForm: string): string {
  // Match a known country code at the start
  for (const code of Object.values(COUNTRY_DIAL_CODES)) {
    const prefix = `+${code}`;
    if (plusForm.startsWith(prefix) && plusForm[prefix.length] === "0") {
      const after = plusForm.slice(prefix.length + 1);
      if (after.length >= 6) return `${prefix}${after}`;
    }
  }
  return plusForm;
}

/** Quick check whether a string is already in E.164 shape. */
export function isE164(value: string): boolean {
  return /^\+\d{7,15}$/.test(value);
}
