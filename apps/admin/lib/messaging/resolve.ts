import { prisma } from "@/lib/prisma";
import type { MessagingChannel } from "./types";
import type { MessagingProvider } from "@prisma/client";

/**
 * MessagingProvider resolver cascade (#1141).
 *
 * Mirrors `lib/voice/resolve-voice-provider.ts`. Given a caller and a
 * channel, returns the MessagingProvider row that should service the
 * message. Cascade (one hop):
 *
 *   1. Caller's institution-scoped row for that channel's adapterKey set
 *   2. SYSTEM default (institutionId IS NULL, isDefault TRUE)
 *
 * Returns null if neither layer has a matching row — the caller (e.g.
 * `issueFirstCallPin`) decides what to do (log + skip is the current
 * contract — best-effort, never break enrolment).
 *
 * TL review (#1141 R3) confirmed the `Caller → domain → institution`
 * two-hop join (no bare `Caller.institutionId` field exists).
 *
 * No caching today — the resolver hits Prisma each call. Voice providers
 * have a 30s cache; we'll add the same shape here if the PIN-issuance
 * volume ever justifies it. (Today: ~one resolve per enrolment.)
 */

interface ResolveParams {
  callerId: string;
  channel: MessagingChannel;
}

/**
 * Adapter keys that satisfy a channel. The resolver picks the
 * institution-scoped (or SYSTEM-default) row whose `adapterKey` is in
 * the channel's whitelist AND which is `enabled = true`.
 */
const CHANNEL_TO_ADAPTER_KEYS: Record<MessagingChannel, readonly string[]> = {
  email: ["email-resend"],
  sms: ["noop-sms", "sms-twilio", "sms-firebase"],
};

export async function resolveMessagingProvider(
  params: ResolveParams,
): Promise<MessagingProvider | null> {
  const candidateKeys = CHANNEL_TO_ADAPTER_KEYS[params.channel];
  if (!candidateKeys || candidateKeys.length === 0) return null;

  // Two-hop: caller → domain → institution. Both edges nullable.
  const caller = await prisma.caller.findUnique({
    where: { id: params.callerId },
    select: { domain: { select: { institutionId: true } } },
  });
  const institutionId = caller?.domain?.institutionId ?? null;

  // Layer 1: institution-scoped row (only if institutionId resolved).
  if (institutionId !== null) {
    const institutionRow = await prisma.messagingProvider.findFirst({
      where: {
        institutionId,
        adapterKey: { in: [...candidateKeys] },
        enabled: true,
      },
      orderBy: { isDefault: "desc" },
    });
    if (institutionRow) return institutionRow;
  }

  // Layer 2: SYSTEM default (institutionId IS NULL).
  const systemRow = await prisma.messagingProvider.findFirst({
    where: {
      institutionId: null,
      adapterKey: { in: [...candidateKeys] },
      enabled: true,
      isDefault: true,
    },
  });
  return systemRow;
}
