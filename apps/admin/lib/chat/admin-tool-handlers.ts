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
import { writeBehaviorTarget, writeCallerBehaviorTarget } from "@/lib/agent-tuner/write-target";

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
  // Tuning / behaviour-target writes
  update_behavior_target: "OPERATOR",
  update_playbook_config: "OPERATOR",
  // Caller / playbook / domain meta
  get_caller_detail: "OPERATOR",
  update_caller: "OPERATOR",
  update_playbook_meta: "OPERATOR",
  update_domain: "OPERATOR",
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
      // Tuning / behaviour-target writes
      case "update_behavior_target":
        result = await handleUpdateBehaviorTarget(input);
        break;
      case "update_playbook_config":
        result = await handleUpdatePlaybookConfig(input);
        break;
      // Caller / playbook / domain meta
      case "get_caller_detail":
        result = await handleGetCallerDetail(input);
        break;
      case "update_caller":
        result = await handleUpdateCaller(input);
        break;
      case "update_playbook_meta":
        result = await handleUpdatePlaybookMeta(input);
        break;
      case "update_domain":
        result = await handleUpdateDomain(input);
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

/**
 * Apply a single BehaviorTarget update from the TUNING assistant at either
 * LEARNER or PLAYBOOK scope. Dispatch on the `scope` arg the model passes —
 * which itself comes from the Tuning tab toggle the educator picked.
 *
 * Validation (whitelist + clamp) lives in write-target.ts so the panel routes
 * and this tool cannot drift.
 */
async function handleUpdateBehaviorTarget(input: Record<string, any>) {
  const scope = typeof input.scope === "string" ? input.scope.toUpperCase() : "";
  const parameterId = typeof input.parameter_id === "string" ? input.parameter_id : "";
  const rawValue = input.target_value;

  if (scope !== "LEARNER" && scope !== "PLAYBOOK") {
    return {
      error: "scope is required and must be 'LEARNER' or 'PLAYBOOK'. Read it from the 'Active Tuning Scope' block in your system prompt — do not decide it yourself.",
    };
  }
  if (!parameterId) {
    return { error: "parameter_id is required (use a slug from the catalogue, e.g. BEH-WARMTH)" };
  }
  if (rawValue !== null && typeof rawValue !== "number") {
    return { error: "target_value must be a number in [0, 1] or null to remove the override" };
  }

  if (scope === "LEARNER") {
    const callerId = typeof input.caller_id === "string" ? input.caller_id : "";
    if (!callerId) {
      return {
        error: "caller_id is required when scope=LEARNER. Read it from the active entity context (type: 'caller'). If no caller is in context, ask the educator to navigate to a learner first.",
      };
    }
    console.log(
      `[chat-tools:tuning] update_behavior_target scope=LEARNER caller=${callerId} param=${parameterId} value=${rawValue}`,
    );
    const result = await writeCallerBehaviorTarget(callerId, parameterId, rawValue as number | null, {
      source: "TUNING_CHAT",
    });
    if (!result.ok) {
      if (result.reason === "caller_not_found") return { error: `Caller ${callerId} not found.` };
      if (result.reason === "no_identity") {
        return { error: "This caller has no identity yet — targets can't attach. Ask the educator to complete enrollment first." };
      }
      return {
        error: `Parameter "${parameterId}" is not an adjustable BEHAVIOR parameter. Pick one from the catalogue in your system prompt — do not invent IDs.`,
      };
    }
    return {
      ok: true,
      scope: "LEARNER",
      caller_id: callerId,
      parameter_id: result.parameterId,
      action: result.action,
      new_value: result.value,
      message:
        result.action === "noop"
          ? `No learner-scope override existed for ${parameterId}; nothing to remove. The course-level value still applies.`
          : result.action === "removed"
            ? `Removed the learner-scope override for ${parameterId} on this caller. The course-level value now applies. Existing sessions take effect at the next call.`
            : `Set ${parameterId} to ${result.value} for this learner only. Tuning saved — applies at the next call. In-flight sessions are not affected.`,
    };
  }

  // scope === "PLAYBOOK"
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) {
    return {
      error: "playbook_id is required when scope=PLAYBOOK. Read it from the active entity context (type: 'playbook'). If no course is in context, ask the educator to navigate to a course first.",
    };
  }
  console.log(
    `[chat-tools:tuning] update_behavior_target scope=PLAYBOOK playbook=${playbookId} param=${parameterId} value=${rawValue}`,
  );
  const result = await writeBehaviorTarget(playbookId, parameterId, rawValue as number | null, {
    source: "TUNING_CHAT",
  });
  if (!result.ok) {
    if (result.reason === "playbook_not_found") {
      return { error: `Playbook ${playbookId} not found.` };
    }
    return {
      error: `Parameter "${parameterId}" is not an adjustable BEHAVIOR parameter. Pick one from the catalogue in your system prompt — do not invent IDs.`,
    };
  }
  return {
    ok: true,
    scope: "PLAYBOOK",
    playbook_id: playbookId,
    parameter_id: result.parameterId,
    action: result.action,
    new_value: result.value,
    message:
      result.action === "noop"
        ? `No PLAYBOOK-scope override existed for ${parameterId}; nothing to remove. The system default still applies.`
        : result.action === "removed"
          ? `Removed the course-level override for ${parameterId}. Tuning saved. Existing learners need re-prompting to pick up the change.`
          : `Set ${parameterId} to ${result.value} on this course. Tuning saved — applies on every learner's next call. Existing in-flight calls are not affected.`,
  };
}

