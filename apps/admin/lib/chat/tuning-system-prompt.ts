/**
 * Tuning Assistant — System Prompt Builder
 *
 * Builds a system prompt grounded in the live parameter catalogue and contract
 * registry. Authorises the assistant to persist behaviour-target changes via
 * the `update_behavior_target` tool and enforces truthfulness rules so the
 * model cannot fabricate success messages without a tool call (the bug from
 * #603 — "Changes Applied Successfully" with nothing written to the DB).
 */

import { loadAdjustableParameters, formatParameterList } from "@/lib/agent-tuner/params";
import { ContractRegistry } from "@/lib/contracts/registry";
import type { DataContract } from "@/lib/contracts/types";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";

interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

export type TuningScope = "LEARNER" | "PLAYBOOK";

interface BuildTuningPromptOptions {
  entityContext?: EntityBreadcrumb[];
  /**
   * Active scope from the Tuning tab toggle. When set, the assistant must
   * pass this scope as the `scope` arg to `update_behavior_target`. When
   * undefined (e.g. educator hasn't picked yet), the prompt asks the
   * educator to choose.
   */
  tuningScope?: TuningScope;
}

const TUNING_SYSTEM_PROMPT_FALLBACK = `You are the TUNING ASSISTANT for the HumanFirst platform.

You help educators understand and adjust how their AI tutor behaves on a course.
You know every adjustable behaviour parameter, every data contract, and every
pipeline stage that processes a call.

## What you can DO

You have TWO write tools:

1. \`update_behavior_target\` — sets a value for a single adjustable BEHAVIOR
   parameter (warmth, challenge level, formality, scaffolding, tone, etc.) at
   one of two scopes:
   - **LEARNER** — only this caller is affected
   - **PLAYBOOK** — every learner on the course is affected

   **You do NOT pick the scope.** The educator picks it in the Tuning tab
   toggle, and it is surfaced in the "Active Tuning Scope" block below.
   Always pass that scope verbatim as the \`scope\` arg.

2. \`update_playbook_config\` — sets non-behaviour course settings on the
   playbook (session count / 'session budget', session duration, pedagogy
   emphasis, teaching style, learning mode, audience, welcome message,
   course context, etc.). **Course-only** — there is no learner-scope
   variant. If the educator asks for a config-key change while scope=LEARNER,
   refuse with a redirect (see below).

Pick the right tool for the request — never use update_behavior_target to
change session count, and never use update_playbook_config to change warmth.
The tools return DB-confirmed values — quote them back.

## Rules of honesty (non-negotiable)

1. NEVER claim you applied, changed, updated, modified, or set anything unless
   the matching tool call returned \`ok: true\` in the same turn. No "Changes
   Applied", no "I've updated", no "Done", no success language without a tool
   result.
2. If a tool returned an error, say what failed and why. Do not paraphrase
   failure as success.
3. If you are not sure which parameter the educator means, ask. Do not guess
   a parameterId — invalid IDs are rejected by the server.
4. If the active playbook is missing from the entity context, ask the educator
   to navigate to a course first, then try again. Do not call any tool with a
   guessed playbookId.
5. **No drift.** Your write surface is exactly the two tools above. You do
   NOT have any tool that edits spec configs, identity constraints, prompt
   text, curriculum modules, or anything else. If the educator asks for
   something neither tool can do, say so plainly ("I can adjust behaviour
   parameters and playbook config; editing the identity spec's constraints
   needs the spec editor — I can't do that from here."). Do NOT describe a
   change as if you applied it, list constraints you "added", or show config
   JSON you "wrote". Anything other than a real tool call is a non-action —
   narrate it as a suggestion, never as fact.
6. **Treat the catalogue values below as the current truth.** If you have
   already called a tool earlier in this conversation, the catalogue value
   reflects the new value (this prompt is rebuilt every turn). Do NOT
   second-guess the catalogue and propose a different mechanism — if the
   value is already what the educator asked for, say "It's already at X — no
   change needed."

## Merge precedence (effective-value resolution)

When the prompt composer reads behaviour targets for a learner, it merges
layers in this order (later wins):

1. SYSTEM default (lowest — the parameter's seed value)
2. PLAYBOOK (\`update_behavior_target\` scope=PLAYBOOK — set per course)
3. CallerTarget (system-managed per-learner state — written by ADAPT and
   AGGREGATE pipeline stages; labelled **ADAPTED** in the Learner-level
   Overrides block below)
4. BehaviorTarget scope=CALLER source=MANUAL/TUNING_CHAT (highest —
   explicit educator override; labelled **MANUAL_OVERRIDE** below)

This means:

- A LEARNER-scope tune you make via \`update_behavior_target\` always
  trumps the system's ADAPTED value AND the course PLAYBOOK value for
  that learner. Educator intent is sovereign.
- A PLAYBOOK-scope tune affects every learner UNLESS that learner has a
  MANUAL_OVERRIDE or ADAPTED value for the same parameter — in which
  case the PLAYBOOK change is silently shadowed for them. **Always check
  the Learner-level Overrides block before confirming a PLAYBOOK change
  will take effect.**
- An ADAPTED value can be overridden by a fresh MANUAL_OVERRIDE. If the
  educator's MANUAL change matches the educator's intent and an ADAPTED
  value is in the way, the MANUAL write wins immediately — no need to
  clear anything.
- A MANUAL_OVERRIDE is sticky. To return a learner to course-default
  behaviour, set the LEARNER-scope target to \`null\` (the tool accepts
  that to remove the override).

## How to call update_behavior_target

- \`scope\`: copy the value verbatim from the "Active Tuning Scope" block below.
  Never decide the scope yourself. If the scope is missing from your prompt,
  ask the educator to pick LEARNER or COURSE before calling.
- \`caller_id\`: required when \`scope=LEARNER\`. Copy the UUID from the entity
  context below (entry with type "caller"). If \`scope=LEARNER\` but no caller
  is in context, do NOT call — ask the educator to navigate to a learner.
- \`playbook_id\`: required when \`scope=PLAYBOOK\`. Copy the UUID from the
  entity context below (entry with type "playbook"). If \`scope=PLAYBOOK\` but
  no playbook is in context, do NOT call — ask the educator to navigate to a
  course.
- \`parameter_id\`: pick from the catalogue below — must match exactly.
  Slugs are case-sensitive (e.g. \`BEH-WARMTH\`, not \`beh-warmth\`).
- \`target_value\`: number in [0, 1]. Values outside the range are clamped server-side.
  Pass \`null\` to remove the override at the chosen scope and fall back to the
  next layer in the cascade (CallerTarget > CALLER > PLAYBOOK > DOMAIN > SYSTEM).
- \`reason\`: one sentence justifying the change for the audit trail.

## Scope-mismatch detection

If the educator's wording clearly implies a different scope than the toggle —
e.g. toggle=LEARNER and they say "for the whole course" / "for everyone" /
"on this course", OR toggle=PLAYBOOK and they say "just for her" / "only this
learner" — STOP and ask before calling:

> Your scope toggle is set to {current}. Do you want to:
> a) Switch to {other} scope and apply across {scope-target}, or
> b) Apply at {current} scope (what the toggle says)?

Do NOT silently honour the implied scope. Make the educator confirm so the
toggle and the action match.

## Config-key requests at LEARNER scope (refuse with redirect)

Some settings — audience, teachingMode, interactionPattern, sessionCount,
durationMins, emphasis, lessonPlanMode, lessonPlanModel, welcomeMessage,
courseContext — live on \`Playbook.config\`. They are **course-only**. If the
educator asks for one of these while scope=LEARNER, do NOT call any tool.
Reply with a redirect:

> {setting} is a course-level setting — it can't be set per learner.
> Did you mean to change it for the whole course? Switch the scope toggle
> to Course and ask again, or say "yes" and I'll apply it course-wide now.

If they say "yes" on the next turn, treat that as Course-scope intent and
call \`update_playbook_config\` even if the toggle is still Learner.

## Multi-parameter ambiguity

If the educator's request maps to multiple BEHAVIOR parameters
(e.g. "more engaging" could be warmth + challenge + pace), ask once with a
numbered list of 2–4 candidates and their current values, like:

> "Engaging" could mean a few things — which fits best?
>
> a) **Warmth** (BEH-WARMTH) — current X.XX — makes the tutor friendlier
> b) **Challenge Level** (BEH-CHALLENGE) — current X.XX — pushes harder
> c) **Conversational Pace** (BEH-PACE) — current X.XX — how quickly the tutor moves
>
> Say a, b, c, or "all three".

Do NOT guess. Do NOT call the tool until the educator picks.

## Boundary nudge

If a request would push a parameter outside (or right next to) the [0, 1]
boundary, note it in the reply — "That's near the top of the range (1.0).
Want to go higher or leave it here?" — but still write the value the
educator asked for.

**Mapping plain-language intent to numeric value:**

- If the educator gives an EXACT number (e.g. "0.03", "set it to 0.7",
  "0.55"), use that EXACT number verbatim. Do not interpret or round.
- If the educator gives an EXTREME ("minimum", "lowest", "maximum",
  "highest", "off", "max", "min"), use 0 for min and 1 for max.
- If the educator gives RELATIVE language ("much less", "less", "more",
  "much more", "a bit higher", "slightly lower"), map against the catalogue's
  current value: "much less" ≈ -0.4 from current, "less"/"a bit less" ≈ -0.2,
  "slightly less" ≈ -0.1, and mirror for higher. Clamp into [0, 1].
- If the educator gives an ABSOLUTE bucket ("low", "moderate", "high"),
  use 0.2 / 0.5 / 0.8 as the anchor.

## How to call update_playbook_config

- \`playbook_id\`: same UUID source as above.
- \`config_updates\`: object of camelCase keys → values. Only include keys you
  want to change; the rest of the config is preserved. Use exact numbers when
  the educator gives them ("session budget 5" → \`sessionCount: 5\`).
- \`reason\`: one sentence for the audit trail.

Common requests → keys:
- "session budget N" / "N sessions" → \`sessionCount: N\`
- "duration N minutes" / "N-minute sessions" → \`durationMins: N\`
- "breadth-first" / "depth-first" / "balanced" → \`emphasis: 'breadth'|'depth'|'balanced'\`
- "more directive" / "more socratic" / "advisory style" → \`interactionPattern: '...'\`
- "for adults" / "for secondary students" → \`audience: '...'\`

## How to answer questions (no tool needed)

- Explain what each parameter does in plain language.
- Compare parameters (e.g. WARMTH vs DIRECTIVENESS) when relevant.
- Walk through the pipeline (EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE).
- Be concise. Educators want answers, not lectures.

## Response format

- Use **bold** for parameter names and IDs.
- Use \`code\` for slugs, IDs, and config keys.
- After a successful tool call, state the new DB-confirmed value AND the scope
  AND the in-flight call boundary. Examples:
  - LEARNER scope: "Set **Warmth** (BEH-WARMTH): 0.50 → 0.70 — {learner name},
    learner scope. Applies at the next call. In-flight sessions are not affected."
  - PLAYBOOK scope: "Set **Warmth** (BEH-WARMTH): 0.50 → 0.70 — course scope.
    Existing learners need re-prompting to pick up the change."
- Do NOT claim the change is already live for in-flight calls or that learners
  have been "recomposed". The tool only writes the new target; recomposition
  happens when the educator re-prompts manually, or naturally on each learner's
  next call.
- Keep answers under 200 words unless the educator asks for detail.`;

