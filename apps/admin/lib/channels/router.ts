/**
 * Channel Router
 *
 * Resolves the best delivery channel for a given domain + caller.
 * Reads ChannelConfig (per-domain settings) from DB, ordered by priority.
 * Falls back to SMS when no domain-specific config exists.
 */

import { prisma } from "@/lib/prisma";
import type { ChannelType, ResolvedChannel } from "./types";

/**
 * Resolve the best enabled delivery channel for a caller in a domain.
 *
 * Priority order is set per-domain in ChannelConfig.priority (higher = preferred).
 * If no domain config exists, falls back to SMS with empty config (uses env vars).
 *
 * @param domainId - Caller's domain ID (null → use global defaults)
 * @param callerPhone - Caller phone number (null → sim-only)
 */
export async function resolveChannel(
  domainId: string | null,
  callerPhone: string | null,
): Promise<ResolvedChannel> {
  // If no phone number, only sim channel works
  if (!callerPhone) {
    return { type: "sim", config: {}, domainId };
  }

  // Load domain-specific channels, ordered by priority (highest first)
  const channels = domainId
    ? await prisma.channelConfig.findMany({
        where: { domainId, isEnabled: true },
        orderBy: { priority: "desc" },
      })
    : [];

  // Try global defaults if no domain-specific config
  if (channels.length === 0 && domainId) {
    const globals = await prisma.channelConfig.findMany({
      where: { domainId: null, isEnabled: true },
      orderBy: { priority: "desc" },
    });
    channels.push(...globals);
  }

  // Walk channels by priority, return first usable one
  for (const ch of channels) {
    const type = ch.channelType as ChannelType;
    const cfg = (ch.config as Record<string, unknown>) || {};

    if (type === "whatsapp" && callerPhone) {
      return { type: "whatsapp", config: cfg, domainId };
    }
    if (type === "sms" && callerPhone) {
      return { type: "sms", config: cfg, domainId };
    }
  }

  // Default: SMS with env-var config
  return { type: "sms", config: {}, domainId };
}
