/**
 * Domain name → id resolver for Cmd+K scope prefixes (#1442 Slice 5).
 *
 * Same resolution shape as caller and playbook resolvers. Matches against
 * `Domain.name` (case-insensitive). Institution-scoped via
 * `Domain.institutionId` directly when provided.
 */

import { prisma } from "@/lib/prisma";

export interface ResolveDomainOpts {
  institutionId?: string;
}

export type ResolveDomainResult =
  | { ok: true; domainId: string; label: string }
  | {
      ok: false;
      reason: string;
      candidates?: { id: string; name: string }[];
    };

export async function resolveDomainByName(
  name: string,
  opts: ResolveDomainOpts = {},
): Promise<ResolveDomainResult> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Domain name is required" };
  }

  const institutionWhere = opts.institutionId
    ? { institutionId: opts.institutionId }
    : {};

  const exact = await prisma.domain.findMany({
    where: {
      name: { equals: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true },
    take: 6,
  });

  if (exact.length === 1) {
    return { ok: true, domainId: exact[0].id, label: exact[0].name };
  }
  if (exact.length > 1) {
    return ambiguous(trimmed, exact);
  }

  const partial = await prisma.domain.findMany({
    where: {
      name: { contains: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 6,
  });

  if (partial.length === 0) {
    return { ok: false, reason: `No domain found matching '${trimmed}'` };
  }
  if (partial.length === 1) {
    return { ok: true, domainId: partial[0].id, label: partial[0].name };
  }
  return ambiguous(trimmed, partial);
}

function ambiguous(
  query: string,
  rows: { id: string; name: string }[],
): ResolveDomainResult {
  return {
    ok: false,
    reason: `Ambiguous — ${rows.length} domains match '${query}'. Specify one:`,
    candidates: rows.slice(0, 5).map((r) => ({ id: r.id, name: r.name })),
  };
}
