/**
 * Channel Types
 *
 * Shared types for the multi-channel content delivery system.
 * Channels route visual content (images, PDFs) to callers via
 * the best available delivery mechanism (sim inline, WhatsApp, MMS, SMS+link).
 */

export type ChannelType = "sim" | "whatsapp" | "sms";

/** Result of resolveChannel() — the best channel for a given domain + caller */
export interface ResolvedChannel {
  type: ChannelType;
  config: Record<string, unknown>;
  domainId: string | null;
}

/** Media payload to deliver through a channel */
export interface MediaPayload {
  mediaId: string;
  publicUrl: string;
  mimeType: string;
  fileName: string;
  caption?: string;
  title?: string;
}

/** Result of dispatchMedia() — delivery outcome */
export interface DispatchResult {
  sent: boolean;
  channel: ChannelType;
  provider: string;
  externalMessageId?: string;
  error?: string;
}
