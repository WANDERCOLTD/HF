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
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateAnalysisSpecConfig } from "@/lib/analysis-spec/update-analysis-spec-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import { buildPendingChangePayload } from "@/lib/chat/pending-change-payload";
import { bumpCallerComposeTimestamp, bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import {
  resolvePlaybookIdForCurriculum,
  resolvePlaybookIdsForContentSource,
} from "@/lib/curriculum/resolve-playbook-for-curriculum";
import { ensurePrimaryPlaybookLink } from "@/lib/curriculum/ensure-primary-playbook-link";
import { updateDraft, findById as findIntakeSpecById } from "@/lib/intake/spec-store";
import { projectBodyFromEditable } from "@/lib/intake/crawcus-serde";
import { parse as parseSpecSource, SpecParseError } from "@tallyseal/spec-emitter";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { cascadeableKeys, LOCKED_KEYS, SECRET_KEYS } from "@/lib/voice/config";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getVoiceProvider } from "@/lib/voice/provider-factory";

const MAX_RESULT_LENGTH = 3000;

/**
 * #873 follow-up — shared suffix for any tool message that emits a
 * pendingChange payload. Reframes the AI's status update from "Applied"
 * (which sounds final to the user) to "Proposed" (which matches what
 * the tray actually does: queues for the user's explicit recompose).
 *
 * Writes themselves DO commit immediately at the helper layer (lazy
 * recompose via isPromptStale picks them up on next caller touchpoint).
 * The "proposed" wording is about RECOMPOSE, not WRITE.
 */
const TRAY_PROPOSED_SUFFIX =
  "Proposed — review in the pending changes tray (bottom-right) and click **Save & apply** to recompose.";

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
  // Curriculum-side edits
  update_curriculum_module: "OPERATOR",
  update_assertion_lo_link: "OPERATOR",
  // Goal lifecycle
  confirm_goal: "OPERATOR",
  dismiss_goal: "OPERATOR",
  // Read parity (#852 follow-up)
  get_playbook_config: "OPERATOR",
  list_behavior_targets: "OPERATOR",
  list_curriculum_modules: "OPERATOR",
  list_goals_for_caller: "OPERATOR",
  // State recovery / direct edits
  recompose_caller_prompt: "OPERATOR",
  update_learning_objective: "OPERATOR",
  update_curriculum_metadata: "OPERATOR",
  // Roadmap stubs (NOT YET AVAILABLE — handleNotYetAvailable). Gating
  // them at OPERATOR keeps STUDENT/VIEWER on the same RBAC bar as the
  // real tools they'll eventually replace, so promoting a stub later
  // doesn't change the auth posture.
  list_caller_memories: "OPERATOR",
  create_goal: "OPERATOR",
  rename_subject: "OPERATOR",
  replace_lesson_plan: "OPERATOR",
  add_curriculum_module: "OPERATOR",
  reset_caller: "OPERATOR",
  // System diagnostics
  system_ini_check: "SUPERADMIN",
  // #1225 Slice B — last-7-days landings
  swap_primary_curriculum: "OPERATOR",
  attach_linked_curriculum: "OPERATOR",
  detach_linked_curriculum: "OPERATOR",
  update_intake_spec_draft: "OPERATOR",
  get_voice_config: "OPERATOR",
  update_voice_config: "OPERATOR",
};

/** Names of every roadmap-stub tool — kept centralised so the
 *  dispatch + tests can refer to one source. To promote a tool, remove
 *  it from this set AND from the stub-handling switch case AND wire its
 *  real handler. */
const NOT_YET_AVAILABLE_TOOLS = new Set<string>([
  "list_caller_memories",
  "create_goal",
  "rename_subject",
  "replace_lesson_plan",
  "add_curriculum_module",
  "reset_caller",
]);

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
      // Curriculum-side edits (Story 8 #834 follow-up — exposes the same
      // stale-stamping writers from app/api/curricula/* through Cmd+K)
      case "update_curriculum_module":
        result = await handleUpdateCurriculumModule(input);
        break;
      case "update_assertion_lo_link":
        result = await handleUpdateAssertionLoLink(input);
        break;
      // Goal lifecycle (Story 6 #830 follow-up)
      case "confirm_goal":
        result = await handleConfirmGoal(input);
        break;
      case "dismiss_goal":
        result = await handleDismissGoal(input);
        break;
      // Read parity (#852 follow-up)
      case "get_playbook_config":
        result = await handleGetPlaybookConfig(input);
        break;
      case "list_behavior_targets":
        result = await handleListBehaviorTargets(input);
        break;
      case "list_curriculum_modules":
        result = await handleListCurriculumModules(input);
        break;
      case "list_goals_for_caller":
        result = await handleListGoalsForCaller(input);
        break;
      // State recovery + direct edits
      case "recompose_caller_prompt":
        result = await handleRecomposeCallerPrompt(input);
        break;
      case "update_learning_objective":
        result = await handleUpdateLearningObjective(input);
        break;
      case "update_curriculum_metadata":
        result = await handleUpdateCurriculumMetadata(input);
        break;
      // System diagnostics
      case "system_ini_check":
        result = await runIniChecks();
        break;
      // #1225 Slice B — last-7-days landings
      case "swap_primary_curriculum":
        result = await handleSwapPrimaryCurriculum(input);
        break;
      case "attach_linked_curriculum":
        result = await handleAttachLinkedCurriculum(input);
        break;
      case "detach_linked_curriculum":
        result = await handleDetachLinkedCurriculum(input);
        break;
      case "update_intake_spec_draft":
        result = await handleUpdateIntakeSpecDraft(input);
        break;
      case "get_voice_config":
        result = await handleGetVoiceConfig(input);
        break;
      case "update_voice_config":
        result = await handleUpdateVoiceConfig(input);
        break;
      default:
        if (NOT_YET_AVAILABLE_TOOLS.has(name)) {
          result = handleNotYetAvailable(name);
        } else {
          result = { error: `Unknown tool: ${name}` };
        }
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
  const { spec_id, config_updates, reason, domain_id } = input;

  // Load current spec — also fetch config for the #873 pendingChange diff
  const spec = await prisma.analysisSpec.findUnique({
    where: { id: spec_id },
    select: { id: true, name: true, isLocked: true, config: true },
  });

  if (!spec) {
    return { error: `Spec not found: ${spec_id}` };
  }

  if (spec.isLocked) {
    return { error: `Spec "${spec.name}" is locked. Unlock it first before making changes.` };
  }

  // #829 — central helper. Merge existing config + updates (updates win
  // on conflicts), then route the bump by the spec's scope:
  //   SYSTEM (e.g. INIT-001) → SystemSetting "compose_inputs_updated_at"
  //   DOMAIN → Domain.composeInputsUpdatedAt (caller can pass domain_id)
  //   CALLER → no-op
  const prevSpecConfig = (spec.config as Record<string, unknown>) ?? {};
  const specResult = await updateAnalysisSpecConfig(
    spec_id,
    (current) => {
      const currentConfig = (current.config as Record<string, any>) ?? {};
      const mergedConfig = { ...currentConfig, ...config_updates };
      return { ...current, config: mergedConfig };
    },
    {
      domainId: domain_id,
      reason: `Cmd+K update_spec_config: ${reason ?? "(no reason)"}`,
    },
  );

  const fieldsUpdated = Object.keys(config_updates);
  console.log(`[admin-tools] Updated spec "${spec.name}" config. Reason: ${reason}. Fields changed: ${fieldsUpdated.join(", ")}`);

  // #873 — emit pendingChange when the write actually bumped timestamps.
  // Spec writes route bump to SYSTEM or DOMAIN; map that to tray scope.
  const pendingChange =
    specResult.timestampBumped && fieldsUpdated.length > 0
      ? buildPendingChangePayload({
          scope: specResult.bumpTarget === "domain" ? "domain" : "system",
          scopeId: specResult.bumpTarget === "domain" ? (domain_id ?? null) : null,
          scopeLabel: `Spec ${spec.name}`,
          key: fieldsUpdated[0],
          label: fieldsUpdated[0],
          beforeValue: prevSpecConfig[fieldsUpdated[0]],
          afterValue: config_updates[fieldsUpdated[0]],
        })
      : undefined;

  return {
    ok: true,
    message: pendingChange
      ? `Updated "${spec.name}" config. ${TRAY_PROPOSED_SUFFIX}`
      : `Updated "${spec.name}" config successfully.`,
    fieldsUpdated,
    reason,
    ...(pendingChange ? { pendingChange } : {}),
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
    // #911 — look up the friendly caller name once so the tray entry's
    // scopeLabel reads `Learner <name>` instead of a generic "Learner
    // override". Cheap single-row fetch; if it fails for any reason we
    // fall back to the caller id prefix so the label is never blank.
    const callerRow = await prisma.caller
      .findUnique({ where: { id: callerId }, select: { name: true } })
      .catch(() => null);
    const callerName = callerRow?.name?.trim() || callerId.slice(0, 8);

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
    // #873 follow-up — emit pendingChange so the tray surfaces the AI
    // edit with `aiSuggested: true`. LEARNER-scope writes affect one
    // caller; we set scopeId=null so the cohort preview doesn't fetch
    // (the tray hides Toggle 2 when count=0). Toggle 1 ("Also recompose
    // <name>") drives the recompose via the caller-in-context wired
    // from the Tune sidebar in #857.
    const pendingChangeLearner =
      result.action !== "noop"
        ? buildPendingChangePayload({
            scope: "playbook",
            scopeId: null,
            // #911 — honest scope label, parity with the sidebar push.
            scopeLabel: `Learner ${callerName}`,
            key: result.parameterId,
            label: result.parameterId,
            beforeValue: undefined,
            afterValue: result.value,
          })
        : undefined;

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
            ? `Removed the learner-scope override for ${parameterId} on this caller. ${TRAY_PROPOSED_SUFFIX}`
            : `Set ${parameterId} to ${result.value} for this learner only. ${TRAY_PROPOSED_SUFFIX}`,
      ...(pendingChangeLearner ? { pendingChange: pendingChangeLearner } : {}),
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
  // #911 — look up the friendly playbook name so the tray reads
  // `Course <name>`. Same cheap-lookup pattern as the LEARNER branch above.
  const playbookRow = await prisma.playbook
    .findUnique({ where: { id: playbookId }, select: { name: true } })
    .catch(() => null);
  const playbookName = playbookRow?.name?.trim() || playbookId.slice(0, 8);

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
  // #873 follow-up — emit pendingChange. PLAYBOOK-scope writes affect
  // every active learner on this course; the tray's preview will fetch
  // the cohort count. Toggle 2 stays locked OFF (aiSuggested + the A5
  // defence-in-depth from #856). Toggle 1 + the educator's explicit
  // override remain the path to cohort fanout.
  const pendingChangePlaybook =
    result.action !== "noop"
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: playbookId,
          // #911 — honest scope label, parity with the sidebar push.
          scopeLabel: `Course ${playbookName}`,
          key: result.parameterId,
          label: result.parameterId,
          beforeValue: undefined,
          afterValue: result.value,
        })
      : undefined;

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
          ? `Removed the course-level override for ${parameterId}. ${TRAY_PROPOSED_SUFFIX}`
          : `Set ${parameterId} to ${result.value} on this course. ${TRAY_PROPOSED_SUFFIX}`,
    ...(pendingChangePlaybook ? { pendingChange: pendingChangePlaybook } : {}),
  };
}

