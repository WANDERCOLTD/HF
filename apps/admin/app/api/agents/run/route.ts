import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '@/lib/prisma';
import { resolveAgentPaths } from '@/lib/agent-paths';
import { requireAuth, isAuthError } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * LOCAL-ONLY API
 *
 * POST /api/agents/run
 * - Resolves an agentId to a single allow-listed Ops opid
 * - Executes the op via the internal Ops endpoint
 * - Persists the run record to a JSONL file
 *
 * Storage location:
 *  - If HF_KB_PATH is set:   <HF_KB_PATH>/.hf/agent_runs.jsonl
 *  - Otherwise (fallback):   ~/hf_kb/.hf/agent_runs.jsonl
 */

type AgentRunStatus = 'queued' | 'running' | 'ok' | 'error';

type ArtifactLink = {
  label: string;
  kind: 'input' | 'output' | 'log';
  path?: string;
  opid?: string;
};

type AgentRun = {
  id: string;
  agentId: string;
  agentTitle?: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentRunStatus;
  summary?: string;
  opid?: string;
  dryRun?: boolean;
  stdout?: string;
  stderr?: string;
  artifacts?: ArtifactLink[];
};


type OpsResult = {
  ok: boolean;
  opid?: string;
  op?: string;
  dryRun?: boolean;
  startedAt?: string;
  finishedAt?: string;
  stdout?: string;
  stderr?: string;
  output?: string;
  exitCode?: number | null;
  plan?: any;
  events?: any;
  meta?: any;
  error?: string;
  httpStatus?: number;
};

async function safeReadOpsResult(res: Response): Promise<OpsResult> {
  const httpStatus = res.status;
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }

  // Try JSON first.
  try {
    const json = text ? JSON.parse(text) : null;
    if (json && typeof json === 'object') {
      return { httpStatus, ...(json as any) } as OpsResult;
    }
  } catch {
    // fall through
  }

  // Non-JSON response.
  return {
    ok: false,
    httpStatus,
    stderr: text || `Ops request failed with HTTP ${httpStatus}`,
    error: text || `Ops request failed with HTTP ${httpStatus}`,
  };
}

function assertLocalOnly() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Agents API is disabled in production');
  }
  if (process.env.HF_OPS_ENABLED !== 'true') {
    throw new Error('Agents API is disabled (set HF_OPS_ENABLED=true in .env.local)');
  }
}

function resolveKbRoot(): string {
  const env = typeof process.env.HF_KB_PATH === 'string' ? process.env.HF_KB_PATH.trim() : '';
  if (env) return env;
  return path.join(os.homedir(), 'hf_kb');
}

function runsDirPath(): string {
  return path.join(resolveKbRoot(), '.hf');
}

function runsFilePath(): string {
  return path.join(runsDirPath(), 'agent_runs.jsonl');
}

function safeBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes' || t === 'y') return true;
    if (t === 'false' || t === '0' || t === 'no' || t === 'n') return false;
  }
  return fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function newRunId(): string {
  // stable-enough local id (no crypto dependency)
  return 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function ensureRunsDir() {
  const dir = runsDirPath();
  fs.mkdirSync(dir, { recursive: true });
}

function appendRun(run: AgentRun) {
  ensureRunsDir();
  const p = runsFilePath();
  fs.appendFileSync(p, JSON.stringify(run) + '\n', 'utf8');
}

function pruneRunsIfNeeded(opts?: { maxBytes?: number; keepLastLines?: number }) {
  const maxBytes = opts?.maxBytes ?? 5 * 1024 * 1024; // 5MB
  const keepLastLines = opts?.keepLastLines ?? 2000;

  const p = runsFilePath();
  if (!fs.existsSync(p)) return;

  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return;
  }
  if (st.size <= maxBytes) return;

  try {
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(Math.max(0, lines.length - keepLastLines));
    fs.writeFileSync(p, tail.join('\n') + (tail.length ? '\n' : ''), 'utf8');
  } catch {
    // ignore pruning errors
  }
}

function loadAgentManifest(): Record<
  string,
  { title: string; opid: string; settingsSchema?: { defaults?: Record<string, unknown> } }