/**
 * Update non-behaviour playbook settings from the TUNING assistant. Testing-mode
 * scope: the AI may set any key in PlaybookConfig — no server-side whitelist.
 * Other keys in the existing config are preserved (merge, not replace).
 * Config-only updates are allowed on PUBLISHED playbooks per
 * /api/playbooks/[playbookId]/route.ts (isConfigOnlyUpdate exemption).
 */
async function handleUpdatePlaybookConfig(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) {
    return { error: "playbook_id is required (read from entity context with type: 'playbook')" };
  }

  const updates = input.config_updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length === 0) {
    return {
      error: "config_updates must be a non-empty object of PlaybookConfig keys to merge (e.g. { sessionCount: 5, durationMins: 6 }).",
    };
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, config: true, status: true },
  });
  if (!playbook) {
    return { error: `Playbook ${playbookId} not found.` };
  }

  const currentConfig = (playbook.config as Record<string, unknown> | null) || {};
  const mergedConfig = { ...currentConfig, ...updates };

  await prisma.playbook.update({
    where: { id: playbookId },
    data: { config: mergedConfig, updatedAt: new Date() },
  });

  const fields = Object.keys(updates);
  console.log(`[admin-tools] Updated playbook "${playbook.name}" config. Fields: ${fields.join(", ")}. Reason: ${input.reason || "(not given)"}`);

  return {
    ok: true,
    playbook_id: playbookId,
    playbook_name: playbook.name,
    updated_fields: updates,
    message: `Updated ${fields.join(", ")} on ${playbook.name}. Tuning saved. Existing learners need re-prompting to pick up the change on calls already in flight.`,
  };
}

// ── Read access ──────────────────────────────────────────────────

