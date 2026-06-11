/**
 * #1504 — Unified Assistant system-prompt builder.
 *
 * Merges the DATA + TUNING + COURSE_MANAGE prompt cascades into ONE builder
 * so a single chat surface can answer course-tuning, learner-tuning,
 * content-query, sim-prep, doc-lookup, and error-recovery questions
 * without three separate `mode` branches in `app/api/chat/route.ts`.
 *
 * Slice 1 (#1505) shipped this builder behind `HF_FLAG_UNIFIED_ASSISTANT`.
 * Slice 2 (this commit) flips it to the default for the three collapsing
 * modes and drops the flag — the legacy cases in `system-prompts.ts` are
 * also retired. CALL + BUG remain on `buildSystemPrompt`; DEMO / WIZARD /
 * COURSE_REF keep their own dedicated builders.
 *
 * ## Composition
 *
 * The unified prompt is built from these layers (in order):
 *
 *   1. `DATA_SYSTEM_PROMPT` (via `getPromptSpec(config.specs.chatDataHelper)`)
 *      — the catalogue of admin tools + grounding contract + write-action
 *      rules. The grounding contract section is what `factual-grounding-
 *      intercept.ts` pairs with structurally.
 *   2. `buildTuningSystemPrompt({ entityContext, tuningScope })` — the
 *      behaviour-target catalogue + truthfulness rules + scope-aware
 *      `update_behavior_target` / `update_playbook_config` template. This
 *      block is intentionally CARRIED IN even when `tuningScope` is unset,
 *      because the unified surface must still expose the tools.
 *   3. **Intent-routing block** (NEW) — short hint to the model:
 *        - "the user is on a Course page — bias toward course-edit tools"
 *        - "the user mentioned tuning — bias toward behaviour-target tools"
 *        - "no specific course/learner in context — bias toward DATA tools"
 *      This is the spike's "AI self-narrows" hypothesis. The model still
 *      sees the FULL `ADMIN_TOOLS` palette; this block hints at which
 *      subset is contextually relevant.
 *   4. `buildPageContextBlock(pageContext)` — page + tab + visible sections
 *      preamble (same as DATA branch today).
 *   5. `buildPageFeatureCatalogue(pageHintRoute)` — what features the page
 *      offers (same as DATA branch today).
 *   6. `buildEntityContext(entityContext)` — current entity snapshot (the
 *      large block with caller / playbook / domain detail).
 *   7. Ticket / feedback list hints (only when applicable) — same as DATA.
 *   8. Runtime context (version / env / DB target / route / role).
 *   9. Terminology block (when non-technical terms are in play).
 *
 * ## Why the COURSE_MANAGE case is satisfied "for free"
 *
 * The legacy `system-prompts.ts::buildSystemPrompt` already shares the
 * `case "COURSE_MANAGE":` branch with `case "DATA":` — both produce the
 * DATA_SYSTEM_PROMPT + tuning catalogue + termBlock + runtimeBlock +
 * pageBlock + featureCatalogueBlock + baseContext + ticket block. The
 * ONLY runtime difference for COURSE_MANAGE was the tool-palette filter
 * (`COURSE_MANAGE_TOOLS`) at the route.ts layer, NOT the prompt itself.
 *
 * In Slice 1 the spike exposes the full `ADMIN_TOOLS` palette and relies
 * on prompt-level intent signals + the model's self-narrowing to keep
 * course-scoped chats from drifting into cross-tenant writes. The 6
 * promptfoo scenarios pin this assumption.
 *
 * ## What this builder does NOT do
 *
 * - Does NOT change the factual-grounding intercept. The intercept fires
 *   structurally on tool_use names in the turn — same code path, regardless
 *   of which builder produced the system prompt.
 * - Does NOT change the UI (tabs still render in this slice — Assistant /
 *   Tuning / Course / Demo are now visual aliases for two backend paths;
 *   tab consolidation lands in Slice 3).
 * - Does NOT touch DEMO / CALL / BUG / WIZARD / COURSE_REF modes — those
 *   keep their own builders unchanged.
 *
 * @see `app/api/chat/system-prompts.ts` — now CALL + BUG only after the
 *      Slice 2 collapse
 * @see `app/api/chat/factual-grounding-intercept.ts` — paired structural
 *      backstop (unchanged)
 * @see `docs/decisions/2026-06-11-chat-mode-collapse-spike.md` — ADR
 */