/**
 * #599 Slice 1 — AI-surface validation/clamp for the `priorCallRecap` block
 * on inbound `update_playbook_config` writes. Two defensive checks:
 *   1. `depth` must be one of `"minimal" | "standard" | "rich"`. Unknown
 *      values (`"Maximum"`, numbers, `null`) are rejected with a clear
 *      message so the model can self-correct.
 *   2. `dailyCap` is clamped to `[0, PRIOR_CALL_RECAP_DAILY_CAP_MAX]` and
 *      coerced to an integer. A `console.warn` fires when clamping kicks
 *      in so operators can spot model hallucinations in the logs.
 *
 * Returns either `{ normalised }` (the same shape as the input, with
 * `priorCallRecap` cleaned) or `{ error }` with a human-readable message
 * suitable for echoing back to the model.
 */
const VALID_RECAP_DEPTHS = new Set(["minimal", "standard", "rich"]);

/** Exported for unit tests. Returned shape is the same one the handler echoes back to the model. */
export function validatePriorCallRecapUpdates(
  updates: Record<string, unknown>,
): { normalised: Record<string, unknown>; error?: undefined } | { normalised?: undefined; error: string } {
  if (!Object.prototype.hasOwnProperty.call(updates, "priorCallRecap")) {
    return { normalised: updates };
  }
  const raw = updates.priorCallRecap;
  // Allow explicit `null` to clear the field — merge target picks it up.
  if (raw === null) {
    return { normalised: updates };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error:
        "priorCallRecap must be an object of shape { enabled: boolean; depth?: 'minimal'|'standard'|'rich'; dailyCap?: number }.",
    };
  }
  const value = raw as Record<string, unknown>;

  const cleaned: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(value, "enabled")) {
    if (typeof value.enabled !== "boolean") {
      return { error: "priorCallRecap.enabled must be a boolean." };
    }
    cleaned.enabled = value.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(value, "depth")) {
    if (typeof value.depth !== "string" || !VALID_RECAP_DEPTHS.has(value.depth)) {
      return {
        error: `priorCallRecap.depth must be one of 'minimal', 'standard', 'rich' — got ${JSON.stringify(value.depth)}.`,
      };
    }
    cleaned.depth = value.depth;
  }

  if (Object.prototype.hasOwnProperty.call(value, "dailyCap")) {
    const dailyCap = value.dailyCap;
    if (typeof dailyCap !== "number" || !Number.isFinite(dailyCap)) {
      return { error: "priorCallRecap.dailyCap must be a finite number." };
    }
    const PRIOR_CALL_RECAP_DAILY_CAP_MAX = 500;
    const clamped = Math.min(Math.max(0, Math.floor(dailyCap)), PRIOR_CALL_RECAP_DAILY_CAP_MAX);
    if (clamped !== dailyCap) {
      console.warn(
        `[admin-tool] update_playbook_config: priorCallRecap.dailyCap clamped ${dailyCap} → ${clamped} (limit: ${PRIOR_CALL_RECAP_DAILY_CAP_MAX}).`,
      );
    }
    cleaned.dailyCap = clamped;
  }

  return { normalised: { ...updates, priorCallRecap: cleaned } };
}

/**
 * Update non-behaviour playbook settings from the TUNING assistant. Testing-mode
 * scope: the AI may set any key in PlaybookConfig — no server-side whitelist.
 * Other keys in the existing config are preserved (merge, not replace).
 * Config-only updates are allowed on PUBLISHED playbooks per
 * /api/playbooks/[playbookId]/route.ts (isConfigOnlyUpdate exemption).
 *
 * #599 Slice 1 — AI-surface safety rails for `priorCallRecap`:
 *   - `depth` enum validated; unknown values rejected with a clear error.
 *   - `dailyCap` server-side clamped to `[0, 500]` with a console.warn.
 * See `validatePriorCallRecapUpdates` below.
 */
