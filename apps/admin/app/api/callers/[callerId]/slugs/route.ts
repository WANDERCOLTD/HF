import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/slugs
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, slugs, composition
 * @description Returns all resolved template variables/slugs for a specific caller as a hierarchical tree. Shows values currently available for prompt composition including Identity/Content/Voice from playbook specs, Memories from LEARN specs, Scores from MEASURE specs, and Personalized targets from ADAPT specs. Also identifies template variables that are defined but not yet populated.
 * @pathParam callerId string - The caller ID to fetch slugs for
 * @response 200 { ok: true, caller: { id, name, domain }, playbook: { id, name, status } | null, tree: SlugNode[], counts: { memories, scores, targets, available, total } }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to fetch caller slugs" }
 */

type SlugNode = {
  id: string;
  type: "category" | "spec" | "variable" | "value";
  name: string;
  path?: string;
  value?: string | number | boolean | null;
  specId?: string;
  specSlug?: string;
  children?: SlugNode[];
  meta?: Record<string, any>;
};

export async function GET(
  request: NextRequest,
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
    // Load caller with domain
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      include: {
        domain: true,
      },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Load caller's memories
    const memories = await prisma.callerMemory.findMany({
      where: {
        callerId,
        supersededById: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ category: "asc" }, { confidence: "desc" }],
      select: {
        id: true,
        category: true,
        key: true,
        value: true,
        confidence: true,
        extractedBy: true,
        createdAt: true,
      },
    });

    // Load caller's latest scores (from most recent call)
    const latestCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        scores: {
          include: {
            parameter: {
              select: { name: true, parameterId: true, sectionId: true },
            },
            analysisSpec: {
              select: { slug: true, name: true },
            },
          },
        },
      },
    });

    // Load caller's personalized targets
    const callerTargets = await prisma.callerTarget.findMany({
      where: { callerId },
      include: {
        parameter: {
          select: { name: true, parameterId: true, domainGroup: true },
        },
      },
    });

    // Load playbook — enrollment-first, then domain fallback
    let playbook = null;
    let playbookSpecs: any[] = [];
    const availableSlugNames = new Set<string>();

    const playbookInclude = {
      items: {
        where: { isEnabled: true },
        include: {
          spec: true,
          promptTemplate: {
            select: {
              systemPrompt: true,
              contextTemplate: true,
            },
          },
        },
      },
    };

    // 1. Check CallerPlaybook enrollments first
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { callerId, status: "ACTIVE" },
      select: { playbookId: true },
    });

    if (enrollments.length > 0) {
      playbook = await prisma.playbook.findFirst({
        where: {
          id: { in: enrollments.map(e => e.playbookId) },
          status: { in: ["PUBLISHED", "DRAFT"] },
        },
        orderBy: { status: "asc" },
        include: playbookInclude,
      });
    }

    // 2. Domain fallback (if no enrolled playbooks found)
    if (!playbook && caller.domainId) {
      playbook = await prisma.playbook.findFirst({
        where: {
          domainId: caller.domainId,
          status: { in: ["PUBLISHED", "DRAFT"] },
        },
        orderBy: { status: "asc" },
        include: playbookInclude,
      });
    }

    if (caller.domainId) {

      // Also load system specs
      const systemSpecs = await prisma.analysisSpec.findMany({
        where: { scope: "SYSTEM", isActive: true },
      });

      if (playbook) {
        playbookSpecs = [
          ...systemSpecs,
          ...playbook.items.filter((i) => i.spec).map((i) => i.spec!),
        ];

        // Extract available slug names from prompt templates
        const slugPattern = /\{slug\.([a-zA-Z0-9_]+)\}/g;
        for (const item of playbook.items) {
          if (item.promptTemplate) {
            const templates = [
              item.promptTemplate.systemPrompt,
              item.promptTemplate.contextTemplate,
            ].filter(Boolean);

            for (const template of templates) {
              let match;
              while ((match = slugPattern.exec(template as string)) !== null) {
                availableSlugNames.add(match[1]);
              }
            }
          }
        }
      }
    }

    // Build the tree
    const tree: SlugNode[] = [];

    // === IDENTITY from playbook ===
    const identitySpec = playbookSpecs.find(
      (s) => s.specRole === "IDENTITY" && s.domain !== "voice"
    );
    if (identitySpec) {
      const config = identitySpec.config as Record<string, any> | null;
      const identityCategory: SlugNode = {
        id: "category-identity",
        type: "category",
        name: "IDENTITY",
        meta: { icon: "🎭", description: "Agent identity from playbook", fromPlaybook: true },
        children: [
          {
            id: identitySpec.id,
            type: "spec",
            name: identitySpec.name,
            specId: identitySpec.id,
            specSlug: identitySpec.slug,
            children: config
              ? Object.entries(config).slice(0, 10).map(([key, value]) => ({
                  id: `identity-${key}`,
                  type: "variable" as const,
                  name: key,
                  path: `{identity.${key}}`,
                  value: typeof value === "string" ? value.substring(0, 100) : JSON.stringify(value).substring(0, 100),
                }))
              : [],
          },
        ],
      };
      tree.push(identityCategory);
    }

    // === MEMORIES ===
    if (memories.length > 0) {
      // Group by category (FACT, PREFERENCE, EVENT, TOPIC, etc.)
      const memoryByCategory = new Map<string, typeof memories>();
      for (const mem of memories) {
        const category = mem.category || "unknown";
        if (!memoryByCategory.has(category)) {
          memoryByCategory.set(category, []);
        }
        memoryByCategory.get(category)!.push(mem);
      }

      const memoriesCategory: SlugNode = {
        id: "category-memories",
        type: "category",
        name: "MEMORIES",
        meta: {
          icon: "🧠",
          description: `${memories.length} active memories`,
          count: memories.length,
        },
        children: [],
      };

      for (const [category, categoryMemories] of memoryByCategory) {
        const categoryNode: SlugNode = {
          id: `memory-category-${category}`,
          type: "spec",
          name: category,
          meta: { count: categoryMemories.length },
          children: categoryMemories.map((mem) => ({
            id: mem.id,
            type: "variable" as const,
            name: mem.key,
            path: `{memory.${mem.key}}`,
            value: mem.value.substring(0, 80),
            meta: {
              confidence: mem.confidence,
              category: mem.category,
              createdAt: mem.createdAt,
            },
          })),
        };

        memoriesCategory.children!.push(categoryNode);
      }

      tree.push(memoriesCategory);
    }

    // === SCORES (latest call) ===
    if (latestCall && latestCall.scores.length > 0) {
      // Group by AnalysisSpec slug when present; otherwise derive a
      // friendly category from the Parameter so the tree never shows
      // "unknown (unknown)" for personality / VARK / conversational
      // params that are scored outside the spec pipeline.
      const scoresBySpec = new Map<string, typeof latestCall.scores>();
      const groupLabels = new Map<string, string>(); // group key → display name
      for (const score of latestCall.scores) {
        const fromSpec = score.analysisSpec?.slug;
        const groupKey = fromSpec
          || categoryKeyForParameter(score.parameter?.parameterId, score.parameter?.sectionId);
        const label = fromSpec
          ? (score.analysisSpec?.name ?? fromSpec)
          : categoryLabelFor(groupKey);
        if (!scoresBySpec.has(groupKey)) scoresBySpec.set(groupKey, []);
        scoresBySpec.get(groupKey)!.push(score);
        if (!groupLabels.has(groupKey)) groupLabels.set(groupKey, label);
      }

      const scoresCategory: SlugNode = {
        id: "category-scores",
        type: "category",
        name: "SCORES",
        meta: {
          icon: "📊",
          description: `${latestCall.scores.length} scores from latest call`,
          callDate: latestCall.createdAt,
          count: latestCall.scores.length,
        },
        children: [],
      };

      for (const [specSlug, specScores] of scoresBySpec) {
        const displayName = groupLabels.get(specSlug) ?? specSlug;
        const specNode: SlugNode = {
          id: `score-spec-${specSlug}`,
          type: "spec",
          name: displayName,
          // Skip the parenthesised slug suffix when it carries no new
          // information (derived category groups have name === slug).
          specSlug: displayName === specSlug ? undefined : specSlug,
          children: specScores.map((score) => ({
            id: score.id,
            type: "variable" as const,
            name: score.parameter?.name || score.parameterId,
            path: `{scores.${score.parameterId}}`,
            value: (score.score * 100).toFixed(0) + "%",
            meta: {
              parameterId: score.parameterId,
              confidence: score.confidence,
              linkTo: `/parameters?id=${score.parameterId}`,
            },
          })),
        };
        scoresCategory.children!.push(specNode);
      }

      tree.push(scoresCategory);
    }

    // === PERSONALIZED TARGETS ===
    if (callerTargets.length > 0) {
      // Group by parameter domain group
      const targetsByGroup = new Map<string, typeof callerTargets>();
      for (const target of callerTargets) {
        const group = target.parameter?.domainGroup || "Other";
        if (!targetsByGroup.has(group)) {
          targetsByGroup.set(group, []);
        }
        targetsByGroup.get(group)!.push(target);
      }

      const targetsCategory: SlugNode = {
        id: "category-targets",
        type: "category",
        name: "PERSONALIZED TARGETS",
        meta: {
          icon: "🎯",
          description: `${callerTargets.length} adapted behavior targets`,
          count: callerTargets.length,
        },
        children: [],
      };

      for (const [group, groupTargets] of targetsByGroup) {
        const groupNode: SlugNode = {
          id: `target-group-${group}`,
          type: "spec",
          name: group,
          meta: { count: groupTargets.length },
          children: groupTargets.map((target) => ({
            id: target.id,
            type: "variable" as const,
            name: target.parameter?.name || target.parameterId,
            path: `{targets.${target.parameterId}}`,
            value: target.targetValue.toFixed(2),
            meta: {
              parameterId: target.parameterId,
              confidence: target.confidence,
              linkTo: `/parameters?id=${target.parameterId}`,
            },
          })),
        };
        targetsCategory.children!.push(groupNode);
      }

      tree.push(targetsCategory);
    }

    // === AVAILABLE TEMPLATE VARIABLES ===
    // Show slug names defined in templates that don't have values yet
    if (availableSlugNames.size > 0) {
      // Collect slug names that already have values
      const slugsWithValues = new Set<string>();

      // From memories
      memories.forEach((mem) => slugsWithValues.add(mem.key));

      // From scores
      latestCall?.scores.forEach((score) => slugsWithValues.add(score.parameterId));

      // From targets
      callerTargets.forEach((target) => slugsWithValues.add(target.parameterId));

      // Find slugs that don't have values yet
      const slugsWithoutValues = Array.from(availableSlugNames).filter(
        (name) => !slugsWithValues.has(name)
      );

      if (slugsWithoutValues.length > 0) {
        const availableCategory: SlugNode = {
          id: "category-available",
          type: "category",
          name: "AVAILABLE VARIABLES",
          meta: {
            icon: "📋",
            description: `${slugsWithoutValues.length} template variables awaiting values`,
            count: slugsWithoutValues.length,
          },
          children: slugsWithoutValues.sort().map((name) => ({
            id: `available-${name}`,
            type: "variable" as const,
            name,
            path: `{slug.${name}}`,
            value: "(will be populated after pipeline runs)",
            meta: { available: true, hasValue: false },
          })),
        };
        tree.push(availableCategory);
      }
    }

    // Count totals
    const counts = {
      memories: memories.length,
      scores: latestCall?.scores.length || 0,
      targets: callerTargets.length,
      available: availableSlugNames.size,
      total: memories.length + (latestCall?.scores.length || 0) + callerTargets.length,
    };

    return NextResponse.json({
      ok: true,
      caller: {
        id: caller.id,
        name: caller.name,
        domain: caller.domain?.name || null,
      },
      playbook: playbook
        ? { id: playbook.id, name: playbook.name, status: playbook.status }
        : null,
      tree,
      counts,
    });
  } catch (error: any) {
    console.error("Error fetching caller slugs:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch caller slugs" },
      { status: 500 }
    );
  }
}

