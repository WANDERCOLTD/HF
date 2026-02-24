import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api GET /api/content-review/items
 * @visibility internal
 * @scope content-review:read
 * @auth OPERATOR
 * @tags content-review
 * @description Returns detailed items for the content review page:
 *   dirty content specs (curriculum outdated) and recent extraction errors.
 * @response 200 { ok: true, dirtySpecs: [...], errorTasks: [...] }
 * @response 401 Unauthorized
 */
export async function GET() {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [dirtySpecs, errorTasks] = await Promise.all([
    // Content specs with isDirty (new assertions arrived since last generation)
    prisma.analysisSpec.findMany({
      where: {
        specRole: "CONTENT",
        isDirty: true,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        dirtyReason: true,
        config: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),

    // Failed extraction tasks (last 7 days — status "abandoned" with error in context)
    prisma.userTask.findMany({
      where: {
        taskType: "extraction",
        status: "abandoned",
        startedAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        context: true,
        startedAt: true,
      },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
  ]);

  // Resolve domain for each dirty spec via PlaybookItem → Playbook → Domain
  const specIds = dirtySpecs.map((s) => s.id);
  const specDomainMap = new Map<string, { domainId: string; domainName: string }>();

  if (specIds.length > 0) {
    const playbookItems = await prisma.playbookItem.findMany({
      where: { specId: { in: specIds } },
      select: {
        specId: true,
        playbook: {
          select: {
            domain: { select: { id: true, name: true } },
          },
        },
      },
    });
    for (const item of playbookItems) {
      if (item.specId && item.playbook?.domain) {
        specDomainMap.set(item.specId, {
          domainId: item.playbook.domain.id,
          domainName: item.playbook.domain.name,
        });
      }
    }
  }

  const enrichedSpecs = dirtySpecs.map((spec) => {
    const cfg = spec.config as Record<string, any> | null;
    const domain = specDomainMap.get(spec.id);
    return {
      id: spec.id,
      slug: spec.slug,
      name: spec.name,
      dirtyReason: spec.dirtyReason,
      assertionCount: cfg?.assertionCount ?? 0,
      moduleCount: Array.isArray(cfg?.modules) ? cfg.modules.length : 0,
      generatedAt: cfg?.generatedAt ?? null,
      updatedAt: spec.updatedAt,
      domainId: domain?.domainId ?? null,
      domainName: domain?.domainName ?? null,
    };
  });

  // Enrich error tasks with source info from context
  const enrichedErrors = errorTasks.map((task) => {
    const ctx = task.context as Record<string, any> | null;
    return {
      id: task.id,
      sourceId: ctx?.sourceId ?? null,
      sourceName: ctx?.sourceName ?? "Unknown source",
      error: ctx?.error ?? "Unknown error",
      createdAt: task.startedAt,
    };
  });

  return NextResponse.json({
    ok: true,
    dirtySpecs: enrichedSpecs,
    errorTasks: enrichedErrors,
  });
}