async function handleUpdatePlaybookConfig(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) {
    return { error: "playbook_id is required (read from entity context with type: 'playbook')" };
  }

  const rawUpdates = input.config_updates;
  if (!rawUpdates || typeof rawUpdates !== "object" || Array.isArray(rawUpdates) || Object.keys(rawUpdates).length === 0) {
    return {
      error: "config_updates must be a non-empty object of PlaybookConfig keys to merge (e.g. { sessionCount: 5, durationMins: 6 }).",
    };
  }

  // #599 Slice 1 — validate + clamp priorCallRecap before write so a
  // hallucinated enum or out-of-range number cannot slip through tray review.
  const safety = validatePriorCallRecapUpdates(rawUpdates);
  if (safety.error) {
    return { error: safety.error };
  }
  const updates = safety.normalised as Record<string, unknown>;

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, config: true, status: true },
  });
  if (!playbook) {
    return { error: `Playbook ${playbookId} not found.` };
  }

  // #827 (Story 3) — Cmd+K admin chat tool is the post-creation educator
  // tuning surface; updates here MUST go through the helper so any
  // COMPOSE-affecting change bumps Playbook.composeInputsUpdatedAt and
  // downstream callers' next compose detects stale (#825 staleness check).
  const prevConfig = (playbook.config ?? {}) as Record<string, unknown>;
  const result = await updatePlaybookConfig(
    playbookId,
    (cfg) => ({ ...(cfg as Record<string, unknown>), ...updates } as typeof cfg),
    { reason: `admin-tool update_playbook_config: ${input.reason || "(not given)"}` },
  );

  const fields = Object.keys(updates);
  console.log(`[admin-tools] Updated playbook "${playbook.name}" config. Fields: ${fields.join(", ")}. Reason: ${input.reason || "(not given)"}. composeInputsUpdatedAt bumped: ${result.timestampBumped}`);

  // #873 — emit pendingChange payload only when the write actually
  // bumped the timestamp (compose-affecting). One payload per call site;
  // if the AI updates multiple fields at once, pick the first one as the
  // representative (the tray surfaces *that* a change happened — full
  // multi-field diff lives in the chat transcript).
  const pendingChange =
    result.timestampBumped && fields.length > 0
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: playbookId,
          scopeLabel: `Course ${playbook.name}`,
          key: fields[0],
          label: fields[0],
          beforeValue: prevConfig[fields[0]],
          afterValue: updates[fields[0]],
        })
      : undefined;

  return {
    ok: true,
    playbook_id: playbookId,
    playbook_name: playbook.name,
    updated_fields: updates,
    compose_inputs_bumped: result.timestampBumped,
    message: pendingChange
      ? `Updated ${fields.join(", ")} on ${playbook.name}. ${TRAY_PROPOSED_SUFFIX}`
      : `Updated ${fields.join(", ")} on ${playbook.name}. Tuning saved.`,
    ...(pendingChange ? { pendingChange } : {}),
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

  // SAFETY: role + domainId are NOT in the tool schema (admin-tools.ts) so
  // they should never appear in input. Defence-in-depth: even if a future
  // schema change adds them back, or a malformed tool call slips through,
  // ignore them here. Role changes are privilege escalation; domainId
  // changes are cross-tenant moves — both are human-only via the admin UI.
  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") data.name = input.name;
  if (input.email === null || typeof input.email === "string") data.email = input.email;
  if (input.phone === null || typeof input.phone === "string") data.phone = input.phone;
  if (input.externalId === null || typeof input.externalId === "string") data.externalId = input.externalId;
  if (input.cohortGroupId === null || typeof input.cohortGroupId === "string") data.cohortGroupId = input.cohortGroupId;
  if (input.archive === true) data.archivedAt = new Date();
  if (input.archive === false) data.archivedAt = null;
  if (input.role !== undefined || input.domainId !== undefined) {
    console.warn(
      `[admin-tools] update_caller dropped privileged field(s) from AI tool call: ${
        [input.role !== undefined ? "role" : null, input.domainId !== undefined ? "domainId" : null]
          .filter(Boolean)
          .join(", ")
      }. caller_id=${callerId}, reason="${input.reason ?? "(none)"}"`,
    );
  }

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

  // Two write paths. The 4 COMPOSE-affecting onboarding* fields MUST go
  // through `updateDomainConfig` so the timestamp bump fires (Story 4 #828).
  // Everything else (name/slug/description/isActive/config_updates) is non-
  // compose-affecting and stays a direct write.
  const directData: Record<string, unknown> = {};
  if (typeof input.name === "string") directData.name = input.name;
  if (typeof input.slug === "string") directData.slug = input.slug;
  if (typeof input.description === "string") directData.description = input.description;
  if (typeof input.isActive === "boolean") directData.isActive = input.isActive;
  if (input.config_updates && typeof input.config_updates === "object" && !Array.isArray(input.config_updates)) {
    const currentConfig = (existing.config as Record<string, unknown> | null) || {};
    directData.config = { ...currentConfig, ...input.config_updates };
  }

  const composeAffectingPresent =
    input.onboardingFlowPhases !== undefined ||
    input.onboardingDefaultTargets !== undefined ||
    input.onboardingWelcome !== undefined ||
    input.onboardingIdentitySpecId !== undefined;

  if (Object.keys(directData).length === 0 && !composeAffectingPresent) {
    return {
      error:
        "No update fields provided. Pass at least one of: name, slug, description, isActive, config_updates, onboardingFlowPhases, onboardingDefaultTargets, onboardingWelcome, onboardingIdentitySpecId.",
    };
  }

  if (Object.keys(directData).length > 0) {
    // eslint-disable-next-line hf-domain/no-direct-onboarding-write
    await prisma.domain.update({ where: { id: domainId }, data: directData });
  }

  let timestampBumped = false;
  if (composeAffectingPresent) {
    const result = await updateDomainConfig(
      domainId,
      (current) => {
        const next = { ...current };
        if (input.onboardingFlowPhases !== undefined) {
          next.onboardingFlowPhases =
            input.onboardingFlowPhases === null ? null : input.onboardingFlowPhases;
        }
        if (input.onboardingDefaultTargets !== undefined) {
          next.onboardingDefaultTargets =
            input.onboardingDefaultTargets === null ? null : input.onboardingDefaultTargets;
        }
        if (input.onboardingWelcome !== undefined) {
          // Empty string clears the override; non-empty string sets it.
          next.onboardingWelcome =
            input.onboardingWelcome === "" ? null : input.onboardingWelcome;
        }
        if (input.onboardingIdentitySpecId !== undefined) {
          next.onboardingIdentitySpecId =
            input.onboardingIdentitySpecId === "" ? null : input.onboardingIdentitySpecId;
        }
        return next;
      },
      { reason: `Cmd+K update_domain: ${input.reason ?? "(not given)"}` },
    );
    timestampBumped = result.timestampBumped;
  }

  const updated = await prisma.domain.findUnique({
    where: { id: domainId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isActive: true,
      config: true,
      onboardingFlowPhases: true,
      onboardingDefaultTargets: true,
      onboardingWelcome: true,
      onboardingIdentitySpecId: true,
    },
  });

  const allUpdatedKeys = [
    ...Object.keys(directData),
    ...(input.onboardingFlowPhases !== undefined ? ["onboardingFlowPhases"] : []),
    ...(input.onboardingDefaultTargets !== undefined ? ["onboardingDefaultTargets"] : []),
    ...(input.onboardingWelcome !== undefined ? ["onboardingWelcome"] : []),
    ...(input.onboardingIdentitySpecId !== undefined ? ["onboardingIdentitySpecId"] : []),
  ];

  console.log(
    `[admin-tools] Updated domain "${existing.name}". Fields: ${allUpdatedKeys.join(", ")}. composeInputsUpdatedAt bumped: ${timestampBumped}. Reason: ${input.reason || "(not given)"}`,
  );

  // #873 — emit pendingChange when the timestamp bumped (compose-
  // affecting). Use the first compose-affecting field as the
  // representative; full diff lives in the chat transcript.
  const composeAffectingChanged = allUpdatedKeys.find((k) =>
    [
      "onboardingFlowPhases",
      "onboardingDefaultTargets",
      "onboardingWelcome",
      "onboardingIdentitySpecId",
    ].includes(k),
  );
  const pendingChange =
    timestampBumped && composeAffectingChanged
      ? buildPendingChangePayload({
          scope: "domain",
          scopeId: domainId,
          scopeLabel: `Domain ${existing.name}`,
          key: composeAffectingChanged,
          label: composeAffectingChanged,
          beforeValue: undefined,
          afterValue: (input as Record<string, unknown>)[composeAffectingChanged],
        })
      : undefined;

  return {
    ok: true,
    domain_id: domainId,
    updated_fields: allUpdatedKeys,
    compose_inputs_bumped: timestampBumped,
    new_state: updated,
    message:
      `Updated ${allUpdatedKeys.join(", ")} on ${updated?.name ?? domainId}.` +
      (pendingChange ? ` ${TRAY_PROPOSED_SUFFIX}` : ""),
    ...(pendingChange ? { pendingChange } : {}),
  };
}

