/**
 * Messaging adapter shape (#1141).
 *
 * Every adapter (email-resend, sms-twilio later, sms-firebase later,
 * noop-sms today) implements this. The registry at
 * `lib/messaging/adapters/registry.ts` maps an `adapterKey` string —
 * stored on the `MessagingProvider` DB row — to an adapter instance.
 *
 * Adapters are SINGLETONS (unlike voice adapters which are constructed
 * per-row with credentials). Reason: messaging credentials are stored
 * in Secret Manager and dereferenced at send-time by `secretRef`, so
 * there's no per-row credential state to hold. The adapter just looks
 * up the secret on each call.
 */

export type MessagingChannel = "email" | "sms";

export interface MessagingSendParams {
  /** Destination — email address or phone number in E.164-ish form. */
  to: string;
  /** Channel the adapter MUST satisfy. Adapters reject mismatched channels. */
  channel: MessagingChannel;
  /** Secret Manager secret name to dereference (e.g. RESEND_API_KEY). */
  secretRef: string;
  /** Sender (email "from" or SMS sender id). */
  fromAddress: string;
  /** Subject line (email) — ignored by SMS adapters. */
  subject?: string;
  /** HTML body (email). For SMS use `plainTextBody`. */
  body: string;
  /** Plain-text fallback / SMS body. */
  plainTextBody?: string;
  /**
   * Template variables — the adapter or upstream caller can use these to
   * substitute placeholders. Kept generic so the future templating story
   * doesn't need a wire-format change. Not used by the email-resend
   * adapter today (it expects pre-rendered HTML).
   */
  vars?: Record<string, string | number | boolean>;
}

export interface MessagingSendResult {
  /** Provider-side message id for downstream debugging / delivery audit. */
  messageId: string;
}

export interface MessagingAdapter {
  /** The adapter's unique key, must match a `MessagingProvider.adapterKey`. */
  readonly key: string;
  /** Channels this adapter can deliver to. */
  readonly channels: readonly MessagingChannel[];
  /**
   * Send a message. Throws on transport failure — callers (e.g.
   * `issueFirstCallPin`) are expected to wrap in try/catch and log.
   * The "best-effort, don't break enrolment" contract from #1101 is
   * preserved at the caller level, not in the adapter.
   */
  send(params: MessagingSendParams): Promise<MessagingSendResult>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