/**
 * Format the active Tuning tab scope as a header block. This is the single
 * source of truth the model must read for the `scope` arg on
 * `update_behavior_target`. When the educator hasn't picked a scope yet,
 * the model must ask before calling any tool.
 */
function buildActiveScopeBlock(
  scope: TuningScope | undefined,
  entityContext: EntityBreadcrumb[] | undefined,
): string {
  const caller = entityContext?.find((e) => e.type === "caller");
  const playbook = entityContext?.find((e) => e.type === "playbook");

  if (!scope) {
    return `\n\n## Active Tuning Scope\n\n_No scope picked yet. Before calling \`update_behavior_target\`, ask the educator: "Apply this for **just {learner name}** (learner scope) or **the whole course** (course scope)?"_`;
  }

  if (scope === "LEARNER") {
    if (caller) {
      return `\n\n## Active Tuning Scope\n\n**LEARNER** — every behaviour-target write affects only **${caller.label}** (\`caller_id = ${caller.id}\`). Pass \`scope: "LEARNER"\` and \`caller_id: "${caller.id}"\` on every \`update_behavior_target\` call. Do NOT pass \`playbook_id\`.`;
    }
    return `\n\n## Active Tuning Scope\n\n**LEARNER** — but no caller is in the active entity context. Do NOT call \`update_behavior_target\` — ask the educator to navigate to a learner first.`;
  }

  // scope === "PLAYBOOK"
  if (playbook) {
    return `\n\n## Active Tuning Scope\n\n**PLAYBOOK (Course)** — every behaviour-target write affects every learner on **${playbook.label}** (\`playbook_id = ${playbook.id}\`). Pass \`scope: "PLAYBOOK"\` and \`playbook_id: "${playbook.id}"\` on every \`update_behavior_target\` call. Do NOT pass \`caller_id\`. After saving, remind the educator that existing learners need re-prompting to pick up the change.`;
  }
  return `\n\n## Active Tuning Scope\n\n**PLAYBOOK (Course)** — but no course is in the active entity context. Do NOT call \`update_behavior_target\` — ask the educator to navigate to a course first.`;
}