import { buildTuningSystemPrompt, type TuningScope } from "@/lib/chat/tuning-system-prompt";
import { resolveTerminology, TECHNICAL_TERMS, type TermMap } from "@/lib/terminology";
import { loadTicketContext, loadRecentTicketsDigest } from "@/lib/chat/ticket-context";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";
import { buildPageContextBlock, type PageContextHint } from "@/app/api/chat/page-context";
import { buildPageFeatureCatalogue } from "@/lib/chat/page-feature-catalogue";

export interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

export interface BuildUnifiedAssistantPromptInput {
  /** Active breadcrumbs from `EntityContext` (caller / playbook / domain / …). */
  entityContext: EntityBreadcrumb[];
  /**
   * The user's active tuning scope toggle, when set. Surfaced to the
   * model as an Active Tuning Scope block (via the embedded tuning
   * builder) — in the unified surface this becomes an *intent signal*
   * rather than a mode gate. `null` / `undefined` means "no toggle yet
   * — ask the educator before writing a behaviour target."
   */
  tuningScope?: TuningScope | null;
  /**
   * The user's role label. Used to (a) compute terminology and (b)
   * include in the runtime-context block.
   */
  userRole?: string;
  /** The session's institution id — for terminology resolution. */
  institutionId?: string | null;
  /** #809 page context preamble (page / activeTab / visibleSections / courseSnapshot). */
  pageContext?: PageContextHint;
  /** #733 / #812 — the route the user is currently on (for catalogue + feedback hint). */
  pageHintRoute?: string;
  /** #727 — the active feedback ticket id, when the user clicked "Discuss with AI". */
  discussionTicketId?: string;
  /** Required when `discussionTicketId` is set — for institution-scope guard. */
  sessionUserId?: string;
}

export interface UnifiedAssistantPromptResult {
  prompt: string;
}

/**
 * Default DATA_SYSTEM_PROMPT body — kept identical to the legacy version in
 * `system-prompts.ts` so the spec-fetcher fallback returns the same baseline
 * either way. The seed JSON for `config.specs.chatDataHelper` carries the
 * canonical version; this constant only fires when the spec is missing
 * (cold-start, fresh DB, etc.).
 */
const DATA_SYSTEM_PROMPT_FALLBACK = `You are a DATA HELPER for the HumanFirst Admin application.

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

## Learner-scoped facts grounding contract

Any claim about a specific learner's enrollment, active course, voice configuration, progress, or goal state MUST be sourced from a tool call (\`get_caller_detail\`, \`get_voice_config\`, or another grounding tool) made in the CURRENT turn.

Inferring from \`courseSnapshot\`, the system overview block, or conversation history is **not permitted**. The course snapshot describes only the COURSE the operator is viewing — never a specific learner's enrollment. The system overview lists the full course catalogue — never any caller's actual enrollment.

If you have not yet called a grounding tool this turn:
- For "what course is <caller> on?" / "what voice does <caller> hear?" / "what's <caller>'s progress?" — call \`get_caller_detail\` first.
- If you can't or won't call the tool — say "I'd need to look that up — shall I call get_caller_detail?" Do not assert the fact.`;

/**
 * Detect which "intent" the current request is biased toward, based on
 * breadcrumb shape + page context + tuning scope. This is the spike's
 * one new building block — the routing-hint block fed to the model so it
 * self-narrows its tool selection.
 *
 * Order matters: when MULTIPLE intents apply (e.g. an educator is on a
 * Course page AND has tuningScope=LEARNER set), all relevant hints are
 * concatenated so the model sees the full layered intent.
 *
 * Exported for use by the test harness — the assertions check that the
 * routing block contains the right hint for each scenario.
 */