/**
 * Friendly category key for a Parameter that isn't owned by an AnalysisSpec
 * (e.g. Big Five / VARK / personality / conversational params scored by
 * `lib/ops/personality-analyze.ts`). Used by the slugs tree to label the
 * sub-group instead of showing "unknown".
 */
function categoryKeyForParameter(
  parameterId: string | null | undefined,
  sectionId: string | null | undefined,
): string {
  if (sectionId && sectionId.trim().length > 0) return sectionId;
  const pid = parameterId ?? "";
  if (pid.startsWith("B5-")) return "big-five";
  if (pid.startsWith("VARK-")) return "vark";
  if (pid.startsWith("CP-")) return "personality";
  if (pid.startsWith("CONV_") || pid.startsWith("conv_")) return "conversation";
  if (pid.startsWith("TONE_") || pid.startsWith("tone_")) return "conversation";
  if (pid.toLowerCase().includes("engagement")) return "engagement";
  if (pid.toLowerCase().includes("pace")) return "conversation";
  return "other";
}

const CATEGORY_LABELS: Record<string, string> = {
  "big-five": "Big Five",
  vark: "VARK",
  personality: "Personality",
  conversation: "Conversation",
  engagement: "Engagement",
  other: "Other",
};

function categoryLabelFor(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}
