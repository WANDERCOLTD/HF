/**
 * Caller name → id resolver for Cmd+K scope prefixes (#1442 Slice 5).
 *
 * Mirrors the partial-match DB shape used by `handleQueryCallers` in
 * `admin-tool-handlers.ts`, with one critical addition: an institution-scope
 * filter when `opts.institutionId` is provided. The existing
 * `handleQueryCallers` does NOT scope by institution — that is a known leak
 * (#1546 §2) — but it is NOT refactored here (separate concern, separate
 * PR). This resolver simply does the right thing for the Cmd+K flow.
 *
 * Resolution order:
 *   1. Exact name match (case-insensitive) → if unique, return it.
 *   2. Otherwise partial match (case-insensitive contains).
 *   3. Multiple hits → `{ ok: false, candidates: up to 5 }` for disambiguation.
 *   4. No hits → `{ ok: false, reason: … }`.
 */

import { prisma } from "@/lib/prisma";

export interface ResolveCallerOpts {
  /**
   * From `authResult.session.user.institutionId` in the route. SUPERADMIN
   * sessions pass `undefined` (no institution scope — see all callers).
   */
  institutionId?: string;
}

export type ResolveCallerResult =
  | { ok: true; callerId: string; label: string }
  | {
      ok: false;
      reason: string;
      candidates?: { id: string; name: string; email: string | null }[];
    };

export async function resolveCallerByName(
  name: string,
  opts: ResolveCallerOpts = {},
): Promise<ResolveCallerResult> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Caller name is required" };
  }

  const institutionWhere = opts.institutionId
    ? { domain: { is: { institutionId: opts.institutionId } } }
    : {};

  // Stage 1 — exact (case-insensitive) match. Equals with `mode: insensitive`
  // surfaces "Bertie Tallstaff" when the operator types "bertie tallstaff".
  const exact = await prisma.caller.findMany({
    where: {
      name: { equals: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true, email: true },
    take: 6,
  });

  if (exact.length === 1) {
    return {
      ok: true,
      callerId: exact[0].id,
      label: exact[0].name ?? exact[0].email ?? exact[0].id,
    };
  }
  if (exact.length > 1) {
    return ambiguous(trimmed, exact);
  }

  // Stage 2 — partial match.
  const partial = await prisma.caller.findMany({
    where: {
      name: { contains: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: 6,
  });

  if (partial.length === 0) {
    return { ok: false, reason: `No caller found matching '${trimmed}'` };
  }
  if (partial.length === 1) {
    return {
      ok: true,
      callerId: partial[0].id,
      label: partial[0].name ?? partial[0].email ?? partial[0].id,
    };
  }
  return ambiguous(trimmed, partial);
}

function ambiguous(
  query: string,
  rows: { id: string; name: string | null; email: string | null }[],
): ResolveCallerResult {
  return {
    ok: false,
    reason: `Ambiguous — ${rows.length} callers match '${query}'. Specify one:`,
    candidates: rows.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.name ?? "(no name)",
      email: r.email,
    })),
  };
}
