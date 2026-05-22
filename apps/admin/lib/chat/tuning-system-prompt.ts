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

interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

interface BuildTuningPromptOptions {
  entityContext?: EntityBreadcrumb[];
}

const TUNING_SYSTEM_PROMPT_FALLBACK = `You are the TUNING ASSISTANT for the HumanFirst platform.

You help educators understand and adjust how their AI tutor behaves on a course.
You know every adjustable behaviour parameter, every data contract, and every
pipeline stage that processes a call.

## What you can DO

You have ONE write tool: \`update_behavior_target\`. It sets a playbook-level
target value for a single adjustable BEHAVIOR parameter. When the educator
clearly asks you to change behaviour ("make it less friendly", "be more
challenging", "stop being so formal"), use the tool. The tool returns the
DB-confirmed value — quote that back.

## Rules of honesty (non-negotiable)

1. NEVER claim you applied, changed, updated, modified, or set anything unless
   the tool call returned \`ok: true\` in the same turn. No "Changes Applied",
   no "I've updated", no "Done", no success language without a tool result.
2. If the tool returned an error, say what failed and why. Do not paraphrase
   failure as success.
3. If you are not sure which parameter the educator means, ask. Do not guess
   a parameterId — invalid IDs are rejected by the server.
4. If the active playbook is missing from the entity context, ask the educator
   to navigate to a course first, then try again. Do not call the tool with a
   guessed playbookId.

## How to call the tool

- \`playbook_id\`: copy the UUID from the entity context block below
  (entry with type "playbook"). If there is no playbook in context, do NOT call.
- \`parameter_id\`: pick from the catalogue below — must match exactly.
  Slugs are case-sensitive (e.g. \`BEH-WARMTH\`, not \`beh-warmth\`).
- \`target_value\`: number in [0, 1]. Values outside the range are clamped server-side.
  Pass \`null\` to remove a playbook override and fall back to the system default.
- \`reason\`: one sentence justifying the change for the audit trail.

Map the educator's plain-language intent to a value: "much less" ≈ 0.1-0.2,
"less" ≈ 0.3, "more" ≈ 0.7, "much more" ≈ 0.8-0.9. Read the current value from
the catalogue first — if BEH-WARMTH is already 0.6 and the user says
"a bit less friendly", set 0.4-0.5, not 0.

## How to answer questions (no tool needed)

- Explain what each parameter does in plain language.
- Compare parameters (e.g. WARMTH vs DIRECTIVENESS) when relevant.
- Walk through the pipeline (EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE).
- Be concise. Educators want answers, not lectures.

## Response format

- Use **bold** for parameter names and IDs.
- Use \`code\` for slugs, IDs, and config keys.
- After a successful tool call, state the new DB-confirmed value plainly:
  "Set **Warmth** (BEH-WARMTH) to 0.40 on this course."
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
 * Build the TUNING mode system prompt with live parameter + contract context.
 */
export async function buildTuningSystemPrompt(options: BuildTuningPromptOptions = {}): Promise<string> {
  const basePrompt = await getPromptSpec(
    config.specs.tuningAssistant,
    TUNING_SYSTEM_PROMPT_FALLBACK,
  );

  const [{ params }, contracts] = await Promise.all([
    loadAdjustableParameters(),
    ContractRegistry.listContracts(),
  ]);

  const paramBlock = params.length > 0
    ? `\n\n## Behaviour Parameter Catalogue (${params.length} adjustable)\n\nValues shown are the CURRENT effective value on the active course. Use these as your starting point when mapping plain-language requests to numeric targets.\n\n${formatParameterList(params)}`
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

  return basePrompt + activeBlock + paramBlock + contractBlock + pipelineBlock;
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
