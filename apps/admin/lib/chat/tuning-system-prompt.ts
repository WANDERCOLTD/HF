/**
 * Tuning Assistant — System Prompt Builder (Phase 1)
 *
 * Builds a system prompt grounded in the live parameter catalogue and
 * contract registry. Phase 1 is static/global — no course-specific context.
 *
 * Phase 2 will add course-aware context injection.
 * Phase 3 will add tool-use for "Open in Agent Tuner" action links.
 */

import { loadAdjustableParameters, formatParameterList } from "@/lib/agent-tuner/params";
import { ContractRegistry } from "@/lib/contracts/registry";
import type { DataContract } from "@/lib/contracts/types";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";

const TUNING_SYSTEM_PROMPT_FALLBACK = `You are a TUNING ASSISTANT for the HumanFirst platform.

You help course designers and operators understand how to configure their AI tutoring courses.
You have comprehensive knowledge of all adjustable behaviour parameters, data contracts,
and the pipeline stages that process each call.

## Your Role

- **Explain** what each parameter does, in plain language
- **Describe** how parameters interact (e.g. warmth + directiveness together)
- **Guide** users to understand the pipeline stages and how data flows
- **Clarify** what contracts govern and how they connect specs

## Important Rules

1. NEVER make changes yourself — say "use the Agent Tuner to apply changes"
2. ALWAYS reference real parameter IDs and names from the catalogue below
3. When a user asks "what controls X?", find the most relevant parameter(s) and explain them
4. When asked about pipeline stages, explain the flow: EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE
5. Be concise — educators want answers, not lectures

## Response Format

- Use **bold** for parameter names and IDs
- Use \`code\` for IDs, slugs, and config keys
- Use tables for comparing parameters
- Keep answers under 200 words unless the user asks for detail`;

/**
 * Build the TUNING mode system prompt with live parameter + contract context.
 */
export async function buildTuningSystemPrompt(): Promise<string> {
  // Load DB-backed prompt spec (falls back to hardcoded if not seeded)
  const basePrompt = await getPromptSpec(
    config.specs.tuningAssistant,
    TUNING_SYSTEM_PROMPT_FALLBACK,
  );

  // Load live data in parallel
  const [{ params }, contracts] = await Promise.all([
    loadAdjustableParameters(),
    ContractRegistry.listContracts(),
  ]);

  // Build parameter catalogue block
  const paramBlock = params.length > 0
    ? `\n\n## Behaviour Parameter Catalogue (${params.length} adjustable)\n\n${formatParameterList(params)}`
    : "\n\n## Behaviour Parameters\n\n_No adjustable behaviour parameters found in the database._";

  // Build contract catalogue block
  const contractBlock = formatContractCatalogue(contracts);

  // Build pipeline stage block (static — matches PIPELINE-001)
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

Each stage is spec-driven. Parameters flow through the loop: measured → aggregated → rewarded → adapted → composed into the next prompt.`;

  return basePrompt + paramBlock + contractBlock + pipelineBlock;
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
