import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

function expandTilde(p: string): string {
  const t = (p || "").trim();
  if (!t) return "";
  if (t === "~") return os.homedir();
  if (t.startsWith("~/") || t.startsWith("~\\")) {
    return path.join(os.homedir(), t.slice(2));
  }
  return t;
}

function kbRootFromEnv(): string {
  const envRaw = typeof process.env.HF_KB_PATH === "string" ? process.env.HF_KB_PATH : "";
  const env = expandTilde(envRaw);
  if (env && env.trim()) return path.resolve(env.trim());
  return path.resolve(path.join(os.homedir(), "hf_kb"));
}

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function thisFileDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

async function findRepoAgentsManifest(): Promise<string | null> {
  const candidates: string[] = [];

  // 1) CWD == HF/apps/admin
  candidates.push(path.resolve(process.cwd(), "../../..", "lib", "agents.json"));

  // 2) CWD is repo root
  candidates.push(path.resolve(process.cwd(), "lib", "agents.json"));

  // 3) Walk up from this file location
  const start = thisFileDir();
  let cur = start;
  for (let i = 0; i < 10; i++) {
    candidates.push(path.resolve(cur, "lib", "agents.json"));
    candidates.push(path.resolve(cur, "..", "lib", "agents.json"));
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }

  // Dedup
  const seen = new Set<string>();
  const uniq = candidates
    .map((p) => path.resolve(p))
    .filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });

  for (const p of uniq) {
    if (await pathExists(p)) return p;
  }
  return null;
}

type AgentManifest = {
  agents?: Array<{
    id?: string;
    agentId?: string;
    title: string;
    description?: string;
    enabled?: boolean;
    opid?: string;
    inputs?: Array<{ node: string; edgeType?: string; label?: string }>;
    outputs?: Array<{ node: string; edgeType?: string; label?: string }>;
  }>;
};

/**
 * @api GET /api/agents/by-data-node
 * @visibility internal
 * @scope agents:read
 * @auth session
 * @tags agents
 * @description Find agents connected to a specific data node (as consumer, producer, or both) with recent run status
 * @query dataNode string - The data node identifier (e.g. "data:knowledge")
 * @response 200 { ok: true, dataNode: string, agents: AgentInfo[] } - When manifest is missing, returns ok:true with empty agents array
 * @response 400 { ok: false, error: "dataNode query parameter is required" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const url = new URL(req.url);
    const dataNode = url.searchParams.get("dataNode");

    if (!dataNode) {
      return NextResponse.json(
        { ok: false, error: "dataNode query parameter is required" },
        { status: 400 }
      );
    }

    // Load manifest
    const kbRoot = kbRootFromEnv();
    const kbPath = path.join(kbRoot, ".hf", "agents.manifest.json");
    let manifest = await readJsonIfExists<AgentManifest>(kbPath);

    if (!manifest) {
      const repoPath = await findRepoAgentsManifest();
      if (repoPath) {
        manifest = await readJsonIfExists<AgentManifest>(repoPath);
      }
    }

    if (!manifest || !Array.isArray(manifest.agents)) {
      // Manifest isn't packaged into every runner image. Treat missing
      // manifest as "no agents wired to this node" rather than a hard 404
      // so caller UIs (SourcePageHeader) don't surface console errors.
      return NextResponse.json({ ok: true, dataNode, agents: [] });
    }

    // Find agents with this data node in inputs or outputs
    const matchingAgents = manifest.agents.filter((agent) => {
      const inputs = agent.inputs || [];
      const outputs = agent.outputs || [];

      const inputMatch = inputs.some((i) => i.node === dataNode);
      const outputMatch = outputs.some((o) => o.node === dataNode);

      return inputMatch || outputMatch;
    });

    // Get recent runs for these agents
    const agentIds = matchingAgents.map((a) => a.id || a.agentId).filter(Boolean) as string[];

    const recentRuns = await prisma.agentRun.findMany({
      where: {
        agentId: { in: agentIds },
      },
      orderBy: { startedAt: "desc" },
      take: agentIds.length * 3, // Get a few recent runs per agent
      select: {
        id: true,
        agentId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    // Group runs by agent
    const runsByAgent = new Map<string, typeof recentRuns>();
    for (const run of recentRuns) {
      const arr = runsByAgent.get(run.agentId) || [];
      arr.push(run);
      runsByAgent.set(run.agentId, arr);
    }

    // Build response with agent info and run status
    const agents = matchingAgents.map((agent) => {
      const agentId = agent.id || agent.agentId || "";
      const runs = runsByAgent.get(agentId) || [];
      const latestRun = runs[0];

      const isInput = (agent.inputs || []).some((i) => i.node === dataNode);
      const isOutput = (agent.outputs || []).some((o) => o.node === dataNode);

      return {
        agentId,
        title: agent.title,
        description: agent.description || "",
        enabled: agent.enabled !== false,
        opid: agent.opid,
        relationship: isInput && isOutput ? "both" : isInput ? "consumer" : "producer",
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              startedAt: latestRun.startedAt,
              finishedAt: latestRun.finishedAt,
            }
          : null,
        isRunning: latestRun?.status === "RUNNING",
      };
    });

    return NextResponse.json({
      ok: true,
      dataNode,
      agents,
    });
  } catch (error: any) {
    console.error("Error fetching agents by data node:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch agents" },
      { status: 500 }
    );
  }
}
