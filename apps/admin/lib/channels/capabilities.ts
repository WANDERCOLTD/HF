/**
 * Channel capability registry — what each delivery surface can deliver.
 *
 * Authoritative answer to: "can this channel render a PDF / image / link?"
 * Used by the materials-sharing gate in `app/api/chat/tools.ts` to suppress
 * the catalog when the live channel can't render rich media (e.g. voice
 * calls, plain SMS).
 *
 * Two layers gate sharing:
 *   1. Channel capability (this file) — technical: can the surface render it?
 *   2. Course intent (`PlaybookConfig.shareMaterials`) — pedagogical: does
 *      the educator want this course to share?
 *
 * Either layer can suppress. The full gate composes them with AND.
 *
 * @see https://github.com/WANDERCOLTD/HF/issues/235
 */

/**
 * The channel through which an AI session is being conducted right now.
 * Distinct from `ChannelType` in ./types.ts which is the outbound media
 * delivery surface for the dispatcher (sim / whatsapp / sms only).
 *
 * "voice" = phone / VAPI live calls.
 * "web-chat" = sim chat or any browser-rendered AI interface.
 * "whatsapp" = WhatsApp bot session.
 * "sms" = plain-text SMS only (no rich media).
 * "email" = async email session.
 */
export type ContentChannel =
  | "voice"
  | "web-chat"
  | "whatsapp"
  | "sms"
  | "email";

interface ChannelCapability {
  /** Channel can deliver images and PDFs inline. */
  supportsRichMedia: boolean;
}

const CHANNEL_CAPABILITIES: Record<ContentChannel, ChannelCapability> = {
  voice: { supportsRichMedia: false },
  "web-chat": { supportsRichMedia: true },
  whatsapp: { supportsRichMedia: true },
  sms: { supportsRichMedia: false },
  email: { supportsRichMedia: true },
};

/**
 * Returns true if the given channel can render rich media (images, PDFs).
 *
 * Unknown channels default to **false** (safe-by-default) — when WhatsApp
 * or future channels arrive, they must be added to the registry explicitly
 * before they will receive rich content.
 */
export function channelSupportsRichMedia(
  channel: ContentChannel | string | null | undefined,
): boolean {
  if (!channel) return false;
  const cap = CHANNEL_CAPABILITIES[channel as ContentChannel];
  if (!cap) {
    console.warn(
      `[channels/capabilities] Unknown channel "${channel}" — defaulting to no rich media. Add to capabilities.ts if appropriate.`,
    );
    return false;
  }
  return cap.supportsRichMedia;
}

/**
 * Resolve the live channel from a `Call.source` string. Maps the existing
 * call-source values (which include "VAPI", "sim", "ai-simulation", etc.)
 * to a normalised ContentChannel.
 *
 * Returns null when the source is unknown — caller should treat that as
 * "no rich media" per safe-by-default.
 */
export function resolveContentChannelFromSource(
  source: string | null | undefined,
): ContentChannel | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s === "vapi" || s === "retell" || s === "voice" || s === "phone") return "voice";
  if (s === "sim" || s === "ai-simulation" || s === "playground-upload") return "web-chat";
  if (s === "whatsapp") return "whatsapp";
  if (s === "sms") return "sms";
  if (s === "email") return "email";
  return null;
}