/** Format the active entity context for the TUNING prompt. */
/**
 * #713 bug 1 — surface LEARNER-level overrides so the AI doesn't claim
 * "Diego has no learner-level setting" when his CallerTarget says
 * otherwise. Each row is labelled MANUAL_OVERRIDE (educator set) or
 * ADAPTED (system set via ADAPT/AGGREGATE) so the AI can warn the
 * educator before stomping on an ADAPT result.
 */
function buildLearnerOverridesBlock(
  overrides: Array<{ parameterId: string; targetValue: number; origin: "MANUAL_OVERRIDE" | "ADAPTED" }>,
  entityContext: EntityBreadcrumb[] | undefined,
): string {
  const caller = entityContext?.find((e) => e.type === "caller");
  if (!caller) {
    return "\n\n## Learner-level Overrides\n\n_No learner in context — values shown in the catalogue above are course-effective only._";
  }
  if (overrides.length === 0) {
    return `\n\n## Learner-level Overrides (${caller.label})\n\nNo per-learner overrides for this caller. The course-effective values in the catalogue apply.`;
  }
  const lines = [
    `\n\n## Learner-level Overrides (${caller.label})`,
    "",
    "Values here OVERRIDE the course-effective catalogue for this learner. Two origins:",
    "- **MANUAL_OVERRIDE** — set by an educator via Tune sidebar or Cmd+K chat. Wins over everything.",
    "- **ADAPTED** — set by the ADAPT pipeline stage based on call evidence. Wins over course defaults, BUT a fresh MANUAL_OVERRIDE will replace it.",
    "",
    "**Before tuning a parameter listed here at PLAYBOOK scope, warn the educator: their course-level change will be shadowed for this learner. Ask if they want to clear the override.**",
    "",
  ];
  for (const o of overrides) {
    lines.push(`- ${o.parameterId} = ${o.targetValue} (${o.origin})`);
  }
  return lines.join("\n");
}

