/**
 * Messaging adapter registry (#1141).
 *
 * Mirrors `lib/voice/adapter-registry.ts`. One hardcoded place that maps
 * `MessagingProvider.adapterKey` strings to adapter instances. Adding a
 * new SMS provider means: (a) write the class under
 * `lib/messaging/adapters/<key>.ts`, (b) add one entry here. No code
 * change to `issueFirstCallPin`, the resolver, or the admin UI.
 *
 * Per CLAUDE.md "Configuration over Code": this file IS the unavoidable
 * code seam — adapter classes can't live in a JSON blob — but
 * registration, secret refs, from-addresses, default selection, and
 * tenant scope are all data in the `MessagingProvider` table.
 */

import type { MessagingAdapter } from "./types";
import { emailResendAdapter } from "./adapters/email-resend";
import { noopSmsAdapter } from "./adapters/noop-sms";

export const MESSAGING_ADAPTERS: Record<string, MessagingAdapter> = {
  "email-resend": emailResendAdapter,
  "noop-sms": noopSmsAdapter,
};

/** Lookup with a friendly error. */
export function getMessagingAdapter(adapterKey: string): MessagingAdapter {
  const adapter = MESSAGING_ADAPTERS[adapterKey];
  if (!adapter) {
    throw new Error(
      `[messaging] no adapter registered for key '${adapterKey}'. ` +
        `Known keys: ${Object.keys(MESSAGING_ADAPTERS).join(", ")}.`,
    );
  }
  return adapter;
}

/** For health checks + admin UI dropdown. */
export function listRegisteredMessagingAdapterKeys(): string[] {
  return Object.keys(MESSAGING_ADAPTERS);
}