// ── Curriculum-side edits ────────────────────────────────────────────────
//
// Wrappers around the same write surface app/api/curricula/* uses,
// invoked from Cmd+K. Each handler calls bumpPlaybookComposeTimestamp
// after the write so the staleness check at COMPOSE time picks the
// edit up on the caller's next call (Story 8 #834 contract).

async function handleUpdateCurriculumModule(input: Record<string, any>) {
  const moduleId = typeof input.module_id === "string" ? input.module_id : "";
  if (!moduleId) return { error: "module_id is required" };

  const existing = await prisma.curriculumModule.findUnique({
    where: { id: moduleId },
    select: { id: true, slug: true, title: true, curriculumId: true },
  });
  if (!existing) return { error: `Module ${moduleId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.title === "string") data.title = input.title;
  if (typeof input.description === "string") data.description = input.description;
  if (typeof input.sortOrder === "number") data.sortOrder = input.sortOrder;
  if (typeof input.estimatedDurationMinutes === "number") {
    data.estimatedDurationMinutes = input.estimatedDurationMinutes;
  }
  if (typeof input.masteryThreshold === "number") data.masteryThreshold = input.masteryThreshold;
  if (Array.isArray(input.prerequisites)) data.prerequisites = input.prerequisites;
  if (Array.isArray(input.keyTerms)) data.keyTerms = input.keyTerms;
  if (Array.isArray(input.assessmentCriteria)) data.assessmentCriteria = input.assessmentCriteria;
  if (typeof input.isActive === "boolean") data.isActive = input.isActive;

  if (Object.keys(data).length === 0) {
    return {
      error:
        "No update fields provided. Pass at least one of: title, description, sortOrder, estimatedDurationMinutes, masteryThreshold, prerequisites, keyTerms, assessmentCriteria, isActive.",
    };
  }

  const updated = await prisma.curriculumModule.update({
    where: { id: moduleId },
    data,
    select: {
      id: true, slug: true, title: true, description: true, sortOrder: true,
      isActive: true, estimatedDurationMinutes: true, masteryThreshold: true,
    },
  });

  // #1034 — CC-B fanout: bump every sibling Playbook sharing this Curriculum.
  // The pendingChange payload below is scoped to the representative (first =
  // primary by ordering of resolvePlaybookIdForCurriculum) so tray notifications
  // stay focused, while the staleness bump fans out to every sibling.
  const playbookIds = await resolvePlaybookIdForCurriculum(existing.curriculumId);
  const playbookId: string | null = playbookIds[0] ?? null;
  let timestampBumped = false;
  for (const pbId of playbookIds) {
    await bumpPlaybookComposeTimestamp(pbId);
    timestampBumped = true;
  }

  console.log(
    `[admin-tools] Updated module "${existing.slug}". Fields: ${Object.keys(data).join(", ")}. composeInputsUpdatedAt bumped: ${timestampBumped} (${playbookIds.length} sibling${playbookIds.length === 1 ? "" : "s"}). Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange when the timestamp bumped. AI
  // tool sets aiSuggested=true; the tray's defence-in-depth lock keeps
  // Toggle 2 OFF (no cohort fanout from an AI-driven curriculum edit).
  const fields = Object.keys(data);
  const pendingChange =
    timestampBumped && fields.length > 0
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: playbookId ?? null,
          scopeLabel: `Module ${existing.slug}`,
          key: fields[0],
          label: fields[0],
          beforeValue: undefined,
          afterValue: (data as Record<string, unknown>)[fields[0]],
        })
      : undefined;

  return {
    ok: true,
    module_id: moduleId,
    playbook_id: playbookId,
    updated_fields: fields,
    compose_inputs_bumped: timestampBumped,
    new_state: updated,
    message: `Updated module ${existing.slug}. ${
      pendingChange ? TRAY_PROPOSED_SUFFIX : "No playbook linked yet — no stale bump."
    }`,
    ...(pendingChange ? { pendingChange } : {}),
  };
}

