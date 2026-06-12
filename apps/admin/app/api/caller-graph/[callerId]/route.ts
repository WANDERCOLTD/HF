import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

type CallerNodeType =
  | "caller"
  | "domain"
  | "paramGroup"
  | "personality"
  | "memoryGroup"
  | "memory"
  | "call"
  | "goal"
  | "target"
  | "identity";

interface NodeDetail {
  label: string;
  value: string | number | boolean | null;
}

interface GraphNode {
  id: string;
  label: string;
  type: CallerNodeType;
  slug?: string;
  group?: string;
  details?: NodeDetail[];
  value?: number;       // For parameter nodes: score (0-1)
  status?: string;      // For goal nodes: ACTIVE/COMPLETED etc.
  // Visual encoding metadata (used by rich mode)
  confidence?: number;
  decayFactor?: number;
  category?: string;
  progress?: number;
  age?: number;
  scoreCount?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

/**
 * @api GET /api/caller-graph/:callerId
 * @visibility internal
 * @auth session
 * @tags callers
 * @description Build a caller-centric knowledge graph with nodes and edges for visualization. Includes personality, memories, calls, goals, targets, and identities.
 * @pathParam callerId string - The caller ID to build graph for
 * @response 200 { ok: true, caller: { id, name }, nodes: Array<{ id, label, type, slug?, group?, details?, value?, status? }>, edges: Array<{ from, to, type }>, counts: { nodes, edges, byType } }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;


    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    const addNode = (node: GraphNode) => {
      if (!nodeIds.has(node.id)) {
        nodes.push(node);
        nodeIds.add(node.id);
      }
    };

    // Fetch all caller data in parallel
    const [caller, personalityProfile, memories, calls, goals, callerTargets, identities] = await Promise.all([
      prisma.caller.findUnique({
        where: { id: callerId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          externalId: true,
          createdAt: true,
          domain: { select: { id: true, slug: true, name: true, description: true } },
        },
      }),
      prisma.callerPersonalityProfile.findUnique({
        where: { callerId },
        select: { parameterValues: true, lastUpdatedAt: true, callsUsed: true },
      }),
      prisma.callerMemory.findMany({
        where: {
          callerId,
          supersededById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ category: "asc" }, { confidence: "desc" }],
        take: 100,
        select: {
          id: true,
          category: true,
          key: true,
          value: true,
          confidence: true,
          extractedAt: true,
        },
      }),
      prisma.call.findMany({
        where: { callerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          source: true,
          createdAt: true,
          // #1344 Slice 4 — `callSequence` gone; walk via Session FK.
          session: { select: { learnerFacingNumber: true } },
          _count: { select: { scores: true, behaviorMeasurements: true } },
        },
      }),
      prisma.goal.findMany({
        where: { callerId },
        select: {
          id: true,
          type: true,
          name: true,
          description: true,
          status: true,
          priority: true,
          progress: true,
          playbookId: true,
        },
      }),
      prisma.callerTarget.findMany({
        where: { callerId },
        select: {
          id: true,
          parameterId: true,
          targetValue: true,
          confidence: true,
          callsUsed: true,
          parameter: { select: { name: true, domainGroup: true } },
        },
      }),
      prisma.callerIdentity.findMany({
        where: { callerId },
        select: {
          id: true,
          name: true,
          externalId: true,
          callCount: true,
          lastCallAt: true,
          segment: { select: { name: true } },
        },
      }),
    ]);

    if (!caller) {
      return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
    }

    // 1. CALLER HUB NODE
    const callerLabel = caller.name || caller.email || caller.phone || caller.externalId || caller.id;
    addNode({
      id: `caller:${caller.id}`,
      label: callerLabel,
      type: "caller",
      details: [
        { label: "Name", value: caller.name },
        { label: "Email", value: caller.email },
        { label: "Phone", value: caller.phone },
        { label: "External ID", value: caller.externalId },
        { label: "Created", value: caller.createdAt.toISOString().split("T")[0] },
      ].filter(d => d.value !== null && d.value !== undefined),
    });

    // 2. DOMAIN NODE
    if (caller.domain) {
      addNode({
        id: `domain:${caller.domain.id}`,
        label: caller.domain.name,
        type: "domain",
        slug: caller.domain.slug,
        details: [
          { label: "Name", value: caller.domain.name },
          { label: "Slug", value: caller.domain.slug },
          { label: "Description", value: caller.domain.description?.slice(0, 100) ?? null },
        ].filter(d => d.value !== null && d.value !== undefined),
      });
      edges.push({ from: `caller:${caller.id}`, to: `domain:${caller.domain.id}`, type: "belongs_to" });
    }

    // 3. PERSONALITY CLUSTER
    const paramValues = (personalityProfile?.parameterValues ?? {}) as Record<string, number>;
    const paramKeys = Object.keys(paramValues);

    if (paramKeys.length > 0) {
      // Group node
      addNode({
        id: "group:personality",
        label: `Personality (${paramKeys.length})`,
        type: "paramGroup",
        group: "personality",
        details: [
          { label: "Parameters", value: paramKeys.length },
          { label: "Last Updated", value: personalityProfile?.lastUpdatedAt?.toISOString().split("T")[0] ?? null },
          { label: "Calls Used", value: personalityProfile?.callsUsed ?? null },
        ].filter(d => d.value !== null && d.value !== undefined),
      });
      edges.push({ from: `caller:${caller.id}`, to: "group:personality", type: "has_params" });

      // Individual param nodes
      for (const key of paramKeys) {
        const val = paramValues[key];
        addNode({
          id: `param:${key}`,
          label: `${key}: ${val.toFixed(2)}`,
          type: "personality",
          slug: key,
          group: "personality",
          value: val,
          details: [
            { label: "Parameter", value: key },
            { label: "Score", value: Math.round(val * 100) / 100 },
          ],
        });
        edges.push({ from: "group:personality", to: `param:${key}`, type: "has_param" });
      }
    }

    // 4. MEMORY CLUSTER
    if (memories.length > 0) {
      // Group by category
      const byCategory = new Map<string, typeof memories>();
      for (const mem of memories) {
        const cat = mem.category;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(mem);
      }

      for (const [category, mems] of byCategory) {
        // Category group node
        addNode({
          id: `memGroup:${category}`,
          label: `${category} (${mems.length})`,
          type: "memoryGroup",
          group: "memory",
          details: [
            { label: "Category", value: category },
            { label: "Count", value: mems.length },
          ],
        });
        edges.push({ from: `caller:${caller.id}`, to: `memGroup:${category}`, type: "has_memories" });

        // Individual memory nodes (cap at 15 per category to avoid clutter)
        for (const mem of mems.slice(0, 15)) {
          // Compute decay factor based on category and age
          const categoryDecay: Record<string, number> = {
            FACT: 1.0, PREFERENCE: 1.0, RELATIONSHIP: 1.0,
            TOPIC: 0.95, EVENT: 0.90, CONTEXT: 0.85,
          };
          const decay = categoryDecay[mem.category] ?? 1.0;
          const daysSince = mem.extractedAt
            ? (Date.now() - mem.extractedAt.getTime()) / (1000 * 60 * 60 * 24)
            : 0;
          const decayFactor = Math.pow(decay, daysSince / 30);

          addNode({
            id: `memory:${mem.id}`,
            label: `${mem.key}: ${mem.value.slice(0, 30)}${mem.value.length > 30 ? "..." : ""}`,
            type: "memory",
            group: "memory",
            value: mem.confidence ?? undefined,
            confidence: mem.confidence ?? undefined,
            decayFactor,
            category: mem.category,
            details: [
              { label: "Key", value: mem.key },
              { label: "Value", value: mem.value.slice(0, 100) },
              { label: "Category", value: mem.category },
              { label: "Confidence", value: mem.confidence },
              { label: "Extracted", value: mem.extractedAt?.toISOString().split("T")[0] ?? null },
            ].filter(d => d.value !== null && d.value !== undefined),
          });
          edges.push({ from: `memGroup:${category}`, to: `memory:${mem.id}`, type: "memory_in" });
        }
      }
    }

    // 5. CALL CLUSTER
    if (calls.length > 0) {
      const maxSeq = Math.max(
        ...calls.map((c) => c.session?.learnerFacingNumber ?? 0),
        1,
      );
      for (const call of calls) {
        const dateStr = call.createdAt.toISOString().split("T")[0];
        const lfn = call.session?.learnerFacingNumber ?? null;
        const seq = lfn != null ? `#${lfn}` : "";
        const age = maxSeq > 0 ? 1 - ((lfn ?? 0) / maxSeq) : 0;
        addNode({
          id: `call:${call.id}`,
          label: `${seq} ${dateStr}`.trim(),
          type: "call",
          group: "calls",
          scoreCount: call._count.scores + call._count.behaviorMeasurements,
          age,
          details: [
            { label: "Date", value: dateStr },
            { label: "Source", value: call.source },
            { label: "Sequence", value: lfn },
            { label: "Scores", value: call._count.scores },
            { label: "Measurements", value: call._count.behaviorMeasurements },
          ].filter(d => d.value !== null && d.value !== undefined),
        });
        edges.push({ from: `caller:${caller.id}`, to: `call:${call.id}`, type: "made_call" });
      }
    }

    // 6. GOAL CLUSTER
    if (goals.length > 0) {
      for (const goal of goals) {
        addNode({
          id: `goal:${goal.id}`,
          label: goal.name,
          type: "goal",
          group: "goals",
          status: goal.status,
          value: goal.progress,
          progress: goal.progress,
          details: [
            { label: "Name", value: goal.name },
            { label: "Type", value: goal.type },
            { label: "Status", value: goal.status },
            { label: "Priority", value: goal.priority },
            { label: "Progress", value: `${Math.round(goal.progress * 100)}%` },
            { label: "Description", value: goal.description?.slice(0, 80) ?? null },
          ].filter(d => d.value !== null && d.value !== undefined),
        });
        edges.push({ from: `caller:${caller.id}`, to: `goal:${goal.id}`, type: "pursues" });
      }
    }

    // 7. TARGET CLUSTER
    if (callerTargets.length > 0) {
      for (const target of callerTargets) {
        const paramName = target.parameter?.name || target.parameterId;
        addNode({
          id: `target:${target.id}`,
          label: `${paramName}: ${target.targetValue.toFixed(2)}`,
          type: "target",
          group: "targets",
          value: target.targetValue,
          confidence: target.confidence ?? undefined,
          details: [
            { label: "Parameter", value: paramName },
            { label: "Target", value: Math.round(target.targetValue * 100) / 100 },
            { label: "Confidence", value: Math.round((target.confidence ?? 0) * 100) / 100 },
            { label: "Calls Used", value: target.callsUsed },
            { label: "Domain Group", value: target.parameter?.domainGroup ?? null },
          ].filter(d => d.value !== null && d.value !== undefined),
        });
        edges.push({ from: `caller:${caller.id}`, to: `target:${target.id}`, type: "has_target" });

        // Cross-link: target -> personality param (if it exists)
        if (nodeIds.has(`param:${target.parameterId}`)) {
          edges.push({ from: `target:${target.id}`, to: `param:${target.parameterId}`, type: "calibrates" });
        }
      }
    }

    // 8. IDENTITY NODES
    if (identities.length > 0) {
      for (const identity of identities) {
        const label = identity.name || identity.externalId || identity.id.slice(0, 8);
        addNode({
          id: `identity:${identity.id}`,
          label,
          type: "identity",
          group: "identities",
          details: [
            { label: "Name", value: identity.name },
            { label: "External ID", value: identity.externalId },
            { label: "Calls", value: identity.callCount },
            { label: "Last Call", value: identity.lastCallAt?.toISOString().split("T")[0] ?? null },
            { label: "Segment", value: identity.segment?.name ?? null },
          ].filter(d => d.value !== null && d.value !== undefined),
        });
        edges.push({ from: `caller:${caller.id}`, to: `identity:${identity.id}`, type: "identified_by" });
      }
    }

    // Build counts by type
    const byType: Record<string, number> = {};
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      caller: { id: caller.id, name: callerLabel },
      nodes,
      edges,
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        byType,
      },
    });
  } catch (error: any) {
    console.error("Error building caller graph:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to build caller graph" },
      { status: 500 }
    );
  }
}
