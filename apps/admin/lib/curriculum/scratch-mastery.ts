/**
 * Per-call scratch mastery — #1081 Slice 1.
 *
 * Backs `Playbook.config.useFreshMastery: true` (Exam Assessment): when the
 * AGGREGATE write site sees a useFresh Playbook, it routes the mastery
 * outcome into `Call.scratchMastery` (this module) instead of the long-term
 * `CallerAttribute.lo_mastery:*` store. ADAPT/COMPOSE may read these per-call
 * values via `readScratchMastery` / `getAllScratchMastery`; the long-term
 * mastery state remains untouched.
 *
 * Key contract — uses the same `lo_mastery:{moduleSlug}:{loRef}` shape as
 * CallerAttribute so a future renderer can read either store with a uniform
 * lookup. (No render site exists today — the course-ref doc is aspirational
 * on this point. Slice 1 stops the pollution and exposes the read helpers
 * so any future renderer has a uniform API.)
 *
 * Concurrency — `writeScratchMastery` uses a read-then-write inside a tiny
 * `$transaction`; lost-update across two concurrent writers for the same
 * callId+key would require the same call to be re-aggregated in parallel,
 * which the pipeline does not do today. The transaction is defence in depth.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type ScratchMasteryValue = number | string;
export type ScratchMasteryMap = Record<string, ScratchMasteryValue>;

function asMap(value: Prisma.JsonValue | null | undefined): ScratchMasteryMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ScratchMasteryMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Merge a single key/value into `Call.scratchMastery`. Read-modify-write inside
 * a transaction so concurrent writers don't drop one another's entries.
 */
export async function writeScratchMastery(
  callId: string,
  key: string,
  value: ScratchMasteryValue,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.call.findUnique({
      where: { id: callId },
      select: { scratchMastery: true },
    });
    if (!row) {
      console.warn(`[scratch-mastery] Refusing write: Call ${callId} not found.`);
      return;
    }
    const merged: ScratchMasteryMap = { ...asMap(row.scratchMastery), [key]: value };
    await tx.call.update({
      where: { id: callId },
      data: { scratchMastery: merged as Prisma.InputJsonValue },
    });
  });
}

export async function readScratchMastery(
  callId: string,
  key: string,
): Promise<ScratchMasteryValue | null> {
  const row = await prisma.call.findUnique({
    where: { id: callId },
    select: { scratchMastery: true },
  });
  const map = asMap(row?.scratchMastery);
  return key in map ? map[key] : null;
}

export async function getAllScratchMastery(
  callId: string,
): Promise<ScratchMasteryMap> {
  const row = await prisma.call.findUnique({
    where: { id: callId },
    select: { scratchMastery: true },
  });
  return asMap(row?.scratchMastery);
}

/**
 * Wipes `Call.scratchMastery` for a given call. Not called from the Slice 1
 * pipeline; exported for a future cleanup job (e.g. delete useFresh scratch
 * after N days).
 */
export async function clearScratchMastery(callId: string): Promise<void> {
  // Prisma JSON columns: `Prisma.DbNull` writes SQL NULL. (Using `undefined`
  // would skip the field entirely.)
  await prisma.call.update({
    where: { id: callId },
    data: { scratchMastery: Prisma.DbNull },
  });
}