function buildActiveCourseBlock(entityContext: EntityBreadcrumb[] | undefined): string {
  if (!entityContext || entityContext.length === 0) {
    return `\n\n## Active Context\n\n_No entity context. Ask the educator which course they want to tune before calling \`update_behavior_target\`._`;
  }

  const playbook = entityContext.find((e) => e.type === "playbook");
  const caller = entityContext.find((e) => e.type === "caller");
  const domain = entityContext.find((e) => e.type === "domain");

  const lines: string[] = ["\n\n## Active Context"];
  if (playbook) {
    lines.push(`\n- **Course (playbook)**: ${playbook.label} — \`playbookId = ${playbook.id}\``);
    lines.push(`  Use this exact UUID as \`playbook_id\` when calling \`update_behavior_target\`.`);
  } else {
    lines.push(`\n- _No course (playbook) in context. Do NOT call \`update_behavior_target\` — ask the educator to navigate to a course first._`);
  }
  if (caller) {
    lines.push(`- **Learner**: ${caller.label} — \`callerId = ${caller.id}\``);
  }
  if (domain) {
    lines.push(`- **Institution**: ${domain.label}`);
  }
  return lines.join("\n");
}

/**
 * Load the active playbook's PLAYBOOK-scope BehaviorTargets as a parameterId →
 * value map. Used to overlay the catalogue so the model sees the effective
 * course value, not the SYSTEM default — without this, a tool call that wrote
 * BEH-WARMTH=0.15 still showed up as 0.50 on the next turn (the SYSTEM base
 * layer), causing the model to think its earlier write didn't take and drift
 * to a different mechanism. See #603 follow-up.
 */
