/**
 * Voice tool definitions loader (AnyVoice #1019).
 *
 * Reads `TOOLS-001` (or whatever `config.specs.voiceTools` resolves to)
 * from the AnalysisSpec table and returns the tool array embedded in
 * `spec.config.tools`. Replaces the hardcoded `VAPI_TOOL_DEFINITIONS`
 * TypeScript constant — providers' tool catalogues are now DATA,
 * editable via the spec system without a code deploy.
 *
 * Performance note (#1019 risk R1): this runs at call-start inside
 * VAPI's 7.5s response deadline. Reads the spec via a single Prisma
 * findFirst (~5ms cold; faster warm via Postgres prepared-statement
 * cache). No `resolveSpecs` full pass — that's expensive and not
 * needed for a simple slug lookup.
 *
 * Safe-by-default: missing or empty spec returns `[]` with a logged
 * warning. The voice call continues without tools; better than
 * throwing at call-start and surfacing a 500 to VAPI mid-dial.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import type { ProviderToolDefinition } from "./types";

/** Tool array shape stored in `AnalysisSpec.config.tools`. */
interface ToolsSpecConfig {
  tools?: ProviderToolDefinition[];
}

/**
 * Load voice tool definitions from the active TOOLS-001 spec.
 *
 * The optional `playbookId` parameter exists so a future story can wire
 * per-playbook tool overrides (e.g. a course that disables mid-call
 * RAG). Today the resolver ignores it and always returns the SYSTEM
 * spec — keeping the signature future-proof per the same TL guidance
 * #1027's resolver follows (cascade structure locked from day one).
 */
export async function loadToolDefinitions(
  _playbookId?: string,
): Promise<ProviderToolDefinition[]> {
  const slug = config.specs.voiceTools;
  try {
    const spec = await prisma.analysisSpec.findFirst({
      where: { slug, isActive: true },
      select: { config: true },
    });
    if (!spec) {
      console.warn(
        `[voice/load-tool-definitions] No active spec for slug=${slug}; falling back to no tools.`,
      );
      return [];
    }
    const cfg = spec.config as ToolsSpecConfig | null;
    const tools = cfg?.tools;
    if (!Array.isArray(tools)) {
      console.warn(
        `[voice/load-tool-definitions] Spec ${slug} has no config.tools array; falling back to no tools.`,
      );
      return [];
    }
    return tools;
  } catch (err) {
    // Wrap DB errors in a warn instead of throwing — voice call must
    // continue even if the spec store is temporarily unreachable.
    console.warn(
      `[voice/load-tool-definitions] Failed to load spec ${slug}:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