async function handleUpdateAssertionLoLink(input: Record<string, any>) {
  const assertionId = typeof input.assertion_id === "string" ? input.assertion_id : "";
  if (!assertionId) return { error: "assertion_id is required" };

  // null = clear the link; string = set the link to that LO
  const loId: string | null =
    input.learning_objective_id === null || input.learning_objective_id === undefined
      ? null
      : typeof input.learning_objective_id === "string"
        ? input.learning_objective_id
        : null;

  let updated;
  if (loId) {
    const lo = await prisma.learningObjective.findUnique({
      where: { id: loId },
      select: { id: true, ref: true },
    });
    if (!lo) return { error: `LearningObjective ${loId} not found.` };
    updated = await prisma.contentAssertion.update({
      where: { id: assertionId },
      data: {
        learningObjectiveId: lo.id,
        learningOutcomeRef: lo.ref,
        linkConfidence: 1.0,
      },
      select: { id: true, sourceId: true, learningObjectiveId: true, learningOutcomeRef: true, linkConfidence: true },
    });
  } else {
    updated = await prisma.contentAssertion.update({
      where: { id: assertionId },
      data: { learningObjectiveId: null, learningOutcomeRef: null, linkConfidence: null },
      select: { id: true, sourceId: true, learningObjectiveId: true, learningOutcomeRef: true, linkConfidence: true },
    });
  }

  const playbookIds = await resolvePlaybookIdsForContentSource(updated.sourceId);
  for (const pbId of playbookIds) await bumpPlaybookComposeTimestamp(pbId);

  console.log(
    `[admin-tools] ${loId ? "Linked" : "Cleared"} assertion ${assertionId} → LO ${loId ?? "none"}. composeInputsUpdatedAt bumped for ${playbookIds.length} playbooks. Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange. A single source can be tied to
  // multiple playbooks; the tray entry uses the first as the cohort
  // preview context. Known v1 limitation: the message text quotes the
  // accurate "N playbook(s)" count.
  const pendingChange =
    playbookIds.length > 0
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: playbookIds[0],
          scopeLabel: `Assertion link`,
          key: "learningObjectiveId",
          label: loId ? "LO link" : "Cleared LO link",
          beforeValue: undefined,
          afterValue: loId ?? "(none)",
        })
      : undefined;

  return {
    ok: true,
    assertion_id: assertionId,
    new_state: updated,
    playbooks_bumped: playbookIds.length,
    message: loId
      ? `Linked assertion to LO across ${playbookIds.length} playbook(s) on this source. ${TRAY_PROPOSED_SUFFIX}`
      : `Cleared LO link on assertion (${playbookIds.length} playbook(s) on this source). ${TRAY_PROPOSED_SUFFIX}`,
    ...(pendingChange ? { pendingChange } : {}),
  };
}

// ── Goal lifecycle ──────────────────────────────────────────────────────

async function handleConfirmGoal(input: Record<string, any>) {
  const goalId = typeof input.goal_id === "string" ? input.goal_id : "";
  if (!goalId) return { error: "goal_id is required" };

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, name: true, callerId: true, isAssessmentTarget: true, status: true },
  });
  if (!goal) return { error: `Goal ${goalId} not found.` };

  const signal = await prisma.callerAttribute.findFirst({
    where: {
      callerId: goal.callerId,
      key: `goal_completion_signal:${goalId}`,
      scope: "GOAL_EVENT",
      booleanValue: null,
    },
  });

  const updatedGoal = await prisma.goal.update({
    where: { id: goalId },
    data: { status: "COMPLETED", completedAt: new Date(), progress: 1.0 },
  });
  if (signal) {
    await prisma.callerAttribute.update({ where: { id: signal.id }, data: { booleanValue: true } });
  }
  await bumpCallerComposeTimestamp(goal.callerId);

  console.log(
    `[admin-tools] Confirmed goal "${goal.name}" for caller ${goal.callerId}. Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange. Goal lifecycle affects one
  // caller only; scopeId=null hides Toggle 2's cohort preview. Toggle 1
  // (caller-in-context) drives the recompose.
  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: null,
    scopeLabel: `Goal "${goal.name}"`,
    key: "status",
    label: "Status",
    beforeValue: goal.status,
    afterValue: "COMPLETED",
  });

  return {
    ok: true,
    goal_id: goalId,
    caller_id: goal.callerId,
    new_state: { status: updatedGoal.status, completedAt: updatedGoal.completedAt, progress: updatedGoal.progress },
    message: `Goal "${goal.name}" marked COMPLETED. ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}

async function handleDismissGoal(input: Record<string, any>) {
  const goalId = typeof input.goal_id === "string" ? input.goal_id : "";
  if (!goalId) return { error: "goal_id is required" };

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, name: true, callerId: true },
  });
  if (!goal) return { error: `Goal ${goalId} not found.` };

  const signal = await prisma.callerAttribute.findFirst({
    where: {
      callerId: goal.callerId,
      key: `goal_completion_signal:${goalId}`,
      scope: "GOAL_EVENT",
      booleanValue: null,
    },
  });
  if (!signal) {
    return { error: "No pending completion signal to dismiss for this goal." };
  }
  await prisma.callerAttribute.update({ where: { id: signal.id }, data: { booleanValue: false } });
  await bumpCallerComposeTimestamp(goal.callerId);

  console.log(
    `[admin-tools] Dismissed completion signal for goal "${goal.name}" caller ${goal.callerId}. Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange (caller-only, scopeId=null).
  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: null,
    scopeLabel: `Goal "${goal.name}"`,
    key: "completionSignal",
    label: "Completion signal",
    beforeValue: undefined,
    afterValue: "dismissed",
  });

  return {
    ok: true,
    goal_id: goalId,
    caller_id: goal.callerId,
    message: `Completion signal for "${goal.name}" dismissed. ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}

// ── Read parity (#852 follow-up) ────────────────────────────────────────
//
// The four writers added in #852 (update_playbook_config,
// update_behavior_target, update_curriculum_module, confirm/dismiss_goal)
// needed read-side companions so the AI can speak in delta terms
// ('raise warmth from 0.6 to 0.75') rather than blindly overwriting.

async function handleGetPlaybookConfig(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) return { error: "playbook_id is required" };

  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      domainId: true,
      version: true,
      config: true,
      composeInputsUpdatedAt: true,
      domain: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!pb) return { error: `Playbook ${playbookId} not found.` };

  return {
    ok: true,
    playbook: pb,
    compose_stale_hint: pb.composeInputsUpdatedAt
      ? `Last compose-affecting write: ${pb.composeInputsUpdatedAt.toISOString()}. Enrolled callers whose ComposedPrompt.composedAt is older than this will recompose on next call.`
      : "No compose-affecting writes recorded — all enrolled callers' cached prompts are fresh.",
  };
}

async function handleListBehaviorTargets(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  const callerId = typeof input.caller_id === "string" ? input.caller_id : "";

  if (!playbookId && !callerId) {
    return { error: "Pass either playbook_id (PLAYBOOK scope) or caller_id (CALLER scope)." };
  }
  if (playbookId && callerId) {
    return { error: "Pass only one of playbook_id or caller_id, not both." };
  }

  if (playbookId) {
    const rows = await prisma.behaviorTarget.findMany({
      where: { playbookId, scope: "PLAYBOOK", effectiveUntil: null },
      select: {
        id: true,
        parameterId: true,
        targetValue: true,
        confidence: true,
        source: true,
        updatedAt: true,
        parameter: { select: { name: true, definition: true } },
      },
    });
    return {
      ok: true,
      scope: "PLAYBOOK",
      playbook_id: playbookId,
      count: rows.length,
      targets: rows.map((r) => ({
        parameterId: r.parameterId,
        name: r.parameter?.name ?? null,
        definition: r.parameter?.definition ?? null,
        targetValue: r.targetValue,
        confidence: r.confidence,
        source: r.source,
        updatedAt: r.updatedAt,
      })),
    };
  }

  // CALLER scope — fan in across all of this caller's identities.
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { callerIdentities: { select: { id: true } } },
  });
  if (!caller) return { error: `Caller ${callerId} not found.` };
  const identityIds = caller.callerIdentities.map((i) => i.id);
  if (identityIds.length === 0) {
    return {
      ok: true,
      scope: "CALLER",
      caller_id: callerId,
      count: 0,
      targets: [],
      note: "Caller has no CallerIdentity rows yet — no CALLER-scope targets possible until they enrol.",
    };
  }

  const rows = await prisma.behaviorTarget.findMany({
    where: {
      scope: "CALLER",
      callerIdentityId: { in: identityIds },
      effectiveUntil: null,
    },
    select: {
      id: true,
      parameterId: true,
      callerIdentityId: true,
      targetValue: true,
      confidence: true,
      source: true,
      updatedAt: true,
      parameter: { select: { name: true, definition: true } },
    },
  });

  // De-duplicate: same parameter across multiple identities → pick MAX
  // (matches lib/tolerance/resolve-tolerance.ts behaviour for #836).
  const byParam = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = byParam.get(r.parameterId);
    if (!existing || r.targetValue > existing.targetValue) {
      byParam.set(r.parameterId, r);
    }
  }

  return {
    ok: true,
    scope: "CALLER",
    caller_id: callerId,
    count: byParam.size,
    targets: Array.from(byParam.values()).map((r) => ({
      parameterId: r.parameterId,
      name: r.parameter?.name ?? null,
      definition: r.parameter?.definition ?? null,
      targetValue: r.targetValue,
      confidence: r.confidence,
      source: r.source,
      updatedAt: r.updatedAt,
    })),
    note:
      identityIds.length > 1
        ? `Caller has ${identityIds.length} identities. Values shown are MAX across identities (matches resolve-tolerance.ts).`
        : undefined,
  };
}

async function handleListCurriculumModules(input: Record<string, any>) {
  let curriculumId = typeof input.curriculum_id === "string" ? input.curriculum_id : "";
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";

  if (!curriculumId && !playbookId) {
    return { error: "Pass curriculum_id or playbook_id." };
  }

  if (!curriculumId && playbookId) {
    // #1034 — variant Playbooks share the parent's Curriculum via
    // PlaybookCurriculum; the helper handles both paths.
    const { resolveCurriculumIdForPlaybook } = await import("@/lib/curriculum/resolve-module");
    const resolved = await resolveCurriculumIdForPlaybook(playbookId);
    if (!resolved) {
      return {
        ok: true,
        playbook_id: playbookId,
        curriculum_id: null,
        count: 0,
        modules: [],
        note: "No Curriculum linked to this playbook yet.",
      };
    }
    curriculumId = resolved;
  }

  const modules = await prisma.curriculumModule.findMany({
    where: { curriculumId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      sortOrder: true,
      isActive: true,
      estimatedDurationMinutes: true,
      masteryThreshold: true,
      learningObjectives: {
        select: { id: true, ref: true, description: true, learnerVisible: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return {
    ok: true,
    curriculum_id: curriculumId,
    playbook_id: playbookId || undefined,
    count: modules.length,
    modules,
  };
}

async function handleListGoalsForCaller(input: Record<string, any>) {
  const callerId = typeof input.caller_id === "string" ? input.caller_id : "";
  if (!callerId) return { error: "caller_id is required" };

  const where: Record<string, unknown> = { callerId };
  if (typeof input.status === "string") where.status = input.status;

  const goals = await prisma.goal.findMany({
    where,
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      progress: true,
      priority: true,
      isAssessmentTarget: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });

  return {
    ok: true,
    caller_id: callerId,
    count: goals.length,
    goals,
  };
}

// ── State recovery / direct edits ───────────────────────────────────────

async function handleRecomposeCallerPrompt(input: Record<string, any>) {
  const callerId = typeof input.caller_id === "string" ? input.caller_id : "";
  if (!callerId) return { error: "caller_id is required" };

  // Dynamic import the composition pipeline so the test-mocking story
  // for the chat module stays decoupled. Same pattern that #831's pill
  // uses when calling the route from the client.
  const { executeComposition, loadComposeConfig, persistComposedPrompt } = await import(
    "@/lib/prompt/composition"
  );
  const { renderPromptSummary } = await import("@/lib/prompt/composition/renderPromptSummary");

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true, domainId: true },
  });
  if (!caller) return { error: `Caller ${callerId} not found.` };

  const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({});
  const composition = await executeComposition(callerId, sections, fullSpecConfig, "manual");
  const summary = renderPromptSummary(composition.llmPrompt);
  const cp = await persistComposedPrompt(composition, summary, {
    callerId,
    playbookId: null,
    triggerType: "manual",
    triggerCallId: null,
    composeSpecSlug: specSlug,
    specConfig: fullSpecConfig,
    skipPersist: false,
  });

  console.log(
    `[admin-tools] Recomposed prompt for caller ${callerId} (${caller.name}). New ComposedPrompt id=${cp?.id ?? "(?)"}. Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    caller_id: callerId,
    composed_prompt_id: cp?.id ?? null,
    composed_at: cp?.composedAt ?? null,
    message: cp
      ? `Recomposed. New ComposedPrompt id=${cp.id} at ${cp.composedAt.toISOString()}.`
      : "Recompose ran but persistence was skipped.",
  };
}