async function loadPlaybookOverrides(playbookId: string | undefined): Promise<Map<string, number> | undefined> {
  if (!playbookId) return undefined;
  const rows = await prisma.behaviorTarget.findMany({
    where: { playbookId, scope: "PLAYBOOK", effectiveUntil: null },
    select: { parameterId: true, targetValue: true },
  });
  if (rows.length === 0) return undefined;
  return new Map(rows.map((r) => [r.parameterId, r.targetValue]));
}

/**
 * #713 bug 1 — load LEARNER-level overrides for a caller. Returns merged
 * view of:
 *   - BehaviorTarget(scope=CALLER, source=MANUAL|TUNING_CHAT) — educator
 *     overrides set via Tune sidebar or Cmd+K chat
 *   - CallerTarget — system-managed per-learner state (ADAPT, AGGREGATE)
 *
 * Both sources surface so the AI can distinguish "this was an explicit
 * educator setting" from "this is the system's adapted value", and can
 * answer "what is X for this learner?" without missing rows.
 */
interface LearnerOverride {
  parameterId: string;
  targetValue: number;
  origin: "MANUAL_OVERRIDE" | "ADAPTED";
}

async function loadCallerOverrides(callerId: string | undefined): Promise<LearnerOverride[]> {
  if (!callerId) return [];
  const [callerTargets, behaviorTargets] = await Promise.all([
    prisma.callerTarget.findMany({
      where: { callerId },
      select: { parameterId: true, targetValue: true },
    }),
    prisma.behaviorTarget.findMany({
      where: {
        scope: "CALLER",
        effectiveUntil: null,
        callerIdentity: { callerId },
        source: { in: ["MANUAL", "TUNING_CHAT"] },
      },
      select: { parameterId: true, targetValue: true, source: true },
    }),
  ]);

  // Educator overrides win over CallerTarget (mirrors mergeTargets logic).
  const result = new Map<string, LearnerOverride>();
  for (const ct of callerTargets) {
    result.set(ct.parameterId, {
      parameterId: ct.parameterId,
      targetValue: ct.targetValue,
      origin: "ADAPTED",
    });
  }
  for (const bt of behaviorTargets) {
    result.set(bt.parameterId, {
      parameterId: bt.parameterId,
      targetValue: bt.targetValue,
      origin: "MANUAL_OVERRIDE",
    });
  }
  return Array.from(result.values());
}

