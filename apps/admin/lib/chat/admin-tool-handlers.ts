/**
 * Admin Tool Handlers
 *
 * Executes tools called by the Cmd+K AI assistant.
 * Each handler receives parsed input from the AI and returns JSON results.
 * Each tool has a minimum role — enforced before execution.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import { startCurriculumGeneration } from "@/lib/jobs/curriculum-runner";
import { runIniChecks } from "@/lib/system-ini";

const MAX_RESULT_LENGTH = 3000;

// Minimum role required per tool (matches REST API auth levels)
const TOOL_MIN_ROLE: Record<string, UserRole> = {
  query_specs: "OPERATOR",
  get_spec_config: "OPERATOR",
  update_spec_config: "OPERATOR", // matches PATCH /api/analysis-specs/[specId]
  query_callers: "OPERATOR",
  get_domain_info: "OPERATOR",
  // Curriculum building tools
  create_subject_with_source: "OPERATOR",
  add_content_assertions: "OPERATOR",
  link_subject_to_domain: "OPERATOR",
  generate_curriculum: "OPERATOR",
  // System diagnostics
  system_ini_check: "SUPERADMIN",
};

// Role hierarchy for comparison (mirrors lib/permissions.ts)
const ROLE_LEVEL: Record<string, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  EDUCATOR: 3,
  SUPER_TESTER: 2,
  TESTER: 1,
  STUDENT: 1,
  VIEWER: 1,
  DEMO: 0,
};

/** Truncate JSON to fit in context window */
function truncateResult(obj: any): string {
  const json = JSON.stringify(obj, null, 2);
  if (json.length <= MAX_RESULT_LENGTH) return json;
  return json.slice(0, MAX_RESULT_LENGTH) + "\n... (truncated)";
}

/**
 * Dispatch a tool call to the appropriate handler.
 * Enforces per-tool RBAC before execution.
 */