export interface IntentSignals {
  hasCourseInScope: boolean;
  hasLearnerInScope: boolean;
  tuningIntent: "explicit-learner" | "explicit-course" | "unset";
  onCoursePage: boolean;
  onLearnerPage: boolean;
}

export function deriveIntentSignals(input: BuildUnifiedAssistantPromptInput): IntentSignals {
  const playbookCrumb = input.entityContext?.find((e) => e.type === "playbook");
  const callerCrumb = input.entityContext?.find((e) => e.type === "caller");
  const tuning = input.tuningScope;

  let tuningIntent: IntentSignals["tuningIntent"] = "unset";
  if (tuning === "LEARNER") tuningIntent = "explicit-learner";
  else if (tuning === "PLAYBOOK") tuningIntent = "explicit-course";

  const page = input.pageContext?.page;
  const onCoursePage = page === "course" || input.pageHintRoute?.startsWith("/x/courses/") === true;
  const onLearnerPage =
    page === "caller" ||
    input.pageHintRoute?.startsWith("/x/callers/") === true ||
    input.pageHintRoute?.startsWith("/x/student/") === true;

  return {
    hasCourseInScope: Boolean(playbookCrumb) || onCoursePage,
    hasLearnerInScope: Boolean(callerCrumb) || onLearnerPage,
    tuningIntent,
    onCoursePage,
    onLearnerPage,
  };
}

/**
 * Render the intent-routing hint block. The model still sees the full
 * `ADMIN_TOOLS` palette in the tools array — this block tells it which
 * subset of tools is most likely to be relevant for the current turn,
 * given the operator's page + scope + breadcrumb context.
 *
 * Empty string when no signals are active (e.g. fresh chat with no
 * breadcrumb) — falls back on the model's default reasoning.
 */
export function buildIntentRoutingBlock(signals: IntentSignals): string {
  const lines: string[] = [];

  if (signals.onCoursePage || signals.hasCourseInScope) {
    lines.push(
      "- The user is in a **course-scoped** context. Prefer course-edit tools (`update_playbook_config`, `update_curriculum_module`, `update_learning_objective`, `update_assertion_lo_link`, `replace_lesson_plan`, `recompose_caller_prompt`, `get_playbook_config`, `list_curriculum_modules`). Do NOT call cross-tenant tools (`query_specs`, `query_callers`, `get_domain_info`) unless the user explicitly asks.",
    );
  }

  if (signals.tuningIntent === "explicit-learner") {
    lines.push(
      "- The user has the **Learner-tuning** scope active. Prefer `update_behavior_target` with `scope: \"LEARNER\"` for behaviour-shaping requests. The active caller's UUID is in the entity context.",
    );
  } else if (signals.tuningIntent === "explicit-course") {
    lines.push(
      "- The user has the **Course-tuning** scope active. Prefer `update_behavior_target` with `scope: \"PLAYBOOK\"` for behaviour-shaping requests. The active playbook's UUID is in the entity context.",
    );
  }

  if (signals.onLearnerPage || signals.hasLearnerInScope) {
    lines.push(
      "- The user is in a **learner-scoped** context. Prefer learner-read tools (`get_caller_detail`, `list_goals_for_caller`, `list_caller_memories`) and learner-write tools (`update_caller`, `update_behavior_target` with `scope: \"LEARNER\"`, `recompose_caller_prompt`). Course-edit tools (`update_playbook_config`, `update_curriculum_module`, etc.) WILL affect this learner's whole cohort — confirm before calling them.",
    );
  }

  if (lines.length === 0) {
    // No breadcrumb, no scope, no page hint — the model is free to roam.
    // We still emit the header so the prompt diff is one-block-wide stable
    // across requests, but the body is a single explanatory note.
    lines.push(
      "- No specific entity is in scope. Use `query_callers` / `query_specs` / `get_domain_info` to find what the user is asking about before making any changes.",
    );
  }

  return `\n\n## Intent routing (spike: unified Assistant)\n\nThe tool palette below covers the full admin surface. Use these signals to self-narrow:\n\n${lines.join("\n")}\n\n**The signals are HINTS — not gates.** If the user explicitly asks for something outside the current scope (e.g. "show me a different course's curriculum"), follow the explicit request. The signals exist to prevent accidental cross-scope writes when the request is ambiguous.`;
}

