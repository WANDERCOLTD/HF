import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { updateAnalysisSpecConfig } from "@/lib/analysis-spec/update-analysis-spec-config";

export const runtime = "nodejs";

interface ToolEntry {
  type: "function";
  enabled?: boolean;
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

interface ToolsSpecConfig {
  tools?: ToolEntry[];
}

/**
 * @api GET /api/voice-tools
 * @visibility internal
 * @scope voice-tools:read
 * @auth session ADMIN
 * @tags voice, admin
 * @description List voice tools from the active TOOLS-001 spec. Each entry
 *   shows the tool name, description, and `enabled` flag (#1043 — per-tool
 *   gate lives in the spec). Used by `/x/settings/voice-tools` admin page.
 * @response 200 { ok: true, tools: Array<{ name, description, enabled }> }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const slug = config.specs.voiceTools;
  const spec = await prisma.analysisSpec.findFirst({
    where: { slug, isActive: true },
    select: { id: true, config: true },
  });
  if (!spec) {
    return NextResponse.json(
      { ok: false, error: `No active TOOLS-001 spec for slug=${slug}` },
      { status: 404 },
    );
  }
  const cfg = spec.config as ToolsSpecConfig | null;
  const tools = (cfg?.tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    enabled: t.enabled !== false,
  }));
  return NextResponse.json({ ok: true, tools });
}

const patchSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * @api PATCH /api/voice-tools
 * @visibility internal
 * @scope voice-tools:write
 * @auth session ADMIN
 * @tags voice, admin
 * @description Toggle a single tool's `enabled` flag inside the active
 *   TOOLS-001 spec. Writes back to AnalysisSpec.config. Returns 404 when
 *   no tool with the given name exists in the spec.
 * @body { name: string, enabled: boolean }
 * @response 200 { ok: true, tool: { name, enabled } }
 */
export async function PATCH(req: Request) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  const slug = config.specs.voiceTools;
  const spec = await prisma.analysisSpec.findFirst({
    where: { slug, isActive: true },
    select: { id: true, config: true },
  });
  if (!spec) {
    return NextResponse.json(
      { ok: false, error: `No active TOOLS-001 spec for slug=${slug}` },
      { status: 404 },
    );
  }
  const cfg = (spec.config ?? {}) as ToolsSpecConfig;
  const tools = cfg.tools ?? [];
  const idx = tools.findIndex((t) => t.function.name === parsed.data.name);
  if (idx === -1) {
    return NextResponse.json(
      { ok: false, error: `Tool '${parsed.data.name}' not found in spec` },
      { status: 404 },
    );
  }

  // Use the scope-aware helper instead of a direct prisma.update (per
  // hf-spec/no-direct-config-write — see docs/CHAIN-CONTRACTS.md §3
  // Link 3 + #829). The helper bumps the per-scope timestamp so
  // downstream callers know to recompose.
  await updateAnalysisSpecConfig(spec.id, (current) => {
    const currentCfg = (current.config ?? {}) as ToolsSpecConfig;
    const currentTools = currentCfg.tools ?? [];
    const ix = currentTools.findIndex(
      (t) => t.function.name === parsed.data.name,
    );
    if (ix === -1) return current;
    const nextTools = [...currentTools];
    nextTools[ix] = { ...nextTools[ix], enabled: parsed.data.enabled };
    return {
      ...current,
      config: { ...currentCfg, tools: nextTools } as object,
    };
  });

  return NextResponse.json({
    ok: true,
    tool: { name: parsed.data.name, enabled: parsed.data.enabled },
  });
}
