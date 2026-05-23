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

interface BuildTuningPromptOptions {
  entityContext?: EntityBreadcrumb[];
  /** #661 — Active scope from the Tuning tab's toggle. Pass-through from chat envelope. */
  tuningScope?: "LEARNER" | "PLAYBOOK";
}

const TUNING_SYSTEM_PROMPT_FALLBACK = `You are the TUNING ASSISTANT for the HumanFirst platform.

You help educators understand and adjust how their AI tutor behaves on a course.
You know every adjustable behaviour parameter, every data contract, and every
pipeline stage that processes a call.

## What you can DO

You have TWO write tools:

1. \`update_behavior_target\` — sets a playbook-level value for a single
   adjustable BEHAVIOR parameter (warmth, challenge level, formality,
   scaffolding, conversational tone, etc.). Use when the educator asks to
   change how the tutor BEHAVES.

2. \`update_playbook_config\` — sets non-behaviour course settings on the
   playbook (session count / 'session budget', session duration, pedagogy
   emphasis, teaching style, learning mode, audience, welcome message,
   course context, etc.). Use when the educator asks to change course
   STRUCTURE or top-level pedagogy. Pass camelCase keys in \`config_updates\`,
   e.g. \`{ sessionCount: 5, durationMins: 6 }\`.

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

## How to call update_behavior_target

- \`playbook_id\`: copy the UUID from the entity context block below
  (entry with type "playbook"). If there is no playbook in context, do NOT call.
- \`parameter_id\`: pick from the catalogue below — must match exactly.
  Slugs are case-sensitive (e.g. \`BEH-WARMTH\`, not \`beh-warmth\`).
- \`target_value\`: number in [0, 1]. Values outside the range are clamped server-side.
  Pass \`null\` to remove a playbook override and fall back to the system default.
- \`reason\`: one sentence justifying the change for the audit trail.

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
- After a successful tool call, state the new DB-confirmed value AND tell the
  educator that existing learners need re-prompting to pick up the change. E.g.
  "Set **Warmth** (BEH-WARMTH) to 0.40 on this course. Tuning saved — existing
  learners need re-prompting to pick up the change."
- Do NOT claim the change is already live for in-flight calls or that learners
  have been "recomposed". The tool only writes the new target; recomposition
  happens when the educator re-prompts manually, or naturally on each learner's
  next call.
- Keep answers under 200 words unless the educator asks for detail.`;

/** Format the active entity context for the TUNING prompt. */
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
 * Build the TUNING mode system prompt with live parameter + contract context.
 */
export async function buildTuningSystemPrompt(options: BuildTuningPromptOptions = {}): Promise<string> {
  const basePrompt = await getPromptSpec(
    config.specs.tuningAssistant,
    TUNING_SYSTEM_PROMPT_FALLBACK,
  );

  const playbookId = options.entityContext?.find((e) => e.type === "playbook")?.id;
  const overrides = await loadPlaybookOverrides(playbookId);

  const [{ params }, contracts] = await Promise.all([
    loadAdjustableParameters(overrides),
    ContractRegistry.listContracts(),
  ]);

  const paramBlock = params.length > 0
    ? `\n\n## Behaviour Parameter Catalogue (${params.length} adjustable)\n\nValues shown are the **CURRENT effective value on the active course** (PLAYBOOK overrides applied over SYSTEM defaults). If you just called the tool, the new value is reflected here on the next turn. Use these as your starting point when mapping plain-language requests to numeric targets — if the educator asks for 0.15 and the catalogue already shows 0.15, the change is already in place.\n\n${formatParameterList(params)}`
    : "\n\n## Behaviour Parameters\n\n_No adjustable behaviour parameters found in the database._";

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

  const activeBlock = buildActiveCourseBlock(options.entityContext);

  // #661 — Inject the active scope from the Tuning tab. The model MUST
  // read this from the prompt (never infer from chat history) and pass
  // `scope` arg to update_behavior_target on every call.
  const scopeBlock = buildScopeBlock(options.tuningScope, options.entityContext);

  return basePrompt + activeBlock + scopeBlock + paramBlock + contractBlock + pipelineBlock;
}

/**
 * #661 — Render the Active Tuning Scope block. Tells the model:
 *   - what scope to pass to update_behavior_target
 *   - which entity IDs are in context for each scope
 *   - what to do when scope=LEARNER but no caller is in context
 *   - how to handle config-key requests at LEARNER scope (refuse + redirect)
 */
function buildScopeBlock(
  scope: "LEARNER" | "PLAYBOOK" | undefined,
  entityContext: EntityBreadcrumb[] | undefined,
): string {
  const playbook = entityContext?.find((e) => e.type === "playbook");
  const caller = entityContext?.find((e) => e.type === "caller");
  const effective = scope ?? "PLAYBOOK";

  const lines: string[] = ["\n\n## Active Tuning Scope (read this every turn)"];
  lines.push("");
  lines.push(`Scope toggle: **${effective}**`);

  if (effective === "LEARNER") {
    if (caller) {
      lines.push(`Active learner: ${caller.label} (caller_id=${caller.id})`);
      lines.push("");
      lines.push("- When you call update_behavior_target, pass `scope: \"LEARNER\"` and `caller_id` from above.");
      lines.push("- DO NOT pass playbook_id when scope=LEARNER — it is ignored.");
      lines.push("- DO NOT call update_playbook_config at LEARNER scope. Config keys (sessionCount, audience, lessonPlanMode, etc.) are course-only by design. If the educator asks to change one at LEARNER scope, refuse and redirect:");
      lines.push('  > "{key} is a course-level setting — it can\'t be set per learner. Switch the scope toggle to Course and ask again, or say \\"yes\\" and I\'ll apply it at course scope now."');
    } else {
      lines.push("Active learner: **none in entity context**");
      lines.push("");
      lines.push("- The toggle is set to LEARNER but no caller is selected. DO NOT call update_behavior_target with scope=LEARNER — the tool will refuse.");
      lines.push("- Ask the educator to either navigate to a learner page first, or switch the scope toggle to Course (PLAYBOOK).");
    }
  } else {
    if (playbook) {
      lines.push(`Active course: ${playbook.label} (playbook_id=${playbook.id})`);
      lines.push("");
      lines.push("- When you call update_behavior_target, pass `scope: \"PLAYBOOK\"` and `playbook_id` from above.");
      lines.push("- DO NOT pass caller_id when scope=PLAYBOOK — it is ignored.");
      lines.push("- Course-scope writes affect every learner enrolled. Always include the line **\"Existing learners need re-prompting to pick up the change.\"** in your reply.");
    } else {
      lines.push("Active course: **none in entity context**");
      lines.push("");
      lines.push("- The toggle is set to PLAYBOOK but no course is selected. DO NOT call update_behavior_target — ask the educator to navigate to a course first.");
    }
  }

  lines.push("");
  lines.push("**Scope-mismatch handling:** if the educator's wording implies a different scope than the toggle (e.g. toggle=LEARNER but they say \"for the whole course\"), ASK before writing:");
  lines.push("  > \"Your scope toggle is set to {currentScope}, so changes apply to {who}. Do you want to (a) switch the toggle to {otherScope} and apply more broadly, or (b) keep it at {currentScope}?\"");

  return lines.join("\n");
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