> {
  // Prefer KB-local manifest(s), then fall back to repo root.
  // Supported file names (in priority order):
  //  - <HF_KB_PATH>/.hf/agents.manifest.json
  //  - <HF_KB_PATH>/.hf/agents.json
  //  - <repoRoot>/lib/agents.json

  const kbRoot = resolveKbRoot();
  const candidates: string[] = [
    path.join(kbRoot, '.hf', 'agents.manifest.json'),
    path.join(kbRoot, '.hf', 'agents.json'),
  ];

  // In next dev, process.cwd() is usually <repo>/apps/admin.
  // Repo root is therefore two levels up.
  const repoRootGuess = path.resolve(process.cwd(), '..', '..');
  candidates.push(path.join(repoRootGuess, 'lib', 'agents.json'));

  // Try each candidate until we find a valid manifest with agents
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;

      const manifestJson = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(manifestJson);

      if (!isPlainObject(parsed)) continue;

      // Shape B: { agents: [...] } - new format with agents array
      if (Array.isArray((parsed as any).agents)) {
        const out: Record<string, any> = {};
        for (const a of (parsed as any).agents) {
          if (!a || typeof a !== 'object') continue;
          const id = String((a as any).agentId || (a as any).id || '').trim();
          const title = String((a as any).title || '').trim();
          const opid = String((a as any).opid || '').trim();
          if (!id || !opid) continue;
          out[id] = {
            title: title || id,
            opid,
            settingsSchema: isPlainObject((a as any).settingsSchema) ? (a as any).settingsSchema : undefined,
            settings: isPlainObject((a as any).settings) ? (a as any).settings : undefined,
          };
        }
        // Only return if we found valid agents
        if (Object.keys(out).length > 0) {
          return out as Record<string, { title: string; opid: string; settingsSchema?: { defaults?: Record<string, unknown> } }>;
        }
        // No valid agents found, try next candidate
        continue;
      }

      // Shape A: object map { [agentId]: { title, opid, settingsSchema? } } - old format
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = String(k || '').trim();
        if (!id || !isPlainObject(v)) continue;
        const title = String((v as any).title || '').trim();
        const opid = String((v as any).opid || '').trim();
        if (!opid) continue;
        out[id] = {
          title: title || id,
          opid,
          settingsSchema: isPlainObject((v as any).settingsSchema) ? (v as any).settingsSchema : undefined,
        };
      }
      // Only return if we found valid agents
      if (Object.keys(out).length > 0) {
        return out as Record<string, { title: string; opid: string; settingsSchema?: { defaults?: Record<string, unknown> } }>;
      }
    } catch {
      // ignore parse errors, try next candidate
    }
  }

  // No valid manifest found
  return {};
}

function resolveAgentIdFromManifest(manifest: Record<string, { title: string; opid: string }>, requested: string): string | null {
  const req = String(requested || '').trim();
  if (!req) return null;
  if (Object.prototype.hasOwnProperty.call(manifest, req)) return req;

  const reqLc = req.toLowerCase();

  // Try matching by title (case-insensitive)
  for (const [id, spec] of Object.entries(manifest)) {
    const title = String(spec?.title || '').trim();
    if (title && title.toLowerCase() === reqLc) return id;
  }

  // Try matching by a loose normalization (spaces/underscores/dashes)
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const reqNorm = normalize(req);
  for (const [id, spec] of Object.entries(manifest)) {
    if (normalize(id) === reqNorm) return id;
    const title = String(spec?.title || '').trim();
    if (title && normalize(title) === reqNorm) return id;
  }

  return null;
}

/**
 * Get published agent instance from DB, if exists.
 * Returns settings to merge with manifest defaults.
 */
async function getPublishedInstance(agentId: string) {
  try {
    const instance = await prisma.agentInstance.findFirst({
      where: { agentId, status: 'PUBLISHED' },
    });
    return instance;
  } catch {
    return null;
  }
}

/**
 * Create initial running record in DB
 */