/**
 * Compose the unified Assistant system prompt. Wired into `route.ts` as
 * the default for DATA / TUNING / COURSE_MANAGE since #1504 Slice 2.
 *
 * The shape mirrors the legacy DATA branch so the differences are
 * isolated to:
 *   - The DATA prompt is unconditionally fetched (no mode gate)
 *   - The tuning catalogue is unconditionally injected (was only when
 *     mode in {DATA, TUNING})
 *   - A new intent-routing block is appended before the entity context
 *
 * Everything else (terminology, runtime, page, feature catalogue, entity,
 * ticket, feedback hint) is identical to the legacy DATA branch.
 */
export async function buildUnifiedAssistantPrompt(
  input: BuildUnifiedAssistantPromptInput,
): Promise<UnifiedAssistantPromptResult> {
  const terms: TermMap = await resolveTerminology(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input.userRole as any) || "ADMIN",
    input.institutionId ?? null,
  );
  const termBlock = buildTerminologyBlock(terms);
  const runtimeBlock = buildRuntimeContextBlock(input.userRole, input.pageHintRoute);

  // Layer 1 — DATA prompt body (catalogue + grounding contract). Falls
  // back to the inline constant if the spec is missing from the DB.
  const dataPrompt = await getPromptSpec(config.specs.chatDataHelper, DATA_SYSTEM_PROMPT_FALLBACK);

  // Layer 2 — Tuning catalogue + truthfulness rules. Carried IN even when
  // tuningScope is unset, because the unified surface exposes the tools.
  // When scope is null/undefined, the embedded tuning prompt emits a
  // "no scope picked yet" header that asks the user to choose before any
  // behaviour-target write.
  const tuningContext = await buildTuningSystemPrompt({
    entityContext: input.entityContext,
    tuningScope: input.tuningScope ?? undefined,
  });

  // Layer 3 — Intent routing block (the spike's new piece).
  const signals = deriveIntentSignals(input);
  const intentBlock = buildIntentRoutingBlock(signals);

  // Layer 4 — Page context preamble (same as DATA branch).
  const pageBlock = buildPageContextBlock(input.pageContext);

  // Layer 5 — Feature catalogue (what's on this page).
  const featureCatalogueBlock = buildPageFeatureCatalogue(input.pageHintRoute);

  // Layer 6 — Entity context — large block with caller / playbook / domain
  // snapshot. The `system-prompts.ts::buildEntityContext` is internal to
  // that module; we reuse the public surface by importing through the
  // chat route's existing call path. To keep this builder self-contained
  // we inline a lightweight equivalent (system overview + per-crumb
  // snapshot) — same shape, same labels.
  const baseContext = await buildUnifiedEntityContext(input.entityContext);

  // Layer 7 — Ticket + feedback-list hints.
  const ticketBlock = await buildTicketDiscussionBlock(input);
  const listHintBlock = await buildFeedbackListHintBlock(input);

  const prompt =
    dataPrompt +
    "\n\n" +
    tuningContext +
    intentBlock +
    termBlock +
    runtimeBlock +
    pageBlock +
    featureCatalogueBlock +
    `\n\n${baseContext}` +
    ticketBlock +
    listHintBlock;

  return { prompt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — same shape as `system-prompts.ts`, repeated here so the
// unified builder is self-contained while the flag is OFF by default. When
// Slice 2 makes the flag the default, these helpers move out of system-
// prompts.ts and this duplication disappears.
// ─────────────────────────────────────────────────────────────────────────────

function buildTerminologyBlock(terms: TermMap): string {
  const isDifferent = Object.keys(terms).some(
    (k) => terms[k as keyof TermMap] !== TECHNICAL_TERMS[k as keyof TermMap],
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

function buildRuntimeContextBlock(
  userRole: string | undefined,
  pageHintRoute: string | undefined,
): string {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "unknown";
  const envLabel = process.env.NEXT_PUBLIC_APP_ENV || "SANDBOX";
  const dbTarget = process.env.NEXT_PUBLIC_DB_TARGET;
  const lines = [
    `- App version: ${version}`,
    `- Environment: ${envLabel}`,
  ];
  if (dbTarget) lines.push(`- DB target (sandbox VM switched): ${dbTarget}`);
  if (pageHintRoute) lines.push(`- User's current route: ${pageHintRoute}`);
  if (userRole) lines.push(`- User role: ${userRole}`);
  return `\n\n## Runtime context\n${lines.join("\n")}`;
}

/**
 * Lightweight inline entity-context block. Mirrors the public behaviour of
 * `system-prompts.ts::buildEntityContext` for the spike — same labels, same
 * absence-line, but without the heavy per-crumb DB lookups (those return
 * the same data the AI already gets via the DATA tools, and during the
 * spike we want to confirm the model self-narrows correctly without a
 * pre-loaded snapshot of every entity).
 *
 * Slice 2 either merges this with the original via a shared helper or
 * keeps the unified builder calling the original directly. The choice
 * depends on what the 6 promptfoo scenarios show.
 */
async function buildUnifiedEntityContext(breadcrumbs: EntityBreadcrumb[]): Promise<string> {
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return "## Current Context\n\n_No specific entity selected. The user can navigate to a caller, playbook, or spec for detailed context._";
  }
  const lines: string[] = ["## Current Context"];
  for (const crumb of breadcrumbs) {
    lines.push(`- **${crumb.type}:** ${crumb.label} (\`id = ${crumb.id}\`)`);
  }
  lines.push(
    "",
    "_Detailed snapshots for these entities are available via tool calls (`get_caller_detail`, `get_playbook_config`, `get_domain_info`, etc.). The unified Assistant prefers tool lookups over a pre-loaded snapshot so claims about specific entities are always grounded in a same-turn tool call._",
  );
  return lines.join("\n");
}

async function buildTicketDiscussionBlock(input: BuildUnifiedAssistantPromptInput): Promise<string> {
  if (!input.discussionTicketId || !input.sessionUserId) return "";
  const result = await loadTicketContext({
    ticketId: input.discussionTicketId,
    sessionUserId: input.sessionUserId,
    sessionInstitutionId: input.institutionId ?? null,
    isSuperadmin: input.userRole === "SUPERADMIN",
    canSeeInternalComments:
      input.userRole === "OPERATOR" ||
      input.userRole === "ADMIN" ||
      input.userRole === "SUPERADMIN",
  });
  if (!result.ok) return "";
  return `\n\n${result.block}`;
}

async function buildFeedbackListHintBlock(input: BuildUnifiedAssistantPromptInput): Promise<string> {
  if (!input.pageHintRoute || input.pageHintRoute !== "/x/feedback") return "";
  if (input.discussionTicketId) return "";
  const block = await loadRecentTicketsDigest(
    input.institutionId ?? null,
    input.userRole === "SUPERADMIN",
    5,
  );
  return `\n\n${block}`;
}

// #1504 Slice 2 — `isUnifiedAssistantEnabled()` removed (the unified path is
// now the default for DATA / TUNING / COURSE_MANAGE). The Slice 1 spike
// kept it as `process.env.HF_FLAG_UNIFIED_ASSISTANT === "true"`; with the
// route handler no longer reading the flag, the helper is dead code.
