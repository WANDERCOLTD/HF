import { prisma } from "@/lib/prisma";
import { renderVoicePrompt } from "@/lib/prompt/composition/renderPromptSummary";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { resolveSourceFiles, getClaudeMdContext, type BugContext } from "@/lib/chat/bug-context";
import { resolveTerminology, TECHNICAL_TERMS, type TermMap } from "@/lib/terminology";
import { buildTuningSystemPrompt } from "@/lib/chat/tuning-system-prompt";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";

type ChatMode = "DATA" | "CALL" | "BUG" | "TUNING";

interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

/**
 * Build a terminology block to inject into system prompts.
 * Only included when terms differ from technical defaults.
 */
function buildTerminologyBlock(terms: TermMap): string {
  // Skip if terms match technical defaults (admin users)
  const isDifferent = Object.keys(terms).some(
    (k) => terms[k as keyof TermMap] !== TECHNICAL_TERMS[k as keyof TermMap]
  );
  if (!isDifferent) return "";

  return `\n\n## Terminology (use these labels in your responses)
The user sees the following labels instead of internal names:
- Domain → ${terms.domain}
- Playbook → ${terms.playbook}
- Spec → ${terms.spec}
- Caller → ${terms.caller}
- Cohort → ${terms.cohort}
- Instructor → ${terms.instructor}
- Session → ${terms.session}

Always use the user-facing labels above when talking to this user. Never expose internal names like "Domain", "Playbook", "Spec", or "Caller" unless they match the labels above.`;
}

/**
 * Build mode-specific system prompt with entity context
 */
export interface SystemPromptResult {
  prompt: string;
  /** Stored llmPrompt JSON from the most recent ComposedPrompt (CALL mode only) */
  llmPrompt?: unknown;
}

export async function buildSystemPrompt(
  mode: ChatMode,
  entityContext: EntityBreadcrumb[],
  bugContext?: BugContext,
  userRole?: string,
  institutionId?: string | null,
): Promise<SystemPromptResult> {
  // Resolve terminology for this user
  const terms = await resolveTerminology(
    (userRole as any) || "ADMIN",
    institutionId,
  );
  const termBlock = buildTerminologyBlock(terms);

  const baseContext = await buildEntityContext(entityContext);

  switch (mode) {
    case "DATA":
    case "TUNING": {
      // Unified mode: DATA tools + TUNING parameter/contract catalogue
      const [dataPrompt, tuningContext] = await Promise.all([
        getPromptSpec(config.specs.chatDataHelper, DATA_SYSTEM_PROMPT),
        buildTuningSystemPrompt(),
      ]);
      return { prompt: dataPrompt + "\n\n" + tuningContext + termBlock + `\n\n${baseContext}` };
    }
    case "CALL":
      return await buildCallSimPrompt(entityContext, terms, termBlock);
    case "BUG":
      return { prompt: await buildBugDiagnosisPrompt(entityContext, bugContext, termBlock) };
  }
}

const DATA_SYSTEM_PROMPT = `You are a DATA HELPER for the HumanFirst Admin application.

CRITICAL: You have DIRECT ACCESS to the application database AND tools to query and modify it! The "Current Context" section below contains REAL, LIVE DATA. This is NOT simulated.

DO NOT say things like:
- "I don't have access to your data"
- "I can't check external systems"
- "Please consult your administrator"

INSTEAD, use the data below AND your tools to:
- Answer questions about callers, calls, memories, scores, playbooks, specs
- Explain what the data means and how entities relate
- Diagnose issues with spec configs (e.g. "the tutor sounds too formal")
- Make changes to specs when the user asks

When answering, reference the specific data from Current Context or from tool results.
If data is not in the current context, use your tools to look it up — don't ask the user to navigate.

## Available Tools

You have tools to **query and modify** the database:

- **query_specs** — Search specs by name, role, slug
- **get_spec_config** — Get the full config JSON for a spec
- **update_spec_config** — Merge updates into a spec's config
- **query_callers** — Search callers by name or domain
- **get_domain_info** — Get domain details with playbook and specs
- **create_subject_with_source** — Create a subject + content source (curriculum building)
- **add_content_assertions** — Add teaching points to a source (AI generates from knowledge)
- **link_subject_to_domain** — Connect a subject to a domain
- **generate_curriculum** — Trigger AI curriculum generation from assertions
- **system_ini_check** — Run a full system initialization check (SUPERADMIN only). Returns pass/fail/warn for 10 checks covering env vars, database, specs, domains, contracts, admin users, parameters, AI services, VAPI, and storage.

Use tools proactively. If the user asks about a spec or domain, look it up yourself.

### Write Actions (update_spec_config)

For ANY changes to the database:
1. First use get_spec_config or get_domain_info to see the current state
2. Propose your changes clearly — show what will change and why
3. Ask the user: "Shall I apply these changes?"
4. ONLY call update_spec_config AFTER the user explicitly confirms

NEVER modify data without showing the user what will change first.

### Curriculum Building

You can build a complete curriculum from scratch using these tools in sequence:

1. **create_subject_with_source** — Create the subject and its content source
2. **add_content_assertions** — Generate 15-30 teaching points from your knowledge of the topic
3. **link_subject_to_domain** — Connect the subject to a domain (use get_domain_info to find the domain ID)
4. **generate_curriculum** — Trigger AI curriculum generation (runs in background)

**When asked to "build a curriculum" or "create a curriculum":**
1. Ask what domain/topic they want (if not clear)
2. Create the subject and source in one step
3. Generate comprehensive teaching points covering key facts, definitions, processes, and rules
4. Link to the appropriate domain
5. Trigger curriculum generation
6. Summarise what was created and tell the user to check the subject page for results

**Guidelines for generating assertions:**
- Each assertion must be a single, atomic, verifiable teaching point
- Use categories: 'fact' (data points), 'definition' (what things are), 'process' (how things work), 'rule' (constraints/requirements), 'example' (illustrations), 'threshold' (numerical limits)
- Group assertions by chapter/topic area
- Aim for 15-30 assertions for a basic curriculum, more for comprehensive topics
- Set exam_relevance (0.0-1.0) for assessment-focused curricula
- Tag assertions with topic keywords

**Important:** AI-generated content is automatically tagged as trust level "AI_ASSISTED" (L1). An operator should later review and promote the trust level if verified against authoritative sources.

### System Diagnostics (system_ini_check)

When the user asks about system health, readiness, or setup status:
1. Call system_ini_check (no parameters needed)
2. Present results as a table: check name | status (pass/warn/fail) | message
3. For "fail" items, explain the problem and the remediation step
4. For "warn" items, explain why it matters and when to fix it
5. Summarise overall status (green/amber/red) at the top

This tool requires SUPERADMIN role. If a lower-role user asks, explain they need SUPERADMIN access.

## Response Format

Use markdown for clear, readable responses:
- **Bold** for key terms and field names
- \`code\` for slugs, IDs, and config keys
- Code blocks for JSON configs
- Tables for comparing values
- Bullet lists for multiple items`;