async function handleUpdateLearningObjective(input: Record<string, any>) {
  const loId = typeof input.learning_objective_id === "string" ? input.learning_objective_id : "";
  if (!loId) return { error: "learning_objective_id is required" };

  const existing = await prisma.learningObjective.findUnique({
    where: { id: loId },
    select: { id: true, ref: true, moduleId: true, module: { select: { curriculumId: true } } },
  });
  if (!existing) return { error: `LearningObjective ${loId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.description === "string") data.description = input.description;
  if (typeof input.performanceStatement === "string") data.performanceStatement = input.performanceStatement;
  if (typeof input.learnerVisible === "boolean") data.learnerVisible = input.learnerVisible;
  if (typeof input.masteryThreshold === "number") data.masteryThreshold = input.masteryThreshold;

  if (Object.keys(data).length === 0) {
    return {
      error:
        "No update fields provided. Pass at least one of: description, performanceStatement, learnerVisible, masteryThreshold.",
    };
  }

  const updated = await prisma.learningObjective.update({
    where: { id: loId },
    data,
    select: {
      id: true,
      ref: true,
      description: true,
      performanceStatement: true,
      learnerVisible: true,
      masteryThreshold: true,
    },
  });

  // #1034 — CC-B fanout: bump every sibling Playbook sharing this Curriculum.
  let timestampBumped = false;
  let siblingCount = 0;
  if (existing.module?.curriculumId) {
    const playbookIds = await resolvePlaybookIdForCurriculum(existing.module.curriculumId);
    siblingCount = playbookIds.length;
    for (const pbId of playbookIds) {
      await bumpPlaybookComposeTimestamp(pbId);
      timestampBumped = true;
    }
  }

  console.log(
    `[admin-tools] Updated LO ${existing.ref}. Fields: ${Object.keys(data).join(", ")}. composeInputsUpdatedAt bumped: ${timestampBumped} (${siblingCount} sibling${siblingCount === 1 ? "" : "s"}). Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange when the timestamp bumped.
  const loFields = Object.keys(data);
  const pendingChange =
    timestampBumped && loFields.length > 0
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: null, // playbookId resolved earlier but not surfaced here; cohort preview suppressed
          scopeLabel: `LO ${existing.ref}`,
          key: loFields[0],
          label: loFields[0],
          beforeValue: undefined,
          afterValue: (data as Record<string, unknown>)[loFields[0]],
        })
      : undefined;

  return {
    ok: true,
    learning_objective_id: loId,
    updated_fields: loFields,
    compose_inputs_bumped: timestampBumped,
    new_state: updated,
    message: `Updated ${existing.ref}. ${pendingChange ? TRAY_PROPOSED_SUFFIX : ""}`.trim(),
    ...(pendingChange ? { pendingChange } : {}),
  };
}