async function createRunningRecord(
  agentId: string,
  agentTitle: string,
  opid: string,
  instanceId: string | null,
  dryRun: boolean
): Promise<string | null> {
  try {
    const record = await prisma.agentRun.create({
      data: {
        agentInstanceId: instanceId,
        agentId,
        agentTitle,
        opid,
        dryRun,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    return record.id;
  } catch (err) {
    console.error('[AgentRun DB create error]', err);
    return null;
  }
}

/**
 * Update run record with final status
 */
async function updateRunRecord(
  runId: string | null,
  status: 'OK' | 'ERROR',
  data: {
    finishedAt: Date;
    summary?: string;
    stdout?: string;
    stderr?: string;
    artifacts?: any;
  }
) {
  if (!runId) return;
  try {
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: data.finishedAt,
        summary: data.summary,
        stdout: data.stdout,
        stderr: data.stderr,
        artifacts: data.artifacts ?? [],
      },
    });
  } catch (err) {
    console.error('[AgentRun DB update error]', err);
  }
}

/**
 * Persist run to database (in addition to JSONL for backwards compat)
 * Legacy function for error cases
 */
async function persistRunToDb(run: AgentRun, instanceId: string | null) {
  try {
    await prisma.agentRun.create({
      data: {
        agentInstanceId: instanceId,
        agentId: run.agentId,
        agentTitle: run.agentTitle,
        opid: run.opid,
        dryRun: run.dryRun ?? false,
        status: run.status === 'ok' ? 'OK' : run.status === 'error' ? 'ERROR' : 'RUNNING',
        startedAt: new Date(run.startedAt),
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        summary: run.summary,
        stdout: run.stdout,
        stderr: run.stderr,
        artifacts: run.artifacts ?? [],
      },
    });
  } catch (err) {
    console.error('[AgentRun DB persist error]', err);
    // Don't throw - JSONL is the fallback
  }
}