export async function executeAdminTool(
  name: string,
  input: Record<string, any>,
  userRole?: UserRole,
  context?: { userId?: string },
): Promise<string> {
  try {
    // Per-tool RBAC check
    const minRole = TOOL_MIN_ROLE[name];
    if (minRole && userRole) {
      const userLevel = ROLE_LEVEL[userRole] ?? 0;
      const requiredLevel = ROLE_LEVEL[minRole] ?? 0;
      if (userLevel < requiredLevel) {
        return JSON.stringify({
          error: `Insufficient permissions. Tool "${name}" requires ${minRole} role.`,
        });
      }
    }

    let result: any;
    switch (name) {
      case "query_specs":
        result = await handleQuerySpecs(input);
        break;
      case "get_spec_config":
        result = await handleGetSpecConfig(input);
        break;
      case "update_spec_config":
        result = await handleUpdateSpecConfig(input);
        break;
      case "query_callers":
        result = await handleQueryCallers(input);
        break;
      case "get_domain_info":
        result = await handleGetDomainInfo(input);
        break;
      // Curriculum building tools
      case "create_subject_with_source":
        result = await handleCreateSubjectWithSource(input);
        break;
      case "add_content_assertions":
        result = await handleAddContentAssertions(input);
        break;
      case "link_subject_to_domain":
        result = await handleLinkSubjectToDomain(input);
        break;
      case "generate_curriculum":
        if (!context?.userId) {
          return JSON.stringify({ error: "userId is required for curriculum generation" });
        }
        result = await handleGenerateCurriculum(input, context.userId);
        break;
      // System diagnostics
      case "system_ini_check":
        result = await runIniChecks();
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    return truncateResult(result);
  } catch (error) {
    console.error(`[admin-tools] Error executing ${name}:`, error);
    return JSON.stringify({
      error: `Tool execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}

// ============================================================
// Tool Handlers
// ============================================================

async function handleQuerySpecs(input: Record<string, any>) {
  const where: any = {};

  if (input.is_active !== false) {
    where.isActive = true;
  }
  if (input.name) {
    where.name = { contains: input.name, mode: "insensitive" };
  }
  if (input.spec_role) {
    where.specRole = input.spec_role;
  }
  if (input.slug) {
    where.slug = { contains: input.slug, mode: "insensitive" };
  }

  const limit = Math.min(input.limit || 10, 25);

  const specs = await prisma.analysisSpec.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      specRole: true,
      outputType: true,
      scope: true,
      extendsAgent: true,
      isActive: true,
      description: true,
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  return {
    count: specs.length,
    specs: specs.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      specRole: s.specRole,
      outputType: s.outputType,
      scope: s.scope,
      extendsAgent: s.extendsAgent,
      description: s.description?.slice(0, 150),
    })),
  };
}

async function handleGetSpecConfig(input: Record<string, any>) {
  const spec = await prisma.analysisSpec.findUnique({
    where: { id: input.spec_id },
    select: {
      id: true,
      name: true,
      slug: true,
      specRole: true,
      extendsAgent: true,
      config: true,
      description: true,
      isActive: true,
    },
  });

  if (!spec) {
    return { error: `Spec not found: ${input.spec_id}` };
  }

  return {
    id: spec.id,
    name: spec.name,
    slug: spec.slug,
    specRole: spec.specRole,
    extendsAgent: spec.extendsAgent,
    isActive: spec.isActive,
    description: spec.description,
    config: spec.config,
  };
}

async function handleUpdateSpecConfig(input: Record<string, any>) {
  const { spec_id, config_updates, reason } = input;

  // Load current spec
  const spec = await prisma.analysisSpec.findUnique({
    where: { id: spec_id },
    select: { id: true, name: true, config: true, isLocked: true },
  });

  if (!spec) {
    return { error: `Spec not found: ${spec_id}` };
  }

  if (spec.isLocked) {
    return { error: `Spec "${spec.name}" is locked. Unlock it first before making changes.` };
  }

  // Merge: existing config + updates (updates win on conflicts)
  const currentConfig = (spec.config as Record<string, any>) || {};
  const mergedConfig = { ...currentConfig, ...config_updates };

  // Apply the update
  await prisma.analysisSpec.update({
    where: { id: spec_id },
    data: { config: mergedConfig },
  });

  // Log the change
  console.log(`[admin-tools] Updated spec "${spec.name}" config. Reason: ${reason}. Fields changed: ${Object.keys(config_updates).join(", ")}`);

  return {
    ok: true,
    message: `Updated "${spec.name}" config successfully.`,
    fieldsUpdated: Object.keys(config_updates),
    reason,
  };
}

async function handleQueryCallers(input: Record<string, any>) {
  const where: any = {};

  if (input.name) {
    where.name = { contains: input.name, mode: "insensitive" };
  }
  if (input.domain_id) {
    where.domainId = input.domain_id;
  }
  if (input.domain_name) {
    where.domain = { name: { contains: input.domain_name, mode: "insensitive" } };
  }

  const limit = Math.min(input.limit || 10, 25);

  const callers = await prisma.caller.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      domain: { select: { name: true } },
      personality: {
        select: {
          openness: true,
          conscientiousness: true,
          extraversion: true,
          agreeableness: true,
          neuroticism: true,
        },
      },
      _count: { select: { calls: true } },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  return {
    count: callers.length,
    callers: callers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      domain: c.domain?.name || null,
      totalCalls: c._count.calls,
      personality: c.personality
        ? {
            O: c.personality.openness !== null ? Math.round(c.personality.openness * 100) : null,
            C: c.personality.conscientiousness !== null ? Math.round(c.personality.conscientiousness * 100) : null,
            E: c.personality.extraversion !== null ? Math.round(c.personality.extraversion * 100) : null,
            A: c.personality.agreeableness !== null ? Math.round(c.personality.agreeableness * 100) : null,
            N: c.personality.neuroticism !== null ? Math.round(c.personality.neuroticism * 100) : null,
          }
        : null,
    })),
  };
}

async function handleGetDomainInfo(input: Record<string, any>) {
  const where: any = {};
  if (input.domain_id) {
    where.id = input.domain_id;
  } else if (input.domain_name) {
    where.name = { contains: input.domain_name, mode: "insensitive" };
  } else {
    return { error: "Provide either domain_id or domain_name" };
  }

  const domain = await prisma.domain.findFirst({
    where,
    include: {
      playbooks: {
        orderBy: { createdAt: "desc" },
        take: 3,
        include: {
          items: {
            where: { itemType: "SPEC" },
            include: {
              spec: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  specRole: true,
                  config: true,
                  extendsAgent: true,
                },
              },
            },
          },
        },
      },
      _count: { select: { callers: true } },
    },
  });

  if (!domain) {
    return { error: `Domain not found` };
  }

  // Find identity and content specs from the published playbook
  const publishedPlaybook = domain.playbooks.find((p) => p.status === "PUBLISHED") || domain.playbooks[0];
  const specs = publishedPlaybook?.items?.map((i) => i.spec).filter(Boolean) || [];
  const identitySpec = specs.find((s: any) => s?.specRole === "IDENTITY");
  const contentSpec = specs.find((s: any) => s?.specRole === "CONTENT");

  return {
    id: domain.id,
    name: domain.name,
    slug: domain.slug,
    description: domain.description,
    callerCount: domain._count.callers,
    publishedPlaybook: publishedPlaybook
      ? {
          id: publishedPlaybook.id,
          name: publishedPlaybook.name,
          status: publishedPlaybook.status,
          specCount: specs.length,
        }
      : null,
    specs: specs.map((s: any) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      specRole: s.specRole,
      extendsAgent: s.extendsAgent,
    })),
    identitySpecConfig: identitySpec ? (identitySpec as any).config : null,
    contentSpecConfig: contentSpec ? (contentSpec as any).config : null,
  };
}

// ============================================================
// Curriculum Building Handlers
// ============================================================

/** Hash an assertion for deduplication (matches import pipeline) */
function hashAssertion(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase()).digest("hex").substring(0, 16);
}

async function handleCreateSubjectWithSource(input: Record<string, any>) {
  const {
    subject_slug, subject_name, subject_description,
    source_slug, source_name, source_description,
    tags,
  } = input;

  if (!subject_slug || !subject_name) {
    return { error: "subject_slug and subject_name are required" };
  }
  if (!source_slug || !source_name) {
    return { error: "source_slug and source_name are required" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({
        data: {
          slug: subject_slug,
          name: subject_name,
          description: subject_description || null,
          defaultTrustLevel: "AI_ASSISTED",
        },
      });

      const source = await tx.contentSource.create({
        data: {
          slug: source_slug,
          name: source_name,
          description: source_description || `AI-generated content for ${subject_name}`,
          trustLevel: "AI_ASSISTED",
        },
      });

      await tx.subjectSource.create({
        data: {
          subjectId: subject.id,
          sourceId: source.id,
          tags: tags || ["content"],
          sortOrder: 0,
        },
      });

      return { subject, source };
    });

    return {
      ok: true,
      subject_id: result.subject.id,
      subject_name: result.subject.name,
      subject_slug: result.subject.slug,
      source_id: result.source.id,
      source_name: result.source.name,
      source_slug: result.source.slug,
      message: `Created subject "${subject_name}" with source "${source_name}" attached.`,
    };
  } catch (error: any) {
    if (error.code === "P2002") {
      return { error: "A subject or source with that slug already exists. Try a different slug." };
    }
    throw error;
  }
}

async function handleAddContentAssertions(input: Record<string, any>) {
  const { source_id, assertions } = input;

  if (!source_id) return { error: "source_id is required" };
  if (!assertions || !Array.isArray(assertions) || assertions.length === 0) {
    return { error: "assertions array is required and must not be empty" };
  }

  // Verify source exists
  const source = await prisma.contentSource.findUnique({
    where: { id: source_id },
    select: { id: true, name: true },
  });
  if (!source) return { error: `Source not found: ${source_id}` };

  // Cap at 50 assertions per call
  const capped = assertions.slice(0, 50);

  // Check existing hashes for dedup
  const existingHashes = new Set(
    (await prisma.contentAssertion.findMany({
      where: { sourceId: source_id },
      select: { contentHash: true },
    })).map((a) => a.contentHash).filter(Boolean)
  );

  const toCreate = [];
  let duplicatesSkipped = 0;

  for (const a of capped) {
    if (!a.assertion || !a.category) continue;
    const hash = hashAssertion(a.assertion);
    if (existingHashes.has(hash)) {
      duplicatesSkipped++;
      continue;
    }
    existingHashes.add(hash); // prevent intra-batch dupes
    toCreate.push({
      sourceId: source_id,
      assertion: a.assertion,
      category: a.category,
      chapter: a.chapter || null,
      section: a.section || null,
      tags: a.tags || [],
      examRelevance: a.exam_relevance ?? null,
      contentHash: hash,
      createdBy: "system:admin-ai",
    });
  }

  if (toCreate.length > 0) {
    await prisma.contentAssertion.createMany({ data: toCreate });
  }

  return {
    ok: true,
    source_id,
    source_name: source.name,
    created: toCreate.length,
    duplicates_skipped: duplicatesSkipped,
    total_submitted: capped.length,
    message: `Added ${toCreate.length} assertions to "${source.name}"${duplicatesSkipped > 0 ? ` (${duplicatesSkipped} duplicates skipped)` : ""}.`,
  };
}

async function handleLinkSubjectToDomain(input: Record<string, any>) {
  const { subject_id, domain_id } = input;
  if (!subject_id) return { error: "subject_id is required" };
  if (!domain_id) return { error: "domain_id is required" };

  try {
    const link = await prisma.subjectDomain.create({
      data: { subjectId: subject_id, domainId: domain_id },
      include: {
        domain: { select: { name: true } },
        subject: { select: { name: true } },
      },
    });

    return {
      ok: true,
      message: `Linked subject "${link.subject.name}" to domain "${link.domain.name}".`,
      subject_id,
      domain_id,
    };
  } catch (error: any) {
    if (error.code === "P2002") {
      return { ok: true, message: "This subject is already linked to this domain.", subject_id, domain_id };
    }
    if (error.code === "P2003") {
      return { error: "Subject or domain not found. Check the IDs." };
    }
    throw error;
  }
}

async function handleGenerateCurriculum(input: Record<string, any>, userId: string) {
  const { subject_id } = input;
  if (!subject_id) return { error: "subject_id is required" };

  const subject = await prisma.subject.findUnique({
    where: { id: subject_id },
    select: { id: true, name: true },
  });
  if (!subject) return { error: `Subject not found: ${subject_id}` };

  // Validate preconditions
  const sourceCount = await prisma.subjectSource.count({ where: { subjectId: subject_id } });
  if (sourceCount === 0) {
    return { error: "No sources attached. Use create_subject_with_source first." };
  }

  const assertionCount = await prisma.contentAssertion.count({
    where: { source: { subjects: { some: { subjectId: subject_id } } } },
  });
  if (assertionCount === 0) {
    return { error: "No assertions found. Use add_content_assertions first." };
  }

  const taskId = await startCurriculumGeneration(subject_id, subject.name, userId);

  // #317 follow-up — bug #3: previously this returned `ok: true` with a
  // happy "started" message. The chat AI read it as success and could
  // proceed to mark_complete even though the background task might
  // subsequently TIMEOUT. Now: signal status="pending" + persisted=false
  // explicitly + spell out the consumer's obligation to verify the
  // Curriculum exists before declaring success.
  return {
    ok: true,
    status: "pending",
    persisted: false,
    task_id: taskId,
    subject_name: subject.name,
    assertion_count: assertionCount,
    message:
      `Curriculum generation STARTED (not complete) for "${subject.name}" (${assertionCount} assertions). ` +
      `Task ID: ${taskId}. This kicks off a background AI call that may TIMEOUT or fail silently. ` +
      `Do NOT call mark_complete or claim the course is created based on this response. ` +
      `Persistence to DB only happens via create_course / curriculum-commit endpoints — verify Playbook + Curriculum exist in the DB before declaring success.`,
  };
}