/**
 * Build context string from entity breadcrumbs.
 * Always includes a system overview so the AI knows about all domains, playbooks, and specs.
 */
async function buildEntityContext(breadcrumbs: EntityBreadcrumb[]): Promise<string> {
  const parts: string[] = ["## Current Context"];

  // Always load system overview so the AI has full knowledge
  const systemOverview = await getSystemOverview();
  if (systemOverview) parts.push(systemOverview);

  if (!breadcrumbs.length) {
    parts.push("\n_No specific entity selected. The user can navigate to a caller, playbook, or spec for detailed context._");
    return parts.join("\n\n");
  }

  for (const crumb of breadcrumbs) {
    switch (crumb.type) {
      case "caller":
        const callerContext = await getCallerContext(crumb.id);
        if (callerContext) parts.push(callerContext);
        break;
      case "call":
        const callContext = await getCallContext(crumb.id);
        if (callContext) parts.push(callContext);
        break;
      case "spec":
        const specContext = await getSpecContext(crumb.id);
        if (specContext) parts.push(specContext);
        break;
      case "playbook":
        const playbookContext = await getPlaybookContext(crumb.id);
        if (playbookContext) parts.push(playbookContext);
        break;
      case "domain":
        const domainContext = await getDomainContext(crumb.id);
        if (domainContext) parts.push(domainContext);
        break;
      case "flow":
        const flowContext = buildFlowContext(crumb);
        if (flowContext) parts.push(flowContext);
        break;
      default:
        parts.push(`**${crumb.type}:** ${crumb.label}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Build context for an active step flow (e.g., Demonstrate flow).
 * Reads flow state from the entity breadcrumb data field.
 */
function buildFlowContext(crumb: EntityBreadcrumb): string | null {
  const data = crumb.data || {};
  const flowId = crumb.id;

  if (flowId === "get-started") {
    const collected = (data.collectedData as Record<string, unknown>) || {};
    const remaining = (data.remainingQuestions as string[]) || [];
    const answered = (data.answeredCount as number) ?? 0;
    const total = (data.totalVisible as number) ?? 0;

    const parts = [
      `## Active Get Started Wizard`,
      `The educator is setting up a new AI tutoring course from scratch.`,
      `- Current step: **${data.currentStep || "unknown"}** (question: \`${data.currentQuestion || "unknown"}\`)`,
      `- Progress: ${answered} of ${total} questions answered`,
    ];

    if (Object.keys(collected).length > 0) {
      parts.push("", "**Data collected so far:**");
      const labels: Record<string, string> = {
        institutionName: "Institution name",
        existingInstitutionId: "Existing institution (reusing)",
        existingInstitutionName: "Existing institution name",
        typeSlug: "Organisation type",
        websiteUrl: "Website URL",
        courseName: "Course name",
        subjectDiscipline: "Subject discipline",
        interactionPattern: "Teaching approach",
        teachingMode: "Emphasis",
        welcomeMessage: "Welcome greeting",
        sessionCount: "Number of sessions",
        durationMins: "Session duration (mins)",
        planEmphasis: "Breadth vs depth",
        behaviorTargets: "Personality sliders (warmth/directiveness/pace/encouragement)",
        lessonPlanModel: "Lesson plan model",
        contentSkipped: "Content upload skipped",
        sourceCount: "Sources uploaded",
        extractionTotals: "Extraction results",
      };
      for (const [key, val] of Object.entries(collected)) {
        const label = labels[key] || key;
        const display = typeof val === "object" ? JSON.stringify(val) : String(val);
        parts.push(`- ${label}: ${display}`);
      }
    }

    if (remaining.length > 0) {
      parts.push("", `**Remaining questions:** ${remaining.join(", ")}`);
    }

    parts.push(
      "",
      "You can help them:",
      "- Explain what each field means and how it affects the AI tutor",
      "- Suggest values based on their institution type and course",
      "- Explain teaching approaches (Socratic = question-led, Directive = instruction-led, Advisory = guidance-focused, Coaching = skills-building)",
      "- Explain emphasis options (Recall = memory, Comprehension = understanding, Practice = application, Syllabus = curriculum coverage)",
      "- Explain lesson plan models (Direct Instruction, 5E Inquiry, Spiral, Mastery, Project-Based)",
      "- Clarify personality sliders (warmth, directiveness, pace, encouragement — each 0-1)",
      "- Advise on session count and duration for their course type",
      "- Explain what happens after the wizard (institution + course + AI tutor are scaffolded, sim call available)",
    );

    return parts.join("\n");
  }

  if (flowId === "teach") {
    const parts = [`## Active Teach Flow`,
      `The educator is preparing to teach a live session.`,
      `- Current step: ${data.stepLabel || `Step ${(data.step as number ?? 0) + 1}`}`,
    ];
    if (data.goal) parts.push(`- Session goal: "${data.goal}"`);
    if (data.domainId) parts.push(`- Institution selected: ${data.domainId}`);
    if (data.callerId) parts.push(`- Learner selected: ${data.callerId}`);
    parts.push("", "You can help them:", "- Refine their session goal", "- Explain what readiness checks mean and how to fix them", "- Suggest teaching strategies for this institution and learner", "- Navigate to the right pages to resolve issues");
    return parts.join("\n");
  }

  // Legacy demonstrate flow (backwards compatibility)
  if (flowId === "demonstrate") {
    return buildFlowContext({ ...crumb, id: "teach" });
  }

  // Generic flow fallback
  return `## Active Flow: ${crumb.label}\n- Flow ID: ${flowId}\n- Step: ${data.step ?? "unknown"}`;
}

/**
 * Always-loaded system overview: domains, playbooks, specs, and behavior parameters.
 * Gives the AI full knowledge of what exists in the system regardless of navigation state.
 */
async function getSystemOverview(): Promise<string | null> {
  try {
    const [domains, playbooks, specCount, behaviorParams, playbookSubjectCounts, playbookSourceCounts] = await Promise.all([
      prisma.domain.findMany({
        include: {
          playbooks: {
            select: { id: true, name: true, status: true, version: true, config: true },
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { callers: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.playbook.findMany({
        include: {
          domain: { select: { name: true, slug: true } },
          items: {
            where: { itemType: "SPEC" },
            include: { spec: { select: { name: true, slug: true, outputType: true, specRole: true } } },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.analysisSpec.count({ where: { isActive: true } }),
      prisma.parameter.findMany({
        where: { parameterType: "BEHAVIOR" },
        select: { parameterId: true, name: true, domainGroup: true },
        orderBy: { domainGroup: "asc" },
      }),
      prisma.playbookSubject.groupBy({
        by: ["playbookId"],
        _count: { _all: true },
      }),
      prisma.playbookSource.groupBy({
        by: ["playbookId"],
        _count: { _all: true },
      }),
    ]);

    const subjectsByPlaybook = new Map(playbookSubjectCounts.map((g) => [g.playbookId, g._count._all]));
    const sourcesByPlaybook = new Map(playbookSourceCounts.map((g) => [g.playbookId, g._count._all]));

    const parts: string[] = ["### System Overview"];

    // Stats
    parts.push(`- **Domains:** ${domains.length} | **Playbooks:** ${playbooks.length} | **Active Specs:** ${specCount} | **Behavior Parameters:** ${behaviorParams.length}`);

    // Domains + Playbooks
    if (domains.length > 0) {
      parts.push("\n**Domains & Playbooks:**");
      for (const domain of domains) {
        parts.push(`- **${domain.name}** (${domain.slug}) — ${domain._count.callers} callers`);
        if (domain.description) parts.push(`  ${domain.description}`);
        for (const pb of domain.playbooks) {
          const goals = (pb.config as PlaybookConfig)?.goals;
          const goalSummary = Array.isArray(goals) && goals.length > 0
            ? ` — Goals: ${goals.map((g: any) => g.name).join(", ")}`
            : "";
          const linkedSubjects = subjectsByPlaybook.get(pb.id) ?? 0;
          const linkedSources = sourcesByPlaybook.get(pb.id) ?? 0;
          const linkageWarning = linkedSubjects === 0 && linkedSources === 0
            ? " ⚠️ NO course-scoped content (runtime falls back to ALL domain Subjects → cross-course contamination risk)"
            : "";
          parts.push(`  - Playbook: **${pb.name}** [${pb.status}] v${pb.version || "1"} — ${linkedSubjects} subject(s), ${linkedSources} source(s)${linkageWarning}${goalSummary}`);
        }
      }
    }

    // Playbook spec breakdown
    if (playbooks.length > 0) {
      parts.push("\n**Playbook Specs:**");
      for (const pb of playbooks) {
        const specs = pb.items?.map((i) => i.spec).filter(Boolean) || [];
        if (specs.length > 0) {
          const byRole: Record<string, string[]> = {};
          for (const s of specs) {
            if (!s) continue;
            const role = s.specRole || s.outputType || "OTHER";
            if (!byRole[role]) byRole[role] = [];
            byRole[role].push(s.name);
          }
          const roleSummary = Object.entries(byRole)
            .map(([role, names]) => `${role}: ${names.join(", ")}`)
            .join(" | ");
          parts.push(`- **${pb.name}** (${specs.length} specs) — ${roleSummary}`);
        }
      }
    }

    // Behavior parameters grouped
    if (behaviorParams.length > 0) {
      parts.push("\n**Behavior Parameters:**");
      const grouped: Record<string, string[]> = {};
      for (const p of behaviorParams) {
        const group = p.domainGroup || "other";
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(`${p.name} (${p.parameterId})`);
      }
      for (const [group, params] of Object.entries(grouped)) {
        parts.push(`- **${group}:** ${params.join(", ")}`);
      }
    }

    return parts.join("\n");
  } catch (e) {
    console.error("Error loading system overview:", e);
    return null;
  }
}

async function getCallerContext(callerId: string): Promise<string | null> {
  try {
    // Fetch caller with all relevant data
    const [caller, composedPrompt, recentCall, callerTargets] = await Promise.all([
      prisma.caller.findUnique({
        where: { id: callerId },
        include: {
          domain: true,
          personality: true,
          personalityProfile: true,
          memories: {
            where: {
              supersededById: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            take: 30,
            orderBy: { confidence: "desc" },
          },
          _count: {
            select: { calls: true },
          },
        },
      }),
      // Get most recent composed prompt
      prisma.composedPrompt.findFirst({
        where: { callerId },
        orderBy: { composedAt: "desc" },
        select: {
          id: true,
          prompt: true,
          llmPrompt: true,
          composedAt: true,
          status: true,
          triggerType: true,
        },
      }),
      // Get up to 20 most recent calls (id/date for all, transcript preview for top 3 only)
      prisma.call.findMany({
        where: { callerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          callSequence: true,
          transcript: true,
          usedPrompt: {
            select: {
              id: true,
              prompt: true,
              llmPrompt: true,
              composedAt: true,
            },
          },
        },
      }),
      // Get caller targets
      prisma.callerTarget.findMany({
        where: { callerId },
        include: {
          parameter: {
            select: { parameterId: true, name: true },
          },
        },
        orderBy: { lastUpdatedAt: "desc" },
        take: 15,
      }),
    ]);

    if (!caller) return null;

    const parts = [
      `### Caller: ${caller.name ?? caller.id}`,
      `- **ID:** ${caller.id}`,
      ...(caller.email ? [`- **Email:** ${caller.email}`] : []),
      ...(caller.domain?.name ? [`- **Domain:** ${caller.domain.name}`] : []),
      `- **Total Calls:** ${caller._count.calls}`,
    ];

    // Personality
    if (caller.personality) {
      const p = caller.personality;
      parts.push("\n**Personality (Big Five):**");
      if (p.openness !== null) parts.push(`- Openness: ${(p.openness * 100).toFixed(0)}%`);
      if (p.conscientiousness !== null) parts.push(`- Conscientiousness: ${(p.conscientiousness * 100).toFixed(0)}%`);
      if (p.extraversion !== null) parts.push(`- Extraversion: ${(p.extraversion * 100).toFixed(0)}%`);
      if (p.agreeableness !== null) parts.push(`- Agreeableness: ${(p.agreeableness * 100).toFixed(0)}%`);
      if (p.neuroticism !== null) parts.push(`- Neuroticism: ${(p.neuroticism * 100).toFixed(0)}%`);
    }

    // Memories grouped by category
    if (caller.memories.length > 0) {
      parts.push("\n**Memories:**");
      const grouped: Record<string, string[]> = {};
      for (const mem of caller.memories) {
        if (!grouped[mem.category]) grouped[mem.category] = [];
        grouped[mem.category].push(`${mem.key}: ${mem.value}`);
      }
      for (const [cat, items] of Object.entries(grouped)) {
        parts.push(`- **${cat}:** ${items.slice(0, 5).join("; ")}${items.length > 5 ? ` (+${items.length - 5} more)` : ""}`);
      }
    }

    // Behavior Targets
    if (callerTargets.length > 0) {
      parts.push("\n**Behavior Targets:**");
      for (const target of callerTargets.slice(0, 10)) {
        const level = target.targetValue >= 0.7 ? "HIGH" : target.targetValue <= 0.3 ? "LOW" : "MODERATE";
        parts.push(`- ${target.parameter?.name || target.parameterId}: ${(target.targetValue * 100).toFixed(0)}% (${level})`);
      }
    }

    // Recent Calls (up to 20 ids/dates; transcripts only for top 3 to save tokens)
    if (recentCall.length > 0) {
      const moreNote = caller._count.calls > recentCall.length
        ? ` — ${caller._count.calls - recentCall.length} older call(s) not shown`
        : "";
      parts.push(`\n**Recent Calls (showing ${recentCall.length} of ${caller._count.calls}${moreNote}):**`);
      for (let i = 0; i < recentCall.length; i++) {
        const call = recentCall[i];
        parts.push(`- Call #${call.callSequence || "?"} on ${call.createdAt.toLocaleString()} (id: ${call.id})`);
        if (i < 3 && call.transcript) {
          const preview = call.transcript.slice(0, 200).replace(/\n/g, " ");
          parts.push(`  Transcript: "${preview}${call.transcript.length > 200 ? "..." : ""}"`);
        }
      }

      // Show the prompt used FOR the most recent call only (full detail)
      const mostRecent = recentCall[0];
      if (mostRecent.usedPrompt) {
        parts.push("\n**Prompt Used FOR Most Recent Call:**");
        if (mostRecent.usedPrompt.composedAt) parts.push(`- Composed: ${mostRecent.usedPrompt.composedAt.toLocaleString()}`);
        if (mostRecent.usedPrompt.llmPrompt) {
          const llm = mostRecent.usedPrompt.llmPrompt as Record<string, unknown>;
          parts.push("```json");
          const summary: Record<string, unknown> = {};
          if (llm._quickStart) summary._quickStart = llm._quickStart;
          if (llm._preamble) summary._preamble = llm._preamble;
          if (llm.instructions) summary.instructions = llm.instructions;
          if (llm.this_caller) summary.this_caller = llm.this_caller;
          if (llm.behavior_targets) summary.behavior_targets = llm.behavior_targets;
          parts.push(JSON.stringify(summary, null, 2).slice(0, 1500));
          parts.push("```");
        } else if (mostRecent.usedPrompt.prompt) {
          parts.push("```");
          parts.push(mostRecent.usedPrompt.prompt.slice(0, 800));
          if (mostRecent.usedPrompt.prompt.length > 800) parts.push("... (truncated)");
          parts.push("```");
        }
      } else {
        parts.push("\n_No prompt was tracked for the most recent call (usedPromptId not set)_");
      }
    }

    // Composed Prompt (the key info the user is asking about!)
    if (composedPrompt) {
      parts.push("\n**Composed Prompt (for next call):**");
      parts.push(`- Status: ${composedPrompt.status || "active"}`);
      if (composedPrompt.composedAt) parts.push(`- Composed: ${composedPrompt.composedAt.toLocaleString()}`);
      if (composedPrompt.triggerType) parts.push(`- Trigger: ${composedPrompt.triggerType}`);

      // Include the LLM-friendly structured prompt if available
      if (composedPrompt.llmPrompt) {
        const llm = composedPrompt.llmPrompt as Record<string, unknown>;
        parts.push("\n**LLM Prompt Structure:**");
        parts.push("```json");
        // Pretty print key sections
        const summary: Record<string, unknown> = {};
        if (llm._quickStart) summary._quickStart = llm._quickStart;
        if (llm._preamble) summary._preamble = llm._preamble;
        if (llm.instructions) summary.instructions = llm.instructions;
        if (llm.this_caller) summary.this_caller = llm.this_caller;
        if (llm.behavior_targets) summary.behavior_targets = llm.behavior_targets;
        parts.push(JSON.stringify(summary, null, 2).slice(0, 2000));
        parts.push("```");
      } else if (composedPrompt.prompt) {
        parts.push("\n**Prompt Preview:**");
        parts.push("```");
        parts.push(composedPrompt.prompt.slice(0, 1000));
        if (composedPrompt.prompt.length > 1000) parts.push("... (truncated)");
        parts.push("```");
      }
    } else {
      parts.push("\n**⚠️ No Composed Prompt** - Run /buildprompt to generate one");
    }

    return parts.join("\n");
  } catch (e) {
    console.error("Error loading caller context:", e);
    return null;
  }
}

async function getCallContext(callId: string): Promise<string | null> {
  try {
    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: {
        caller: true,
        scores: {
          include: { parameter: true },
          take: 10,
          orderBy: { confidence: "desc" },
        },
        usedPrompt: {
          select: {
            id: true,
            prompt: true,
            llmPrompt: true,
            composedAt: true,
          },
        },
      },
    });

    if (!call) return null;

    const parts = [
      `### Call`,
      `- **ID:** ${call.id}`,
      `- **Date:** ${call.createdAt.toLocaleString()}`,
      ...(call.caller?.name ? [`- **Caller:** ${call.caller.name}`] : []),
      ...(call.source ? [`- **Source:** ${call.source}`] : []),
      ...((call as any).callSequence ? [`- **Call Sequence:** #${(call as any).callSequence}`] : []),
    ];

    // Show the prompt that was used FOR this call
    if (call.usedPrompt) {
      parts.push("\n**Prompt Used FOR This Call:**");
      if (call.usedPrompt.composedAt) parts.push(`- Composed: ${call.usedPrompt.composedAt.toLocaleString()}`);
      if (call.usedPrompt.llmPrompt) {
        const llm = call.usedPrompt.llmPrompt as Record<string, unknown>;
        parts.push("```json");
        const summary: Record<string, unknown> = {};
        if (llm._quickStart) summary._quickStart = llm._quickStart;
        if (llm._preamble) summary._preamble = llm._preamble;
        if (llm.instructions) summary.instructions = llm.instructions;
        if (llm.this_caller) summary.this_caller = llm.this_caller;
        if (llm.behavior_targets) summary.behavior_targets = llm.behavior_targets;
        parts.push(JSON.stringify(summary, null, 2).slice(0, 2000));
        parts.push("```");
      } else if (call.usedPrompt.prompt) {
        parts.push("```");
        parts.push(call.usedPrompt.prompt.slice(0, 1000));
        if (call.usedPrompt.prompt.length > 1000) parts.push("... (truncated)");
        parts.push("```");
      }
    } else {
      parts.push("\n_No prompt was tracked for this call_");
    }

    if (call.transcript) {
      const preview = call.transcript.slice(0, 500);
      parts.push(`\n**Transcript Preview:**\n${preview}${call.transcript.length > 500 ? "..." : ""}`);
    }

    if (call.scores.length > 0) {
      parts.push("\n**Scores:**");
      for (const score of call.scores.slice(0, 5)) {
        if (score.parameter?.name) parts.push(`- ${score.parameter.name}: ${(score.score * 100).toFixed(0)}%`);
      }
    }

    return parts.join("\n");
  } catch {
    return null;
  }
}

async function getPlaybookContext(playbookId: string): Promise<string | null> {
  try {
    const [playbook, playbookSubjects, playbookSources] = await Promise.all([
      prisma.playbook.findUnique({
        where: { id: playbookId },
        include: {
          items: {
            include: {
              spec: true,
              promptTemplate: true,
            },
          },
          domain: { select: { id: true, name: true } },
        },
      }),
      prisma.playbookSubject.findMany({
        where: { playbookId },
        select: { subject: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.playbookSource.findMany({
        where: { playbookId },
        select: { sourceId: true, source: { select: { name: true, documentType: true } } },
      }),
    ]);

    if (!playbook) return null;

    const parts = [
      `### Playbook: ${playbook.name}`,
      `- **ID:** ${playbook.id}`,
      `- **Status:** ${playbook.status}`,
      ...(playbook.version ? [`- **Version:** ${playbook.version}`] : []),
      ...(playbook.domain ? [`- **Domain:** ${playbook.domain.name} (${playbook.domain.id})`] : []),
    ];

    // Domain specs (items)
    const domainSpecs = playbook.items?.filter((i: any) => i.spec) || [];
    parts.push(`\n**Domain Specs:** ${domainSpecs.length}`);
    if (domainSpecs.length > 0) {
      for (const item of domainSpecs.slice(0, 10)) {
        const spec = (item as any).spec;
        if (spec) {
          parts.push(`- ${spec.name} [${spec.outputType}]`);
        }
      }
      if (domainSpecs.length > 10) {
        parts.push(`- ... and ${domainSpecs.length - 10} more specs`);
      }
    }

    // Prompt templates
    const templates = playbook.items?.filter((i: any) => i.promptTemplate) || [];
    parts.push(`\n**Prompt Templates:** ${templates.length}`);

    // Course-scoped content linkage (PlaybookSubject + PlaybookSource)
    parts.push(`\n**Linked Subjects (PlaybookSubject):** ${playbookSubjects.length}`);
    for (const ps of playbookSubjects.slice(0, 10)) {
      parts.push(`- ${ps.subject.name} (${ps.subject.slug})`);
    }

    parts.push(`\n**Linked Sources (PlaybookSource):** ${playbookSources.length}`);
    for (const ps of playbookSources.slice(0, 10)) {
      parts.push(`- ${ps.source?.name ?? ps.sourceId}${ps.source?.documentType ? ` [${ps.source.documentType}]` : ""}`);
    }

    // Teaching point (ContentAssertion) count from linked sources
    const sourceIds = playbookSources.map((ps) => ps.sourceId);
    const assertionCount = sourceIds.length > 0
      ? await prisma.contentAssertion.count({ where: { sourceId: { in: sourceIds } } })
      : 0;
    parts.push(`\n**Teaching Points (course-scoped):** ${assertionCount}`);

    // CRITICAL: warn about runtime fallback contamination risk
    if (playbookSubjects.length === 0 && playbookSources.length === 0) {
      parts.push(
        `\n**⚠️ NO course-scoped content linkage.**`,
        `At runtime, \`getSourceIdsForPlaybook\` falls back to ALL Subjects in the domain — including content from sibling courses on the same domain. This causes cross-course contamination (e.g. Writing content appearing in a Speaking session). Tracked: issue #180/#181 Phase 6.`,
      );
    }

    return parts.join("\n");
  } catch (e) {
    console.error("Error loading playbook context:", e);
    return null;
  }
}

async function getSpecContext(specId: string): Promise<string | null> {
  try {
    const spec = await prisma.analysisSpec.findUnique({
      where: { id: specId },
      include: {
        triggers: {
          include: {
            actions: true,
          },
        },
      },
    });

    if (!spec) return null;

    const parts = [
      `### Spec: ${spec.name}`,
      `- **Slug:** ${spec.slug}`,
      `- **Scope:** ${spec.scope}`,
      `- **Output Type:** ${spec.outputType}`,
      ...(spec.specType ? [`- **Spec Type:** ${spec.specType}`] : []),
      ...(spec.specRole ? [`- **Spec Role:** ${spec.specRole}`] : []),
      `- **Locked:** ${spec.isLocked ? "Yes" : "No"}`,
      `- **Active:** ${spec.isActive ? "Yes" : "No"}`,
    ];

    // Triggers
    const triggerCount = spec.triggers?.length || 0;
    parts.push(`\n**Triggers:** ${triggerCount}`);
    if (spec.triggers && spec.triggers.length > 0) {
      for (const trigger of spec.triggers) {
        parts.push(`\n- **${trigger.name || "Trigger"}**`);
        if (trigger.given) parts.push(`  Given: ${trigger.given.slice(0, 100)}${trigger.given.length > 100 ? "..." : ""}`);
        if (trigger.when) parts.push(`  When: ${trigger.when.slice(0, 100)}${trigger.when.length > 100 ? "..." : ""}`);
        if (trigger.then) parts.push(`  Then: ${trigger.then.slice(0, 100)}${trigger.then.length > 100 ? "..." : ""}`);

        const actionCount = trigger.actions?.length || 0;
        if (actionCount > 0) {
          parts.push(`  Actions: ${actionCount}`);
        }
      }
    }

    if (spec.promptTemplate) {
      parts.push(`\n**Prompt Template:**`);
      parts.push("```");
      parts.push(spec.promptTemplate.slice(0, 500));
      if (spec.promptTemplate.length > 500) parts.push("... (truncated)");
      parts.push("```");
    }

    return parts.join("\n");
  } catch (e) {
    console.error("Error loading spec context:", e);
    return null;
  }
}

async function getDomainContext(domainId: string): Promise<string | null> {
  try {
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      include: {
        playbooks: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        _count: {
          select: {
            callers: true,
            playbooks: true,
          },
        },
      },
    });

    if (!domain) return null;

    const parts = [
      `### Domain: ${domain.name}`,
      `- **ID:** ${domain.id}`,
      ...(domain.description ? [`- **Description:** ${domain.description}`] : []),
      `- **Total Callers:** ${domain._count.callers}`,
      `- **Total Playbooks:** ${domain._count.playbooks}`,
    ];

    // Published playbook
    const publishedPlaybook = domain.playbooks?.find((p) => p.status === "PUBLISHED");
    if (publishedPlaybook) {
      parts.push(`\n**Published Playbook:** ${publishedPlaybook.name} (v${publishedPlaybook.version || "1"})`);
    } else {
      parts.push(`\n**⚠️ No Published Playbook** - Callers in this domain won't get domain-specific behavior`);
    }

    // Recent playbooks
    if (domain.playbooks && domain.playbooks.length > 0) {
      parts.push(`\n**Recent Playbooks:**`);
      for (const pb of domain.playbooks) {
        parts.push(`- ${pb.name} [${pb.status}]`);
      }
    }

    return parts.join("\n");
  } catch (e) {
    console.error("Error loading domain context:", e);
    return null;
  }
}

/**
 * Build CALL mode prompt using the actual composed prompt for the caller.
 *
 * Uses renderVoicePrompt() for the same voice-optimized format that VAPI receives,
 * giving a realistic simulation of the actual call experience.
 */
async function buildCallSimPrompt(entityContext: EntityBreadcrumb[], terms?: TermMap, termBlock?: string): Promise<SystemPromptResult> {
  const callerEntity = entityContext.find((e) => e.type === "caller");
  const goalEntity = entityContext.find((e) => e.type === "demonstrationGoal");
  const goalPrefix = goalEntity?.label
    ? `\nADMIN SESSION GOAL: "${goalEntity.label}"\nOrient the conversation toward this goal while maintaining your natural voice and teaching style.\n\n`
    : "";

  if (!callerEntity) {
    return { prompt: `You are simulating a VAPI voice AI call.

No caller is currently selected. Please navigate to a caller to enable personalized simulation.

For now, respond as a friendly, helpful voice AI assistant. Keep responses short (1-3 sentences) and conversational.` };
  }

  try {
    // Fetch the most recent composed prompt for this caller
    const composedPrompt = await prisma.composedPrompt.findFirst({
      where: { callerId: callerEntity.id },
      orderBy: { composedAt: "desc" },
    });

    // If we have a composed prompt with llmPrompt JSON, use the voice-optimized renderer
    if (composedPrompt?.llmPrompt) {
      const voicePrompt = renderVoicePrompt(composedPrompt.llmPrompt as any);
      return {
        prompt: `You are simulating a VAPI voice AI call. This is the EXACT prompt the voice AI receives.
Keep responses SHORT (1-3 sentences) — this is voice, not text.
${goalPrefix}${voicePrompt}${termBlock || ""}`,
        llmPrompt: composedPrompt.llmPrompt,
      };
    }

    // Fallback: no composed prompt — use basic caller info
    const caller = await prisma.caller.findUnique({
      where: { id: callerEntity.id },
      include: {
        personality: true,
        memories: {
          where: {
            supersededById: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          take: 20,
          orderBy: { confidence: "desc" },
        },
      },
    });

    const parts = [
      `You are simulating a VAPI voice AI call with ${caller?.name || "a caller"}.

No composed prompt found — run "Compose Prompt" for this caller first for the full experience.

## Fallback Instructions
- Keep responses SHORT (1-3 sentences) - this simulates voice AI
- Be conversational and natural
- Use the caller's name when appropriate`,
    ];

    if (caller?.memories && caller.memories.length > 0) {
      parts.push("\n## Key Facts About This Caller");
      for (const m of caller.memories.slice(0, 10)) {
        parts.push(`- ${m.key}: ${m.value}`);
      }
    }

    return { prompt: parts.join("\n") + (termBlock || "") };
  } catch {
    return { prompt: `You are simulating a VAPI voice AI call with caller ${callerEntity.label}.

Keep responses short (1-3 sentences) and conversational.
Be helpful, warm, and natural.${termBlock || ""}` };
  }
}

const BUG_SYSTEM_PROMPT = `You are a BUG DIAGNOSIS ASSISTANT for the HumanFirst Admin application (Next.js 16).

You have been given:
1. The project's architecture documentation (CLAUDE.md)
2. Source code for the page the user is currently viewing
3. Recent errors captured from the browser
4. The user's description of the bug

Your job is to:
1. **Diagnose** — Identify the likely root cause based on the source code, error context, and architecture
2. **Locate** — Point to the specific file(s) and line(s) where the bug likely lives
3. **Explain** — Describe WHY the bug occurs (race condition, missing null check, wrong API call, etc.)
4. **Fix** — Suggest a concrete fix with code snippets

## Response Format

### Diagnosis
[1-2 sentence summary of the root cause]

### Location
[File path(s) and approximate line numbers]

### Explanation
[Detailed explanation of why this happens]

### Suggested Fix
\\\`\\\`\\\`typescript
// The fix
\\\`\\\`\\\`

## Known Gotchas (from project docs)
- TDZ shadowing: Never \`const config = ...\` when \`config\` is imported — use \`specConfig\`
- CSS alpha: Never \`\${cssVar}99\` — use \`color-mix()\`
- Missing await: All ContractRegistry methods are async
- Hardcoded slugs: Use \`config.specs.*\` — all env-overridable
- Unmetered AI: All AI calls must go through metered wrappers
- Auth: Every route needs \`requireAuth("ROLE")\` from \`lib/permissions.ts\`

Be specific and actionable. Reference actual file paths and code from the context provided.`;

/**
 * Build BUG mode prompt with source code awareness and error context.
 */
async function buildBugDiagnosisPrompt(
  entityContext: EntityBreadcrumb[],
  bugContext?: BugContext,
  termBlock?: string
): Promise<string> {
  const bugPrompt = await getPromptSpec(config.specs.chatBugDiagnosis, BUG_SYSTEM_PROMPT);
  const parts: string[] = [bugPrompt + (termBlock || "")];

  // Architecture context from CLAUDE.md
  const claudeMd = await getClaudeMdContext();
  if (claudeMd) {
    parts.push("\n## Project Architecture\n" + claudeMd);
  }

  // Source code for current page
  if (bugContext?.url) {
    const sourceCtx = await resolveSourceFiles(bugContext.url);
    if (sourceCtx.pageFile) {
      parts.push("\n## Current Page Source\n```tsx\n" + sourceCtx.pageFile + "\n```");
    }
    if (sourceCtx.directoryTree) {
      parts.push("\n## Directory Structure\n```\n" + sourceCtx.directoryTree + "\n```");
    }
    if (sourceCtx.apiRoutes.length > 0) {
      parts.push("\n## Related API Routes\n" + sourceCtx.apiRoutes.map(r => `- \`${r}\``).join("\n"));
    }
  }

  // Error context from client
  if (bugContext?.errors?.length) {
    parts.push(
      "\n## Recent Errors Captured\n" +
        bugContext.errors
          .map(
            (e) =>
              `- [${new Date(e.timestamp).toISOString()}] ${e.message}` +
              (e.source ? ` (${e.source})` : "") +
              (e.status ? ` HTTP ${e.status}` : "") +
              (e.stack ? `\n  Stack: ${e.stack.slice(0, 200)}` : "")
          )
          .join("\n")
    );
  }

  // Browser/environment
  if (bugContext) {
    parts.push(
      `\n## Environment\n- URL: ${bugContext.url}\n- Browser: ${bugContext.browser}\n- Viewport: ${bugContext.viewport}\n- Reported: ${new Date(bugContext.timestamp).toISOString()}`
    );
  }

  // Entity context (what page/entity user is looking at)
  const baseContext = await buildEntityContext(entityContext);
  if (baseContext) {
    parts.push("\n" + baseContext);
  }

  return parts.join("\n\n");
}
