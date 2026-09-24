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

/** Tool entry shape stored in `AnalysisSpec.config.tools`. The `enabled`
 *  flag is the spec-level per-tool gate (#1043, supersedes
 *  `TOOL_SETTING_KEYS` + per-tool VoiceCallSettings booleans). Missing
 *  field defaults to `true` for back-compat with pre-#1043 seeds. */
interface ToolEntry extends ProviderToolDefinition {
  enabled?: boolean;
}
interface ToolsSpecConfig {
  tools?: ToolEntry[];
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
    // seed-from-specs.ts:608 stores slugs as `spec-${id.toLowerCase()}`.
    // Use the deterministic shape directly — a contains-match would also
    // hit sibling specs whose slug contains "tools-001" (e.g.
    // spec-prompt-cref-tools-001).
    const storedSlug = `spec-${slug.toLowerCase()}`;
    const spec = await prisma.analysisSpec.findFirst({
      where: { slug: storedSlug, isActive: true },
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
    // #1043: per-tool gate lives in the spec. `enabled !== false` is the
    // active rule — missing field defaults to true so historical seeds
    // continue to work without a re-seed. Strip the flag before returning
    // so downstream code receives the canonical ProviderToolDefinition.
    return tools
      .filter((t) => t.enabled !== false)
      .map(({ enabled: _enabled, ...rest }) => rest);
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
