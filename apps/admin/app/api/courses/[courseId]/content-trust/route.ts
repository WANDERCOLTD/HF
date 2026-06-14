/**
 * @api GET /api/courses/[courseId]/content-trust
 *
 * Source freshness summary for the A.8 Inspector renderer (Epic #1606
 * / #1634).
 *
 * Auth: OPERATOR+. Course-scoped only — no caller context required.
 *
 * Walks the canonical course → Playbook → PlaybookSubject → Subject →
 * ContentSource chain (matches `lib/config.ts:248`-documented order)
 * and runs an inline freshness check on each source's `validUntil`.
 * Returns a flat `FreshnessWarning[]` plus the total source count so
 * the renderer can render the right empty state ("no sources" vs "all
 * fresh" vs "N warnings").
 *
 * The freshness logic mirrors
 * `lib/prompt/composition/transforms/trust.ts::checkFreshness` —
 * which is a private function in that module. We keep this route
 * self-contained rather than refactor that one for export, since the
 * server-side compose path doesn't need the JSON wire format anyway.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export interface FreshnessWarning {
  message: string;
  severity: "expired" | "expiring" | "info";
  sourceName: string;
}

interface ContentTrustResponse {
  ok: boolean;
  warnings: FreshnessWarning[];
  sourceCount: number;
}

const FRESHNESS_WARNING_DAYS = 60;

function checkFreshness(
  validUntil: Date | null,
  sourceName: string,
): FreshnessWarning | null {
  if (!validUntil) return null;
  const now = new Date();
  const daysUntilExpiry = Math.floor(
    (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntilExpiry < 0) {
    return {
      sourceName,
      severity: "expired",
      message: `Expired ${Math.abs(daysUntilExpiry)} days ago (${validUntil
        .toISOString()
        .slice(0, 10)})`,
    };
  }
  if (daysUntilExpiry <= FRESHNESS_WARNING_DAYS) {
    return {
      sourceName,
      severity: "expiring",
      message: `Expires in ${daysUntilExpiry} days (${validUntil
        .toISOString()
        .slice(0, 10)})`,
    };
  }
  return null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ courseId: string }> },
): Promise<NextResponse<ContentTrustResponse>> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    return auth.error as NextResponse<ContentTrustResponse>;
  }
  const { courseId } = await context.params;
  // Use the direct PlaybookSource chain (canonical post-#94 path) rather
  // than the 4-hop Playbook → PlaybookSubject → Subject → SubjectSource
  // chain the schema deprecates for content retrieval.
  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: {
      playbookSources: {
        select: {
          source: {
            select: { id: true, name: true, validUntil: true },
          },
        },
      },
    },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, warnings: [], sourceCount: 0 },
      { status: 404 },
    );
  }
  const sources = playbook.playbookSources
    .map((ps) => ps.source)
    .filter((s): s is { id: string; name: string; validUntil: Date | null } =>
      s != null,
    );
  const warnings: FreshnessWarning[] = [];
  for (const s of sources) {
    const w = checkFreshness(s.validUntil, s.name);
    if (w) warnings.push(w);
  }
  return NextResponse.json({
    ok: true,
    warnings,
    sourceCount: sources.length,
  });
}
