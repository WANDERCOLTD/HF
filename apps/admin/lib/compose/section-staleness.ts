/**
 * Section-grain staleness primitives — #1557 (Story 2 of EPIC #1555).
 *
 * Sibling to `bump-timestamp.ts` (which moves the page-level clock
 * `Playbook.composeInputsUpdatedAt`). This file moves the section-grain
 * clock — one row per `(playbookId, sectionKey)` in `PlaybookSectionStaleness`.
 *
 * ## Why a sibling helper instead of an option-bag on bumpPlaybookComposeTimestamp
 *
 * The S2 acceptance criterion is explicit: **bumping a section hash MUST NOT
 * move `Playbook.composeInputsUpdatedAt`** (separate clocks). That rules out
 * merging the two helpers — every caller would have to choose which clock to
 * skip, and the bug class "I moved the wrong clock" is exactly what the
 * separation prevents. Callers that want both invoke both. Section bumps are
 * additive; the page clock stays for backward compat with the staleness
 * reader (`isPromptStale`).
 *
 * ## When to call
 *
 * From a compose-affecting write site, AFTER the upstream write succeeds:
 *
 * ```ts
 * await prisma.$transaction(async (tx) => {
 *   await writePlaybookConfig(tx, ...);
 *   await bumpSectionHash(playbookId, "welcome", nextWelcomeInputs, tx);
 *   // Optional: also move the page clock for legacy readers.
 *   await bumpPlaybookComposeTimestamp(playbookId, tx);
 * });
 * ```
 *
 * Idempotent — bumping with the same hash is a no-op (does NOT move
 * `staleSince`). Hashes are 16-hex-char SHA-256 prefixes over sorted-key
 * `JSON.stringify(inputs)` — deterministic across processes.
 *
 * ## Hash collision risk
 *
 * 16 hex chars = 64 bits. For ~14 sections per playbook and a few thousand
 * playbooks, the birthday-bound collision probability is negligible. We keep
 * it short for log readability + index size. If a future use-case demands
 * cryptographic strength, widen the prefix without changing call sites.
 */

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

import type { ComposeSectionKey } from "./section";

/**
 * Prisma transaction client OR the top-level prisma client. Callers can run
 * a section bump inside the same transaction as the upstream config write
 * (recommended), or pass nothing and we'll use the default client.
 */
type Db = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Deterministic content hash over an arbitrary inputs object. Sorted-key
 * `JSON.stringify` → SHA-256 → first 16 hex chars.
 *
 * - `undefined` properties are dropped (consistent with `JSON.stringify`).
 * - Nested objects are recursively sorted.
 * - Arrays preserve order (semantically meaningful for compose inputs).
 *
 * Exported for tests + ad-hoc trace probes. Production call sites should
 * invoke `bumpSectionHash` which runs this internally.
 */
export function hashSectionInputs(inputs: unknown): string {
  const canonical = JSON.stringify(inputs, replacer);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * `JSON.stringify` replacer that emits plain objects with keys in sorted
 * order. Arrays + primitives pass through; non-plain objects (Date, etc.)
 * are serialised by their default `toJSON`. Cycles are not handled — compose
 * inputs are tree-shaped by contract.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value;
  // Sort keys for deterministic stringification.
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) out[k] = obj[k];
  return out;
}

/**
 * Bump the staleness row for `(playbookId, sectionKey)` if the supplied
 * `inputs` produce a different hash from the stored one.
 *
 * Returns `{ changed, sectionHash }` so callers can short-circuit downstream
 * work (e.g. skip an eager-reprompt fan-out when nothing actually moved).
 *
 * - First write for a section: creates the row, `changed: true`.
 * - Subsequent write with identical inputs: no-op, `changed: false`,
 *   `staleSince` preserved.
 * - Subsequent write with different inputs: updates `sectionHash` +
 *   `staleSince = now`, `changed: true`.
 *
 * Does NOT touch `Playbook.composeInputsUpdatedAt` — that's a separate clock.
 *
 * Empty `playbookId` or `sectionKey` is a no-op (best-effort, mirrors the
 * `bumpPlaybookComposeTimestamp` defensive contract).
 */
export async function bumpSectionHash(
  playbookId: string,
  sectionKey: ComposeSectionKey,
  inputs: unknown,
  tx?: Db,
): Promise<{ changed: boolean; sectionHash: string }> {
  if (!playbookId || !sectionKey) {
    return { changed: false, sectionHash: "" };
  }

  const sectionHash = hashSectionInputs(inputs);
  const db = tx ?? prisma;

  // Read-then-write rather than `upsert` so we can detect no-op (no
  // `staleSince` movement) without an extra round-trip. The unique
  // constraint on `(playbookId, sectionKey)` makes the read deterministic.
  const existing = await db.playbookSectionStaleness.findUnique({
    where: { playbookId_sectionKey: { playbookId, sectionKey } },
    select: { id: true, sectionHash: true },
  });

  if (existing && existing.sectionHash === sectionHash) {
    return { changed: false, sectionHash };
  }

  if (existing) {
    await db.playbookSectionStaleness.update({
      where: { id: existing.id },
      data: { sectionHash, staleSince: new Date() },
    });
  } else {
    await db.playbookSectionStaleness.create({
      data: { playbookId, sectionKey, sectionHash },
    });
  }

  return { changed: true, sectionHash };
}

/**
 * Read all section staleness rows for a playbook, enriched with
 * `affectedCallerCount` (active enrollments on the playbook).
 *
 * Returns at most one row per `ComposeSectionKey` that has ever been bumped.
 * Sections that have never been bumped are omitted (callers can treat them
 * as fresh by convention — there's no prior hash to drift from).
 *
 * `affectedCallerCount` is the same number for every row in the response
 * (it's the active enrollment count for the playbook). It's included on
 * each row for API ergonomics — callers reading one section don't have to
 * make a second query.
 *
 * Per S2 risk note: capped at 1000 callers per row. Above the cap, the
 * count is reported as `1000` and the response carries `capped: true`.
 * The cap protects against accidental fan-out queries on monster playbooks.
 */
export async function getSectionStaleness(playbookId: string): Promise<{
  sections: Array<{
    sectionKey: ComposeSectionKey;
    sectionHash: string;
    staleSince: Date;
    affectedCallerCount: number;
  }>;
  capped: boolean;
}> {
  if (!playbookId) return { sections: [], capped: false };

  const AFFECTED_CALLER_CAP = 1000;

  // Two cheap reads in parallel.
  const [rows, callerCount] = await Promise.all([
    prisma.playbookSectionStaleness.findMany({
      where: { playbookId },
      orderBy: { sectionKey: "asc" },
    }),
    prisma.callerPlaybook.count({
      where: { playbookId, status: "ACTIVE" },
      take: AFFECTED_CALLER_CAP + 1,
    }),
  ]);

  const capped = callerCount > AFFECTED_CALLER_CAP;
  const affectedCallerCount = capped ? AFFECTED_CALLER_CAP : callerCount;

  return {
    sections: rows.map((row) => ({
      sectionKey: row.sectionKey as ComposeSectionKey,
      sectionHash: row.sectionHash,
      staleSince: row.staleSince,
      affectedCallerCount,
    })),
    capped,
  };
}
