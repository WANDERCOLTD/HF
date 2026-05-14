import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains/:domainId/knowledge-map
 * @visibility internal
 * @scope domains:read
 * @auth VIEWER
 * @tags domains, content-trust
 * @description Returns the hierarchical pyramid structure for a domain's content.
 *   Only returns assertions that have been structured (depth IS NOT NULL).
 *   Used by the wizard Knowledge Map accordion to show the pedagogical hierarchy.
 * @pathParam domainId string - Domain UUID
 * @query subjectIds string - Comma-separated subject IDs to scope results
 * @response 200 { ok, sources: Array<{ sourceId, sourceName, tree }>, stats }
 * @response 404 { ok: false, error: "Domain not found" }
 */

interface KnowledgeNode {
  id: string;
  text: string;
  category: string;
  depth: number;
  childCount: number;
  children: KnowledgeNode[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const { searchParams } = new URL(req.url);
    const subjectIdsParam = searchParams.get("subjectIds");
    const subjectIds = subjectIdsParam ? subjectIdsParam.split(",").filter(Boolean) : undefined;
    const playbookId = searchParams.get("playbookId");

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    // Get sources — prefer playbookId (PlaybookSource), fall back to subjectIds
    let sources: { id: string; name: string }[];
    let playbookSourceIds: string[] | null = null;
    const subjectFilter = subjectIds?.length
      ? { subject: { id: { in: subjectIds }, domains: { some: { domainId } } } }
      : { subject: { domains: { some: { domainId } } } };
    if (playbookId) {
      const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
      playbookSourceIds = await getSourceIdsForPlaybook(playbookId);
      sources = playbookSourceIds.length > 0
        ? await prisma.contentSource.findMany({
            where: { id: { in: playbookSourceIds }, assertions: { some: { depth: { not: null } } } },
            select: { id: true, name: true },
          })
        : [];
    } else {
      sources = await prisma.contentSource.findMany({
        where: {
          subjects: { some: subjectFilter },
          assertions: { some: { depth: { not: null } } },
        },
        select: { id: true, name: true },
      });
    }

    if (sources.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        stats: { totalTopics: 0, totalPoints: 0, structuredSources: 0, totalSources: 0 },
      });
    }

    const sourceIds = sources.map((s) => s.id);

    // Fetch all structured assertions for these sources
    const assertions = await prisma.contentAssertion.findMany({
      where: {
        sourceId: { in: sourceIds },
        depth: { not: null },
      },
      select: {
        id: true,
        assertion: true,
        category: true,
        depth: true,
        parentId: true,
        orderIndex: true,
        sourceId: true,
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    });

    // Group by source and build trees
    const bySource = new Map<string, typeof assertions>();
    for (const a of assertions) {
      const list = bySource.get(a.sourceId) || [];
      list.push(a);
      bySource.set(a.sourceId, list);
    }

    let totalTopics = 0;
    let totalPoints = 0;

    const sourceTrees = sources.map((source) => {
      const sourceAssertions = bySource.get(source.id) || [];
      const tree = buildTree(sourceAssertions);

      // Count depth-1 nodes as "topics", all leaf nodes as "points"
      for (const a of sourceAssertions) {
        if (a.depth === 1) totalTopics++;
        const hasChildren = sourceAssertions.some((c) => c.parentId === a.id);
        if (!hasChildren) totalPoints++;
      }

      return {
        sourceId: source.id,
        sourceName: source.name,
        tree,
      };
    });

    // Get total source count for the scope (including unstructured)
    const totalSources = playbookSourceIds !== null
      ? playbookSourceIds.length
      : await prisma.contentSource.count({
          where: { subjects: { some: subjectFilter } },
        });

    return NextResponse.json({
      ok: true,
      sources: sourceTrees,
      stats: {
        totalTopics,
        totalPoints,
        structuredSources: sources.length,
        totalSources,
      },
    });
  } catch (error: unknown) {
    console.error("[domains/:id/knowledge-map] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load knowledge map" },
      { status: 500 }
    );
  }
}

/**
 * Build a nested tree from flat assertions with parentId references.
 */
function buildTree(
  assertions: Array<{
    id: string;
    assertion: string;
    category: string;
    depth: number | null;
    parentId: string | null;
    orderIndex: number | null;
  }>
): KnowledgeNode[] {
  // Index by id for fast parent lookup
  const nodeMap = new Map<string, KnowledgeNode>();
  const roots: KnowledgeNode[] = [];

  // Create all nodes first
  for (const a of assertions) {
    nodeMap.set(a.id, {
      id: a.id,
      text: a.assertion,
      category: a.category,
      depth: a.depth ?? 0,
      childCount: 0,
      children: [],
    });
  }

  // Link children to parents
  for (const a of assertions) {
    const node = nodeMap.get(a.id)!;
    if (a.parentId && nodeMap.has(a.parentId)) {
      const parent = nodeMap.get(a.parentId)!;
      parent.children.push(node);
      parent.childCount = parent.children.length;
    } else if (!a.parentId || !nodeMap.has(a.parentId)) {
      // Root node or orphan (parent not in structured set)
      roots.push(node);
    }
  }

  // Sort children by original order
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => {
      const aIdx = assertions.find((x) => x.id === a.id)?.orderIndex ?? 0;
      const bIdx = assertions.find((x) => x.id === b.id)?.orderIndex ?? 0;
      return (aIdx ?? 0) - (bIdx ?? 0);
    });
  }

  return roots;
}
