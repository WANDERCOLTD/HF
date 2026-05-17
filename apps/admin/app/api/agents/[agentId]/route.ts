import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { getAgentPathInfo, resolveAgentPaths } from "@/lib/agent-paths";
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

const prisma = new PrismaClient();

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent Instance API is disabled in production");
  }
  if (process.env.HF_OPS_ENABLED !== "true") {
    throw new Error("Agent Instance API is disabled (set HF_OPS_ENABLED=true)");
  }
}

function computeSettingsHash(settings: Record<string, unknown>): string {
  const json = JSON.stringify(settings, Object.keys(settings).sort());
  return crypto.createHash("sha256").update(json).digest("hex").substring(0, 16);
}

/**
 * @api GET /api/agents/:agentId
 * @visibility internal
 * @scope agents:read
 * @auth session
 * @tags agents
 * @description Get agent details including published, draft, and history versions with path resolution info
 * @pathParam agentId string - The agent identifier
 * @response 200 { ok: true, agentId, published, draft, history, allVersions }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    assertLocalOnly();
    const { agentId } = await params;

    const instances = await prisma.agentInstance.findMany({
      where: { agentId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        runs: {
          take: 5,
          orderBy: { startedAt: "desc" },
        },
      },
    });

    // Find the published and draft versions
    const published = instances.find((i) => i.status === "PUBLISHED");
    const draft = instances.find((i) => i.status === "DRAFT");
    const history = instances.filter((i) => i.status === "SUPERSEDED");

    // Get path info for the active instance (published or draft)
    const activeInstance = published || draft;
    const instanceSettings = (activeInstance?.settings as Record<string, unknown>) || {};
    const pathInfo = getAgentPathInfo(agentId, instanceSettings);
    const resolvedSettings = resolveAgentPaths(agentId, instanceSettings);

    return NextResponse.json({
      ok: true,
      agentId,
      published,
      draft,
      history,
      allVersions: instances,
      // Path resolution info
      paths: {
        info: pathInfo,
        resolved: resolvedSettings,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to get agent" },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * @api PUT /api/agents/:agentId
 * @visibility internal
 * @scope agents:write
 * @auth session
 * @tags agents
 * @description Create or update a draft agent instance with name, description, and settings
 * @pathParam agentId string - The agent identifier
 * @body name string - Agent instance name
 * @body description string - Agent instance description
 * @body settings object - Agent settings configuration
 * @response 200 { ok: true, action: "created"|"updated", instance: AgentInstance }
 * @response 500 { ok: false, error: "..." }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    assertLocalOnly();
    const { agentId } = await params;

    const body = await req.json();
    const { name, description, settings } = body;

    // Find existing draft
    const existingDraft = await prisma.agentInstance.findFirst({
      where: { agentId, status: "DRAFT" },
    });

    const settingsHash = settings ? computeSettingsHash(settings) : null;

    if (existingDraft) {
      // Update existing draft
      const updated = await prisma.agentInstance.update({
        where: { id: existingDraft.id },
        data: {
          name: name ?? existingDraft.name,
          description: description ?? existingDraft.description,
          settings: settings ?? existingDraft.settings,
          settingsHash,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        ok: true,
        action: "updated",
        instance: updated,
      });
    } else {
      // Find published to use as parent
      const published = await prisma.agentInstance.findFirst({
        where: { agentId, status: "PUBLISHED" },
      });

      // Determine next version
      let nextVersion = "v1.0";
      if (published) {
        const match = published.version.match(/v(\d+)\.(\d+)/);
        if (match) {
          nextVersion = `v${match[1]}.${parseInt(match[2]) + 1}`;
        }
      }

      // Create new draft
      const created = await prisma.agentInstance.create({
        data: {
          agentId,
          name,
          description,
          version: nextVersion,
          status: "DRAFT",
          settings: settings || {},
          settingsHash,
          parentVersionId: published?.id,
        },
      });

      return NextResponse.json({
        ok: true,
        action: "created",
        instance: created,
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to update agent" },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * @api DELETE /api/agents/:agentId
 * @visibility internal
 * @scope agents:write
 * @auth session
 * @tags agents
 * @description Archive an agent instance by version (soft delete, cannot archive PUBLISHED instances)
 * @pathParam agentId string - The agent identifier
 * @query version string - The version to archive (required)
 * @response 200 { ok: true, action: "archived", instance: AgentInstance }
 * @response 400 { ok: false, error: "version query param required" }
 * @response 400 { ok: false, error: "Cannot archive published instance - supersede it first" }
 * @response 404 { ok: false, error: "Instance not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    assertLocalOnly();
    const { agentId } = await params;

    const url = new URL(req.url);
    const version = url.searchParams.get("version");

    if (!version) {
      return NextResponse.json(
        { ok: false, error: "version query param required" },
        { status: 400 }
      );
    }

    const instance = await prisma.agentInstance.findUnique({
      where: { agentId_version: { agentId, version } },
    });

    if (!instance) {
      return NextResponse.json(
        { ok: false, error: "Instance not found" },
        { status: 404 }
      );
    }

    if (instance.status === "PUBLISHED") {
      return NextResponse.json(
        { ok: false, error: "Cannot archive published instance - supersede it first" },
        { status: 400 }
      );
    }

    const archived = await prisma.agentInstance.update({
      where: { id: instance.id },
      data: { status: "ARCHIVED" },
    });

    return NextResponse.json({
      ok: true,
      action: "archived",
      instance: archived,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to archive agent" },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
