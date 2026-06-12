/**
 * Playbook name → id resolver for Cmd+K scope prefixes (#1442 Slice 5).
 *
 * Same resolution shape as `caller-by-name`. Matches against `Playbook.name`
 * (the schema field — not `title`). Institution-scoped via
 * `Playbook.domain.institutionId` when provided.
 */

import { prisma } from "@/lib/prisma";

export interface ResolvePlaybookOpts {
  institutionId?: string;
}

export type ResolvePlaybookResult =
  | { ok: true; playbookId: string; domainId: string; label: string }
  | {
      ok: false;
      reason: string;
      candidates?: { id: string; title: string }[];
    };

export async function resolvePlaybookByName(
  name: string,
  opts: ResolvePlaybookOpts = {},
): Promise<ResolvePlaybookResult> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Course name is required" };
  }

  const institutionWhere = opts.institutionId
    ? { domain: { is: { institutionId: opts.institutionId } } }
    : {};

  const exact = await prisma.playbook.findMany({
    where: {
      name: { equals: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true, domainId: true },
    take: 6,
  });

  if (exact.length === 1) {
    return {
      ok: true,
      playbookId: exact[0].id,
      domainId: exact[0].domainId,
      label: exact[0].name,
    };
  }
  if (exact.length > 1) {
    return ambiguous(trimmed, exact);
  }

  const partial = await prisma.playbook.findMany({
    where: {
      name: { contains: trimmed, mode: "insensitive" },
      ...institutionWhere,
    },
    select: { id: true, name: true, domainId: true },
    orderBy: { name: "asc" },
    take: 6,
  });

  if (partial.length === 0) {
    return { ok: false, reason: `No course found matching '${trimmed}'` };
  }
  if (partial.length === 1) {
    return {
      ok: true,
      playbookId: partial[0].id,
      domainId: partial[0].domainId,
      label: partial[0].name,
    };
  }
  return ambiguous(trimmed, partial);
}

function ambiguous(
  query: string,
  rows: { id: string; name: string }[],
): ResolvePlaybookResult {
  return {
    ok: false,
    reason: `Ambiguous — ${rows.length} courses match '${query}'. Specify one:`,
    candidates: rows.slice(0, 5).map((r) => ({ id: r.id, title: r.name })),
  };
}