async function handleGetCallerDetail(input: Record<string, any>) {
  const callerId = typeof input.caller_id === "string" ? input.caller_id : "";
  if (!callerId) return { error: "caller_id is required" };

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      externalId: true,
      role: true,
      createdAt: true,
      archivedAt: true,
      domainId: true,
      cohortGroupId: true,
      domain: { select: { id: true, slug: true, name: true } },
      cohortGroup: { select: { id: true, name: true } },
    },
  });
  if (!caller) return { error: `Caller ${callerId} not found.` };

  const [callCount, memoryCount, observationCount, lastCall, enrollments, personalityProfile, scoreSummary] = await Promise.all([
    prisma.call.count({ where: { callerId } }),
    prisma.callerMemory.count({ where: { callerId, supersededById: null } }),
    prisma.personalityObservation.count({ where: { callerId } }),
    prisma.call.findFirst({
      where: { callerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, endedAt: true, callSequence: true, playbookId: true },
    }),
    prisma.callerPlaybook.findMany({
      where: { callerId },
      select: {
        id: true,
        status: true,
        isDefault: true,
        enrolledAt: true,
        playbook: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.callerPersonalityProfile.findUnique({
      where: { callerId },
      select: { parameterValues: true, lastUpdatedAt: true },
    }),
    prisma.callScore.groupBy({
      by: ["parameterId"],
      where: { call: { callerId } },
      _avg: { score: true },
      _count: { _all: true },
    }).catch(() => [] as any),
  ]);

  return {
    caller,
    counts: { calls: callCount, memories: memoryCount, observations: observationCount },
    lastCall,
    enrollments,
    personalityProfile,
    scoreSummary: Array.isArray(scoreSummary)
      ? scoreSummary.map((s: any) => ({ parameterId: s.parameterId, avgScore: s._avg?.score ?? null, count: s._count?._all ?? 0 }))
      : [],
  };
}

// ── Write access — caller / playbook / domain meta ───────────────

async function handleUpdateCaller(input: Record<string, any>) {
  const callerId = typeof input.caller_id === "string" ? input.caller_id : "";
  if (!callerId) return { error: "caller_id is required" };

  const existing = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!existing) return { error: `Caller ${callerId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") data.name = input.name;
  if (input.email === null || typeof input.email === "string") data.email = input.email;
  if (input.phone === null || typeof input.phone === "string") data.phone = input.phone;
  if (input.externalId === null || typeof input.externalId === "string") data.externalId = input.externalId;
  if (typeof input.role === "string") data.role = input.role;
  if (input.domainId === null || typeof input.domainId === "string") data.domainId = input.domainId;
  if (input.cohortGroupId === null || typeof input.cohortGroupId === "string") data.cohortGroupId = input.cohortGroupId;
  if (input.archive === true) data.archivedAt = new Date();
  if (input.archive === false) data.archivedAt = null;

  if (Object.keys(data).length === 0) {
    return { error: "No update fields provided. Pass at least one of: name, email, phone, externalId, role, domainId, cohortGroupId, archive." };
  }

  const updated = await prisma.caller.update({
    where: { id: callerId },
    data,
    select: { id: true, name: true, email: true, phone: true, role: true, archivedAt: true, domainId: true, cohortGroupId: true },
  });

  console.log(`[admin-tools] Updated caller "${existing.name}" → "${updated.name}". Fields: ${Object.keys(data).join(", ")}. Reason: ${input.reason || "(not given)"}`);

  return {
    ok: true,
    caller_id: callerId,
    updated_fields: data,
    new_state: updated,
    message: `Updated ${Object.keys(data).join(", ")} on ${updated.name}.`,
  };
}

async function handleUpdatePlaybookMeta(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) return { error: "playbook_id is required" };

  const existing = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true },
  });
  if (!existing) return { error: `Playbook ${playbookId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") data.name = input.name;
  if (typeof input.description === "string") data.description = input.description;
  if (typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)) data.sortOrder = input.sortOrder;

  if (Object.keys(data).length === 0) {
    return { error: "No update fields provided. Pass at least one of: name, description, sortOrder." };
  }

  const updated = await prisma.playbook.update({
    where: { id: playbookId },
    data,
    select: { id: true, name: true, description: true, sortOrder: true, status: true },
  });

  console.log(`[admin-tools] Updated playbook "${existing.name}" → "${updated.name}". Fields: ${Object.keys(data).join(", ")}. Reason: ${input.reason || "(not given)"}`);

  return {
    ok: true,
    playbook_id: playbookId,
    updated_fields: data,
    new_state: updated,
    message: `Updated ${Object.keys(data).join(", ")} on ${updated.name}.`,
  };
}

async function handleUpdateDomain(input: Record<string, any>) {
  const domainId = typeof input.domain_id === "string" ? input.domain_id : "";
  if (!domainId) return { error: "domain_id is required" };

  const existing = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true, config: true },
  });
  if (!existing) return { error: `Domain ${domainId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") data.name = input.name;
  if (typeof input.slug === "string") data.slug = input.slug;
  if (typeof input.description === "string") data.description = input.description;
  if (typeof input.isActive === "boolean") data.isActive = input.isActive;
  if (input.config_updates && typeof input.config_updates === "object" && !Array.isArray(input.config_updates)) {
    const currentConfig = (existing.config as Record<string, unknown> | null) || {};
    data.config = { ...currentConfig, ...input.config_updates };
  }

  if (Object.keys(data).length === 0) {
    return { error: "No update fields provided. Pass at least one of: name, slug, description, isActive, config_updates." };
  }

  const updated = await prisma.domain.update({
    where: { id: domainId },
    data,
    select: { id: true, name: true, slug: true, description: true, isActive: true, config: true },
  });

  console.log(`[admin-tools] Updated domain "${existing.name}" → "${updated.name}". Fields: ${Object.keys(data).join(", ")}. Reason: ${input.reason || "(not given)"}`);

  return {
    ok: true,
    domain_id: domainId,
    updated_fields: data,
    new_state: updated,
    message: `Updated ${Object.keys(data).join(", ")} on ${updated.name}.`,
  };
}