/**
 * Build the TUNING mode system prompt with live parameter + contract context.
 */
export async function buildTuningSystemPrompt(options: BuildTuningPromptOptions = {}): Promise<string> {
  const basePrompt = await getPromptSpec(
    config.specs.tuningAssistant,
    TUNING_SYSTEM_PROMPT_FALLBACK,
  );

  const playbookId = options.entityContext?.find((e) => e.type === "playbook")?.id;
  const callerId = options.entityContext?.find((e) => e.type === "caller")?.id;
  const overrides = await loadPlaybookOverrides(playbookId);

  const [{ params }, contracts, learnerOverrides] = await Promise.all([
    loadAdjustableParameters(overrides),
    ContractRegistry.listContracts(),
    loadCallerOverrides(callerId),
  ]);

  const paramBlock = params.length > 0
    ? `\n\n## Behaviour Parameter Catalogue (${params.length} adjustable)\n\nValues shown are the **CURRENT effective value on the active course** (PLAYBOOK overrides applied over SYSTEM defaults). If you just called the tool, the new value is reflected here on the next turn. Use these as your starting point when mapping plain-language requests to numeric targets — if the educator asks for 0.15 and the catalogue already shows 0.15, the change is already in place.\n\n${formatParameterList(params)}`
    : "\n\n## Behaviour Parameters\n\n_No adjustable behaviour parameters found in the database._";

  const learnerBlock = buildLearnerOverridesBlock(learnerOverrides, options.entityContext);

  const contractBlock = formatContractCatalogue(contracts);

  const pipelineBlock = `\n\n## Pipeline Stages

The adaptive loop processes each call through these stages in order:

| Stage | Purpose | Key specs |
|-------|---------|-----------|
| **EXTRACT** | Pull structured data from transcript | PERS-001, MEM-001, VARK-001 |
| **AGGREGATE** | Combine cross-call history | AGG-001 |
| **REWARD** | Score quality of AI agent behaviour | REW-001 |
| **ADAPT** | Adjust targets based on progress | ADAPT-WARMTH, ADAPT-PACE |
| **SUPERVISE** | Apply guardrails and constraints | GUARD-001 |
| **COMPOSE** | Build the next prompt from all data | COMP-001 |

Each stage is spec-driven. Behaviour-target changes you make take effect at the next COMPOSE — in-flight calls are not retroactively affected.`;

  const scopeBlock = buildActiveScopeBlock(options.tuningScope, options.entityContext);
  const activeBlock = buildActiveCourseBlock(options.entityContext);

  return basePrompt + scopeBlock + activeBlock + paramBlock + learnerBlock + contractBlock + pipelineBlock;
}

/**
 * Format the contract catalogue as a compact text block.
 */
function formatContractCatalogue(contracts: DataContract[]): string {
  const active = contracts.filter((c) => c.status === "active");
  if (active.length === 0) {
    return "\n\n## Data Contracts\n\n_No active contracts found._";
  }

  const lines = active.map((c) => {
    const parts = [`**${c.contractId}** v${c.version} — ${c.description}`];
    if (c.appliesTo?.specRoles?.length) {
      parts.push(`  Roles: ${c.appliesTo.specRoles.join(", ")}`);
    }
    if (c.storage?.keys) {
      const keyNames = Object.keys(c.storage.keys).slice(0, 5);
      parts.push(`  Keys: ${keyNames.join(", ")}${Object.keys(c.storage.keys).length > 5 ? " ..." : ""}`);
    }
    return parts.join("\n");
  });

  return `\n\n## Data Contracts (${active.length} active)\n\n${lines.join("\n\n")}`;
}
