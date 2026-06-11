/**
 * Client-side helper for emitting operator help-surface telemetry.
 *
 * Epic #1442 Layer 3 Slice 3 — #1484.
 *
 * Contract:
 *  - NEVER throws. Network errors, missing globals, schema mismatches —
 *    all are caught and swallowed so a telemetry call can never break the
 *    UI it instruments.
 *  - Uses `navigator.sendBeacon` when available so the event survives
 *    page-unload (the typical case for `cascade-inspector-close` events
 *    where the operator navigates away as the tray dismisses).
 *  - Falls back to `fetch({ keepalive: true })` when the beacon path is
 *    unavailable (server-side render, older browsers, JSDOM in vitest).
 *  - Returns `void`. The fire-and-forget contract means callers must not
 *    await this function (vitest pins this by spying on `sendBeacon` and
 *    asserting the call returns synchronously).
 *
 * See `app/api/help/events/route.ts` for the server contract.
 */

export interface HelpEventInput {
  /** Event class. Documented values:
   *    "doc-section-view" | "cascade-inspector-open"
   *  | "cascade-inspector-close" | "cmdk-tool-fire"
   *  Open-ended on purpose — new event classes land without a migration. */
  type: string;
  /** Section id, knob key, tool slug. */
  target: string;
  /** Optional role override; server falls back to session role. */
  role?: string;
  /** Optional caller correlation hint. */
  callerId?: string;
  /** Did the action succeed (for close/fire events that have a verdict). */
  success?: boolean;
  /** Elapsed ms since the matching open event (close events). */
  durationMs?: number;
}

const ENDPOINT = "/api/help/events";

/**
 * Emit a help-surface telemetry event. Fire-and-forget — never throws.
 */
export function trackHelpEvent(input: HelpEventInput): void {
  try {
    // SSR / build-time / vitest without DOM — silently no-op.
    if (typeof window === "undefined") return;

    const body = JSON.stringify(input);

    // Beacon path: preferred because it survives page-unload (closing the
    // inspector tray then navigating is the typical close-event shape).
    const beacon =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & {
            sendBeacon?: (url: string, data: BodyInit) => boolean;
          }).sendBeacon
        : undefined;

    if (typeof beacon === "function") {
      // The Beacon API requires a Blob with the correct MIME for the
      // server to parse the body as JSON. Wrap the string accordingly.
      const blob = new Blob([body], { type: "application/json" });
      const queued = beacon.call(navigator, ENDPOINT, blob);
      // beacon returns false when the user-agent rejects the payload
      // (quota or size cap exceeded — neither expected for <200 byte
      // events). Fall through to fetch as a defensive backstop.
      if (queued) return;
    }

    // Fallback: keepalive fetch. `keepalive: true` is the modern equivalent
    // of the beacon — survives the page-unload teardown. We deliberately do
    // NOT await the promise; the contract is fire-and-forget.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Swallow network errors. Telemetry must NEVER block UI.
    });
  } catch {
    // Defensive: anything that escapes the inner branches is swallowed.
    // The fire-and-forget contract is non-negotiable.
  }
}