async function handleUpdateCurriculumMetadata(input: Record<string, any>) {
  const curriculumId = typeof input.curriculum_id === "string" ? input.curriculum_id : "";
  if (!curriculumId) return { error: "curriculum_id is required" };

  // #1034 — Don't read the deprecated `playbookId` column directly;
  // resolve all sibling Playbooks via PlaybookCurriculum so the staleness
  // bump fans out across the variant Course product line.
  const existing = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: { id: true, name: true },
  });
  if (!existing) return { error: `Curriculum ${curriculumId} not found.` };

  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") data.name = input.name;
  if (typeof input.description === "string") data.description = input.description;
  if (typeof input.sourceTitle === "string") data.sourceTitle = input.sourceTitle;
  if (typeof input.sourceYear === "number") data.sourceYear = input.sourceYear;
  if (Array.isArray(input.authors)) data.authors = input.authors;

  if (Object.keys(data).length === 0) {
    return {
      error:
        "No update fields provided. Pass at least one of: name, description, sourceTitle, sourceYear, authors.",
    };
  }

  const updated = await prisma.curriculum.update({
    where: { id: curriculumId },
    data,
    select: {
      id: true,
      name: true,
      description: true,
      sourceTitle: true,
      sourceYear: true,
      authors: true,
    },
  });

  // #1034 — CC-B fanout: bump every sibling Playbook sharing this Curriculum.
  // pendingChange.scopeId is the representative (first = primary by ordering).
  const playbookIds = await resolvePlaybookIdForCurriculum(curriculumId);
  const representativePlaybookId: string | null = playbookIds[0] ?? null;
  let timestampBumped = false;
  for (const pbId of playbookIds) {
    await bumpPlaybookComposeTimestamp(pbId);
    timestampBumped = true;
  }

  console.log(
    `[admin-tools] Updated curriculum "${existing.name}" → "${updated.name}". Fields: ${Object.keys(data).join(", ")}. composeInputsUpdatedAt bumped: ${timestampBumped} (${playbookIds.length} sibling${playbookIds.length === 1 ? "" : "s"}). Reason: ${input.reason || "(not given)"}`,
  );

  // #873 follow-up — emit pendingChange when the timestamp bumped.
  const curFields = Object.keys(data);
  const pendingChange =
    timestampBumped && curFields.length > 0
      ? buildPendingChangePayload({
          scope: "playbook",
          scopeId: representativePlaybookId,
          scopeLabel: `Curriculum ${existing.name}`,
          key: curFields[0],
          label: curFields[0],
          beforeValue: undefined,
          afterValue: (data as Record<string, unknown>)[curFields[0]],
        })
      : undefined;

  return {
    ok: true,
    curriculum_id: curriculumId,
    updated_fields: curFields,
    compose_inputs_bumped: timestampBumped,
    new_state: updated,
    message: `Updated ${updated.name}. ${
      pendingChange ? TRAY_PROPOSED_SUFFIX : "No playbook linked yet — no stale bump."
    }`.trim(),
    ...(pendingChange ? { pendingChange } : {}),
  };
}

// ── Roadmap stubs ───────────────────────────────────────────────────────
//
// One handler covers every NOT YET AVAILABLE tool. The schema in
// admin-tools.ts carries the user-facing copy in its description so the
// AI surfaces a tool-specific refusal verbatim. This handler is the
// belt-and-braces: it returns a structured payload so the AI can never
// silently call the function and pretend it worked.

function handleNotYetAvailable(toolName: string) {
  console.log(`[admin-tools] Stub tool invoked: ${toolName} (NOT YET AVAILABLE)`);
  return {
    ok: false,
    not_yet_available: true,
    tool: toolName,
    message:
      `The "${toolName}" tool is on the roadmap and is not yet implemented. ` +
      `Tell the user this in plain English and point them at the UI surface ` +
      `noted in the tool's description above.`,
  };
}

// ── #1225 Slice B handlers ──────────────────────────────────────────────

/**
 * Promote a Curriculum to PRIMARY on a Playbook; demote the previous
 * primary (if any) to 'linked' in the same transaction. Bumps
 * Playbook.composeInputsUpdatedAt and emits a pendingChange so the
 * existing admin-tools-pending-change.test.ts walking set will cover it.
 */
async function handleSwapPrimaryCurriculum(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  const curriculumId = typeof input.curriculum_id === "string" ? input.curriculum_id : "";
  if (!playbookId || !curriculumId) {
    return { error: "playbook_id and curriculum_id are required" };
  }

  const [playbook, curriculum] = await Promise.all([
    prisma.playbook.findUnique({ where: { id: playbookId }, select: { id: true, name: true } }),
    prisma.curriculum.findUnique({ where: { id: curriculumId }, select: { id: true, name: true } }),
  ]);
  if (!playbook) return { error: `Playbook ${playbookId} not found.` };
  if (!curriculum) return { error: `Curriculum ${curriculumId} not found.` };

  // Demote any current primary (other than the target), then upsert target → primary.
  const previousPrimary = await prisma.playbookCurriculum.findFirst({
    where: { playbookId, role: "primary" },
    select: { curriculumId: true },
  });

  await prisma.$transaction(async (tx) => {
    if (previousPrimary && previousPrimary.curriculumId !== curriculumId) {
      await tx.playbookCurriculum.update({
        where: {
          playbookId_curriculumId: { playbookId, curriculumId: previousPrimary.curriculumId },
        },
        data: { role: "linked" },
      });
    }
    // Upsert target → primary. If a 'linked' join row exists, promote it.
    await tx.playbookCurriculum.upsert({
      where: { playbookId_curriculumId: { playbookId, curriculumId } },
      create: { playbookId, curriculumId, role: "primary" },
      update: { role: "primary" },
    });
  });

  await bumpPlaybookComposeTimestamp(playbookId);

  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: playbookId,
    scopeLabel: `Playbook ${playbook.name}`,
    key: "primaryCurriculumId",
    label: "Primary curriculum",
    beforeValue: previousPrimary?.curriculumId,
    afterValue: curriculumId,
  });

  console.log(
    `[admin-tools] swap_primary_curriculum: playbook=${playbookId} new primary=${curriculumId} (was ${previousPrimary?.curriculumId ?? "none"}). Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    playbook_id: playbookId,
    curriculum_id: curriculumId,
    previous_primary_curriculum_id: previousPrimary?.curriculumId ?? null,
    compose_inputs_bumped: true,
    message: `Promoted "${curriculum.name}" to primary on "${playbook.name}". ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}

async function handleAttachLinkedCurriculum(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  const curriculumId = typeof input.curriculum_id === "string" ? input.curriculum_id : "";
  if (!playbookId || !curriculumId) {
    return { error: "playbook_id and curriculum_id are required" };
  }

  const [playbook, curriculum] = await Promise.all([
    prisma.playbook.findUnique({ where: { id: playbookId }, select: { id: true, name: true } }),
    prisma.curriculum.findUnique({ where: { id: curriculumId }, select: { id: true, name: true } }),
  ]);
  if (!playbook) return { error: `Playbook ${playbookId} not found.` };
  if (!curriculum) return { error: `Curriculum ${curriculumId} not found.` };

  const existing = await prisma.playbookCurriculum.findUnique({
    where: { playbookId_curriculumId: { playbookId, curriculumId } },
  });
  if (existing) {
    return {
      ok: true,
      already_attached: true,
      role: existing.role,
      message: `"${curriculum.name}" is already attached to "${playbook.name}" (role=${existing.role}). No change.`,
    };
  }

  await prisma.playbookCurriculum.create({
    data: { playbookId, curriculumId, role: "linked" },
  });
  await bumpPlaybookComposeTimestamp(playbookId);

  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: playbookId,
    scopeLabel: `Playbook ${playbook.name}`,
    key: "linkedCurriculumAttached",
    label: "Linked curriculum attached",
    beforeValue: undefined,
    afterValue: curriculumId,
  });

  console.log(
    `[admin-tools] attach_linked_curriculum: playbook=${playbookId} linked=${curriculumId}. Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    playbook_id: playbookId,
    curriculum_id: curriculumId,
    role: "linked",
    compose_inputs_bumped: true,
    message: `Attached "${curriculum.name}" as a linked variant on "${playbook.name}". ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}

async function handleDetachLinkedCurriculum(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  const curriculumId = typeof input.curriculum_id === "string" ? input.curriculum_id : "";
  if (!playbookId || !curriculumId) {
    return { error: "playbook_id and curriculum_id are required" };
  }

  const existing = await prisma.playbookCurriculum.findUnique({
    where: { playbookId_curriculumId: { playbookId, curriculumId } },
    include: { playbook: { select: { name: true } }, curriculum: { select: { name: true } } },
  });
  if (!existing) {
    return { error: `No join row for playbook=${playbookId} + curriculum=${curriculumId}.` };
  }
  if (existing.role === "primary") {
    return {
      error:
        `Refusing to detach the PRIMARY curriculum from "${existing.playbook.name}". ` +
        `Use swap_primary_curriculum to promote a different Curriculum first; then detach the old one.`,
    };
  }

  await prisma.playbookCurriculum.delete({
    where: { playbookId_curriculumId: { playbookId, curriculumId } },
  });
  await bumpPlaybookComposeTimestamp(playbookId);

  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: playbookId,
    scopeLabel: `Playbook ${existing.playbook.name}`,
    key: "linkedCurriculumDetached",
    label: "Linked curriculum detached",
    beforeValue: curriculumId,
    afterValue: undefined,
  });

  console.log(
    `[admin-tools] detach_linked_curriculum: playbook=${playbookId} curriculum=${curriculumId}. Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    playbook_id: playbookId,
    curriculum_id: curriculumId,
    compose_inputs_bumped: true,
    message: `Detached "${existing.curriculum.name}" (linked) from "${existing.playbook.name}". ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}

