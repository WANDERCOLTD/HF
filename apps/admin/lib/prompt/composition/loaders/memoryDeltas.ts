/**
 * memoryDeltas loader (#1644 — Epic #1606 Group A.5).
 *
 * Surfaces the CallerMemory rows that landed during the most-recent prior
 * call so the next call's composed prompt can narrate what changed:
 *   "New facts learned: <added>. Updated: <changed>."
 *
 * **Diff contract (BA decision, baked in #1644 body):**
 *  - Prior anchor: `Call.previousCallId` (schema comment at
 *    `schema.prisma:1712` is explicit it exists for delta calcs)
 *  - `added` = rows with `callId = priorCall.id AND supersededById IS NULL`
 *    AND `supersedes` is empty (no prior version replaced)
 *  - `updated` = rows with `callId = priorCall.id` whose `supersedes[]`
 *    contains a row with `callId = priorCall.previousCallId` — direct
 *    compare against the one-back call only; no chain walk across N
 *    historical calls (a per-#1644 BA decision to keep the prompt scope
 *    tight)
 *  - Caller-scoped section (staleness via `bumpCallerComposeTimestamp`),
 *    NOT registered in `PlaybookSectionStaleness`
 *
 * **Sibling to `conversationArtifacts`** — same "most-recent prior call"
 * anchor, same null-callerId fast exit, same composer ordering (transforms
 * read this through `LoadedDataContext.memoryDeltas`).
 */

import type { PrismaClient } from "@prisma/client";

export interface MemoryDeltaEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  /** For "updated" entries: id of the prior-call row this one superseded */
  supersededId?: string;
  /** For "updated" entries: the prior value (shown alongside the new value) */
  priorValue?: string;
}

export interface MemoryDeltasData {
  hasDeltas: boolean;
  priorCallId: string | null;
  priorPriorCallId: string | null;
  added: MemoryDeltaEntry[];
  updated: MemoryDeltaEntry[];
}

export interface LoadMemoryDeltasOptions {
  callerId: string;
  /** Current call id — excluded from the prior-call lookup so we never self-reference */
  currentCallId?: string | null;
}

export const EMPTY_MEMORY_DELTAS: MemoryDeltasData = {
  hasDeltas: false,
  priorCallId: null,
  priorPriorCallId: null,
  added: [],
  updated: [],
};

const DELTA_ENTRY_LIMIT = 8;

type PrismaForLoader = Pick<PrismaClient, "call" | "callerMemory">;

export async function loadMemoryDeltas(
  prisma: PrismaForLoader,
  opts: LoadMemoryDeltasOptions,
): Promise<MemoryDeltasData> {
  const { callerId, currentCallId } = opts;
  if (!callerId) return EMPTY_MEMORY_DELTAS;

  const priorCall = await prisma.call.findFirst({
    where: {
      callerId,
      endedAt: { not: null },
      ...(currentCallId ? { id: { not: currentCallId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, previousCallId: true },
  });

  if (!priorCall) return EMPTY_MEMORY_DELTAS;

  const priorPriorCallId = priorCall.previousCallId;

  const priorCallMemories = await prisma.callerMemory.findMany({
    where: { callId: priorCall.id },
    orderBy: [{ confidence: "desc" }, { extractedAt: "desc" }],
    take: DELTA_ENTRY_LIMIT * 2,
    select: {
      id: true,
      category: true,
      key: true,
      value: true,
      confidence: true,
      supersededById: true,
      supersedes: {
        where: priorPriorCallId ? { callId: priorPriorCallId } : { id: "__never__" },
        select: { id: true, value: true, callId: true },
      },
    },
  });

  const added: MemoryDeltaEntry[] = [];
  const updated: MemoryDeltaEntry[] = [];

  for (const row of priorCallMemories) {
    if (row.supersededById !== null) continue;

    const supersededFromPriorPrior = row.supersedes.find(
      (s) => s.callId === priorPriorCallId,
    );

    if (supersededFromPriorPrior) {
      if (updated.length < DELTA_ENTRY_LIMIT) {
        updated.push({
          id: row.id,
          category: row.category,
          key: row.key,
          value: row.value,
          confidence: row.confidence,
          supersededId: supersededFromPriorPrior.id,
          priorValue: supersededFromPriorPrior.value,
        });
      }
    } else if (row.supersedes.length === 0) {
      if (added.length < DELTA_ENTRY_LIMIT) {
        added.push({
          id: row.id,
          category: row.category,
          key: row.key,
          value: row.value,
          confidence: row.confidence,
        });
      }
    }
  }

  const hasDeltas = added.length > 0 || updated.length > 0;

  return {
    hasDeltas,
    priorCallId: priorCall.id,
    priorPriorCallId,
    added,
    updated,
  };
}