/**
 * @api GET /api/agents/run
 * @visibility internal
 * @scope agents:read
 * @auth session
 * @tags agents
 * @description Get agent run API info and metadata (kbRoot, runsFile path)
 * @response 200 { ok: true, note: string, meta: { kbRoot, runsFile } }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    assertLocalOnly();
    return NextResponse.json({
      ok: true,
      note: 'Use POST to run an agent. History is stored in JSONL.',
      meta: {
        kbRoot: resolveKbRoot(),
        runsFile: runsFilePath(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Agents API failed' }, { status: 500 });
  }
}

/**
 * @api POST /api/agents/run
 * @visibility internal
 * @scope agents:execute
 * @auth session
 * @tags agents
 * @description Execute an agent by resolving its agentId to an Ops opid, running the op, and persisting the run record
 * @body agentId string - Agent identifier to run
 * @body dryRun boolean - If true, do not actually execute (default: false)
 * @body settings object - Optional settings overrides
 * @response 200 { ok: true, run: AgentRun, ops: OpsResult, meta: { runsFile, usedPublishedInstance, ... } }
 * @response 400 { ok: false, error: "Unknown agentId: ..." }
 * @response 400 { ok: false, error: "Invalid JSON body" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: Request) {
  const startedAt = new Date().toISOString();
  const id = newRunId();

  // Parse once (body streams can only be read once).
  let parsedBody: Record<string, unknown> | null = null;
  try {
    const raw = await req.json();
    if (isPlainObject(raw)) parsedBody = raw;
  } catch {
    parsedBody = null;
  }

  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    assertLocalOnly();

    if (!parsedBody) {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const requestedAgentId = String((parsedBody as any).agentId ?? '').trim();
    const dryRun = safeBool((parsedBody as any).dryRun, false);

    const manifest = loadAgentManifest();

    const resolvedAgentId = resolveAgentIdFromManifest(manifest as any, requestedAgentId);
    if (!resolvedAgentId) {
      const knownAgents = Object.entries(manifest).map(([id, s]) => {
        const t = String((s as any)?.title || '').trim();
        return t && t !== id ? `${id} (${t})` : id;
      });
      return NextResponse.json(
        {
          ok: false,
          error: `Unknown agentId: ${requestedAgentId || '(empty)'}. Known agents: ${knownAgents.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const agentId = resolvedAgentId;
    const spec = (manifest as any)[agentId];
    const opid = spec.opid;
    const agentTitle = spec.title;

    // Check for published instance in DB - use its settings if available
    const publishedInstance = await getPublishedInstance(agentId);
    const instanceSettings = publishedInstance?.settings as Record<string, unknown> | null;

    // Build ops body with path resolution:
    // 1. Manifest defaults (from settingsSchema)
    // 2. System paths (from paths.json via pathRef in settingsSchema)
    // 3. Published instance settings (including path_override values)
    // 4. Request body overrides

    // Support both flat body and nested { settings: {...} } format
    const settingsFromBody = isPlainObject((parsedBody as any).settings)
      ? (parsedBody as any).settings
      : {};

    // Also support flat settings in body (legacy compatibility)
    const flatOverrides: Record<string, unknown> = { ...(parsedBody as any) };
    delete (flatOverrides as any).agentId;
    delete (flatOverrides as any).id;
    delete (flatOverrides as any).name;
    delete (flatOverrides as any).title;
    delete (flatOverrides as any).dryRun;
    delete (flatOverrides as any).settings; // remove the nested settings key

    // Merge instance settings with request overrides
    const mergedInstanceSettings = { ...(instanceSettings || {}), ...flatOverrides, ...settingsFromBody };

    // Resolve paths: manifest defaults + system paths + instance overrides
    // This handles $ref to pathSettings in settingsSchema
    const resolvedSettings = resolveAgentPaths(agentId, mergedInstanceSettings);

    // Final ops body with dryRun flag
    const opsBody = { ...resolvedSettings, dryRun };

    // Create initial RUNNING record in DB so it shows in the cockpit
    const dbRunId = await createRunningRecord(
      agentId,
      agentTitle,
      opid,
      publishedInstance?.id ?? null,
      dryRun
    );

    // Build absolute URL to Ops endpoint using the incoming request URL as base.
    const base = new URL(req.url);
    const opsUrl = new URL(`/api/ops/${encodeURIComponent(opid)}`, base.origin);

    const opsRes = await fetch(opsUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opsBody),
      cache: 'no-store',
    });

    const opsJson = await safeReadOpsResult(opsRes);

    const finishedAt = new Date().toISOString();
    const finalStatus = opsJson && opsJson.ok ? 'ok' : 'error';

    const run: AgentRun = {
      id,
      agentId,
      agentTitle,
      startedAt,
      finishedAt,
      status: finalStatus,
      summary:
        opsJson && opsJson.ok
          ? `${agentTitle} completed${dryRun ? ' (dry-run)' : ''}`
          : `${agentTitle} failed${dryRun ? ' (dry-run)' : ''}`,
      opid,
      dryRun,
      stdout: opsJson?.stdout ?? '',
      stderr: opsJson?.stderr ?? (opsJson as any)?.error ?? (opsJson as any)?.output ?? '',
      artifacts: [
        { kind: 'log', label: 'Ops run', opid },
        // Keep filesystem artifacts minimal here; ops itself reports in stdout/stderr.
      ],
    };

    // Persist to JSONL (legacy)
    try {
      appendRun(run);
      pruneRunsIfNeeded();
    } catch {
      // If JSONL persistence fails, still return the run result to the UI.
    }

    // Update DB record with final status
    await updateRunRecord(dbRunId, finalStatus === 'ok' ? 'OK' : 'ERROR', {
      finishedAt: new Date(finishedAt),
      summary: run.summary,
      stdout: run.stdout,
      stderr: run.stderr,
      artifacts: run.artifacts,
    });

    return NextResponse.json({
      ok: true,
      run,
      ops: opsJson,
      meta: {
        runsFile: runsFilePath(),
        usedPublishedInstance: !!publishedInstance,
        instanceId: publishedInstance?.id,
        instanceVersion: publishedInstance?.version,
      },
    });
  } catch (err: any) {
    const finishedAt = new Date().toISOString();

    const agentId = (parsedBody?.agentId as string) ?? 'unknown';
    const agentTitle = 'Unknown Agent';

    const run: AgentRun = {
      id,
      agentId,
      agentTitle,
      startedAt,
      finishedAt,
      status: 'error',
      summary: 'Agent run failed (server error)',
      stderr: err?.message || 'Run failed',
      artifacts: [{ kind: 'log', label: 'Agents API error', opid: 'api/agents/run' }],
    };

    try {
      appendRun(run);
      pruneRunsIfNeeded();
    } catch {
      // ignore
    }

    // Also persist error to DB
    await persistRunToDb(run, null);

    return NextResponse.json({ ok: false, error: err?.message || 'Run failed' }, { status: 500 });
  }
}