/**
 * Edit a DRAFT IntakeSpec's source. The body cache is re-derived from
 * the new source via @tallyseal/spec-emitter parse +
 * projectBodyFromEditable so list-page fieldCount stays in sync.
 * PUBLISHED rows are refused at the helper layer (updateDraft throws)
 * AND structurally by the intake_spec_published_immutable_trigger.
 */
async function handleUpdateIntakeSpecDraft(input: Record<string, any>) {
  const specId = typeof input.spec_id === "string" ? input.spec_id : "";
  const source = typeof input.source === "string" ? input.source : "";
  if (!specId || !source) return { error: "spec_id and source are required" };

  const existing = await findIntakeSpecById(specId);
  if (!existing) return { error: `IntakeSpec ${specId} not found.` };
  if (existing.status !== "DRAFT") {
    return {
      error:
        `IntakeSpec ${existing.key}@${existing.version} is ${existing.status}. ` +
        `Only DRAFT specs can be edited via chat. PUBLISH → DRAFT requires a new version via the editor.`,
    };
  }

  let body;
  try {
    const editable = parseSpecSource(source);
    body = projectBodyFromEditable(editable);
  } catch (err) {
    const detail =
      err instanceof SpecParseError
        ? `Spec source did not parse: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown parse error";
    return { error: detail };
  }

  const updated = await updateDraft({ id: specId, body, source });

  const fieldCount =
    body && typeof body === "object" && !Array.isArray(body) && "fields" in body && body.fields && typeof body.fields === "object"
      ? Object.keys(body.fields as Record<string, unknown>).length
      : 0;

  console.log(
    `[admin-tools] update_intake_spec_draft: ${existing.key}@${existing.version} (${specId}) — source ${source.length} chars, fieldCount=${fieldCount}. Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    spec_id: specId,
    spec_key: existing.key,
    spec_version: existing.version,
    field_count: fieldCount,
    updated_at: updated.updatedAt.toISOString(),
    message: `Updated DRAFT source for ${existing.key}@${existing.version} — ${fieldCount} field${fieldCount === 1 ? "" : "s"} after re-derivation.`,
  };
}

/**
 * Read voice configuration from Playbook.config.voice. Structurally
 * strips model.secret before returning so chat can never surface it.
 */
async function handleGetVoiceConfig(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  if (!playbookId) return { error: "playbook_id is required" };

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, config: true },
  });
  if (!playbook) return { error: `Playbook ${playbookId} not found.` };

  const config = (playbook.config as PlaybookConfig | null) ?? {};
  const voiceRaw = (config as Record<string, unknown>).voice;
  const voice: Record<string, unknown> = {};
  if (voiceRaw && typeof voiceRaw === "object" && !Array.isArray(voiceRaw)) {
    for (const [k, v] of Object.entries(voiceRaw as Record<string, unknown>)) {
      // Never expose secret material via chat. Note: ai-forbidden-fields
      // adds config.voice.modelSecret in Slice C; this is the runtime
      // belt for v1.
      if (k === "modelSecret" || k === "secret" || k === "apiKey") continue;
      voice[k] = v;
    }
  }

  return {
    ok: true,
    playbook_id: playbookId,
    playbook_name: playbook.name,
    voice,
    has_secret: !!(voiceRaw && typeof voiceRaw === "object" && ("modelSecret" in voiceRaw || "secret" in voiceRaw || "apiKey" in voiceRaw)),
  };
}

/**
 * Update voice configuration in Playbook.config.voice via the existing
 * updatePlaybookConfig helper. modelSecret/secret/apiKey are stripped
 * before the merge so the AI can never write a secret. Bumps
 * composeInputsUpdatedAt and emits pendingChange.
 */
async function handleUpdateVoiceConfig(input: Record<string, any>) {
  const playbookId = typeof input.playbook_id === "string" ? input.playbook_id : "";
  const settings = input.settings as Record<string, unknown> | undefined;
  if (!playbookId || !settings || typeof settings !== "object") {
    return { error: "playbook_id and settings are required" };
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, config: true },
  });
  if (!playbook) return { error: `Playbook ${playbookId} not found.` };

  // #1270 supersedes #1241 — ALLOWED set is now driven by the resolver's
  // `cascadeableKeys` against the system-enabled VoiceProvider's
  // `getConfigSchema()`. New fields auto-allow when the adapter schema
  // gains them (Slice B will add voiceId, transcriber, etc.). `provider`
  // and `model` are LOCKED at system level per the spike — explicitly
  // dropped here, mirroring the resolver contract. autoPipeline (added
  // by #1241) survives as a cross-cutting field via the resolver.
  const sys = await getVoiceSystemSettings();
  const enabledSlug = sys.defaultProviderSlug || "vapi";
  const adapter = await getVoiceProvider(enabledSlug);
  const allowedKeys = new Set(cascadeableKeys(adapter.getConfigSchema()));
  const sanitised: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (SECRET_KEYS.includes(k)) continue;
    if (LOCKED_KEYS.includes(k)) continue;
    if (allowedKeys.has(k)) sanitised[k] = v;
  }
  if (Object.keys(sanitised).length === 0) {
    return {
      error:
        `No allowed voice settings provided. Allowed keys (for ${enabledSlug}): ${Array.from(allowedKeys).join(", ")}. Note: provider/model are system-locked; modelSecret is operator-only.`,
    };
  }

  const existingConfig = (playbook.config as PlaybookConfig | null) ?? {};
  const existingVoice = (existingConfig as Record<string, unknown>).voice;
  const mergedVoice = {
    ...(existingVoice && typeof existingVoice === "object" && !Array.isArray(existingVoice) ? (existingVoice as Record<string, unknown>) : {}),
    ...sanitised,
  };

  await updatePlaybookConfig(playbookId, (current) => ({
    ...current,
    voice: mergedVoice,
  }));

  const changedKeys = Object.keys(sanitised);
  const pendingChange = buildPendingChangePayload({
    scope: "playbook",
    scopeId: playbookId,
    scopeLabel: `Playbook ${playbook.name}`,
    key: `voice.${changedKeys[0]}`,
    label: `voice.${changedKeys[0]}`,
    beforeValue:
      existingVoice && typeof existingVoice === "object" && !Array.isArray(existingVoice)
        ? (existingVoice as Record<string, unknown>)[changedKeys[0]]
        : undefined,
    afterValue: sanitised[changedKeys[0]],
  });

  console.log(
    `[admin-tools] update_voice_config: playbook=${playbookId} keys=${changedKeys.join(",")}. Reason: ${input.reason || "(not given)"}`,
  );

  return {
    ok: true,
    playbook_id: playbookId,
    updated_keys: changedKeys,
    compose_inputs_bumped: true,
    message: `Updated voice config (${changedKeys.join(", ")}) on "${playbook.name}". ${TRAY_PROPOSED_SUFFIX}`,
    pendingChange,
  };
}
