import {
  NotImplementedError,
  type MessagingAdapter,
  type MessagingSendParams,
  type MessagingSendResult,
} from "../types";

/**
 * Stub SMS adapter (#1141).
 *
 * Holds the place in the registry for the SMS channel. When a real
 * adapter (Twilio, Firebase Phone Auth, MessageBird) ships, this is
 * REPLACED by it — admins flip the `MessagingProvider` row's
 * `adapterKey` from `noop-sms` to the new key. No code change to the
 * resolver / caller surface.
 *
 * TL review (#1141 R6) chose THROW over silent-return-ok so dev-time
 * mistakes surface loudly. `issueFirstCallPin` already wraps the
 * dispatch in try/catch and logs without breaking enrolment, so a
 * NotImplementedError here is visible in logs but non-fatal.
 *
 * Logs the would-have-been message at warn level so operators
 * inspecting `/tmp/hf-dev.log` (or Cloud Run logs) can see what the SMS
 * payload would have been.
 */
class NoopSmsAdapter implements MessagingAdapter {
  readonly key = "noop-sms";
  readonly channels = ["sms"] as const;

  async send(params: MessagingSendParams): Promise<MessagingSendResult> {
    if (params.channel !== "sms") {
      throw new Error(
        `[noop-sms] cannot deliver to channel '${params.channel}' — sms only`,
      );
    }

    console.warn(
      `[noop-sms] (stub) SMS NOT SENT to ${params.to} — body: ${
        params.plainTextBody ?? params.body
      }`,
    );

    throw new NotImplementedError(
      "SMS messaging adapter is not configured. Swap MessagingProvider " +
        "row's adapterKey from 'noop-sms' to a real SMS adapter when one ships.",
    );
  }
}

export const noopSmsAdapter = new NoopSmsAdapter();
