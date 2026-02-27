/**
 * Channel Dispatcher
 *
 * Sends media content via the resolved channel (WhatsApp, MMS, SMS+link).
 * Twilio handles both MMS and WhatsApp via the same Messages API —
 * only the `From` prefix differs.
 *
 * For sim channels, dispatch is a no-op (handled inline by the tool handler).
 */

import { getActivitiesConfig } from "@/lib/fallback-settings";
import type { ResolvedChannel, MediaPayload, DispatchResult } from "./types";

/**
 * Dispatch media to a caller via the resolved channel.
 *
 * @param channel - The resolved channel from router.ts
 * @param payload - Media details + public URL
 * @param callerPhone - Caller's E.164 phone number
 */
export async function dispatchMedia(
  channel: ResolvedChannel,
  payload: MediaPayload,
  callerPhone: string,
): Promise<DispatchResult> {
  if (channel.type === "sim") {
    return { sent: true, channel: "sim", provider: "inline" };
  }

  // Load activities config for Twilio credentials
  const activitiesConfig = await getActivitiesConfig();

  // Resolve Twilio credentials: channel config → activities config → env vars
  const accountSid =
    (channel.config.accountSid as string) ||
    activitiesConfig.twilio?.accountSid ||
    process.env.TWILIO_ACCOUNT_SID;
  const authToken =
    (channel.config.authToken as string) ||
    activitiesConfig.twilio?.authToken ||
    process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.error(`[channels/dispatch] Missing Twilio credentials for ${channel.type}`);
    return {
      sent: false,
      channel: channel.type,
      provider: "twilio",
      error: "Missing Twilio credentials",
    };
  }

  // Determine `From` number based on channel type
  const fromNumber = resolveFromNumber(channel, activitiesConfig);
  if (!fromNumber) {
    console.error(`[channels/dispatch] No From number for channel ${channel.type}`);
    return {
      sent: false,
      channel: channel.type,
      provider: "twilio",
      error: "No sender number configured",
    };
  }

  // Build Twilio request — same API for SMS, MMS, and WhatsApp
  const toNumber =
    channel.type === "whatsapp" ? `whatsapp:${callerPhone}` : callerPhone;
  const from =
    channel.type === "whatsapp" ? `whatsapp:${fromNumber}` : fromNumber;

  const caption = payload.caption || payload.title || payload.fileName;

  const params = new URLSearchParams({
    To: toNumber,
    From: from,
    Body: caption,
  });

  // Add media URL for MMS/WhatsApp (Twilio fetches this URL to include the image)
  if (payload.mimeType.startsWith("image/") || payload.mimeType === "application/pdf") {
    params.append("MediaUrl", payload.publicUrl);
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(
        `[channels/dispatch] Twilio ${channel.type} error (${res.status}):`,
        errBody,
      );
      return {
        sent: false,
        channel: channel.type,
        provider: "twilio",
        error: `Twilio returned ${res.status}`,
      };
    }

    const data = await res.json();
    console.log(
      `[channels/dispatch] ${channel.type} sent: ${data.sid} → ${callerPhone}`,
    );

    return {
      sent: true,
      channel: channel.type,
      provider: "twilio",
      externalMessageId: data.sid,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[channels/dispatch] ${channel.type} exception:`, message);
    return {
      sent: false,
      channel: channel.type,
      provider: "twilio",
      error: message,
    };
  }
}

/**
 * Resolve the sender phone number for Twilio.
 * Channel-specific config takes precedence over global settings.
 */
function resolveFromNumber(
  channel: ResolvedChannel,
  activitiesConfig: { twilio?: { fromNumber?: string } },
): string | null {
  // Channel-specific override
  const channelFrom = channel.config.fromNumber as string | undefined;
  if (channelFrom) return channelFrom;

  // Global Twilio config from activities settings
  if (activitiesConfig.twilio?.fromNumber) return activitiesConfig.twilio.fromNumber;

  // Env var fallback
  return process.env.TWILIO_FROM_NUMBER || null;
}
