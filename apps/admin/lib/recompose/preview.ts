/**
 * Preview the blast radius of a recompose fan-out, so the pending-changes
 * tray (epic #854) can render an honest `Recompose all N learners` toggle
 * before the user commits.
 *
 * Returns a count + a small sample of first names for inline display, plus
 * a coarse ETA derived from the count.
 *
 * Counting strategy:
 *   - `playbook` scope: single-index COUNT(*) on CallerPlaybook(status=ACTIVE)
 *   - `domain`   scope: IN-clause across all playbooks in the domain
 *   - `system`   scope: DISTINCT callerId across all ACTIVE CallerPlaybook rows
 *
 * The response carries `source: 'live' | 'counter'`. v1 always emits `'live'`.
 * #860 will denormalise enrollment counts onto Playbook/Domain rows; when
 * that lands, this util flips the playbook + domain branches to read the
 * stored counter and emits `'counter'` for those scopes. The shape is
 * deliberately forward-compatible so the tray UI does not change.
 */

import { prisma } from "@/lib/prisma";

export type RecomposePreviewScope = "playbook" | "domain" | "system";

export interface RecomposePreview {
  count: number;
  /** Up to 3 first-name initials of affected callers — for tray inline display. */
  sampleNames: string[];
  /** Coarse ETA in seconds: count × 2s, capped at 300. */
  etaSeconds: number;
  /** True when this response was served from the route-level cache. */
  cacheHit: boolean;
  /** v1 always 'live'; flips to 'counter' once #860 ships denormalised counters. */
  source: "live" | "counter";
}

const ETA_SECONDS_PER_CALLER = 2;
const ETA_CAP_SECONDS = 300;

function etaFor(count: number): number {
  return Math.min(count * ETA_SECONDS_PER_CALLER, ETA_CAP_SECONDS);
}

function firstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const trimmed = displayName.trim();
  if (!trimmed) return null;
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken || null;
}

/**
 * Anonymisation: take first names only, dedupe, cap at 3. Empty / null
 * display names are dropped silently (they wouldn't be useful in the tray).
 */
function sampleFirstNames(
  rows: Array<{ caller: { name: string | null } }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const name = firstName(row.caller.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= 3) break;
  }
  return out;
}

async function previewPlaybook(scopeId: string): Promise<RecomposePreview> {
  const [count, sampleRows] = await Promise.all([
    prisma.callerPlaybook.count({
      where: { playbookId: scopeId, status: "ACTIVE" },
    }),
    prisma.callerPlaybook.findMany({
      where: { playbookId: scopeId, status: "ACTIVE" },
      include: { caller: { select: { name: true } } },
      orderBy: { enrolledAt: "asc" },
      take: 3,
    }),
  ]);

  return {
    count,
    sampleNames: sampleFirstNames(sampleRows),
    etaSeconds: etaFor(count),
    cacheHit: false,
    source: "live",
  };
}

async function previewDomain(scopeId: string): Promise<RecomposePreview> {
  const playbooks = await prisma.playbook.findMany({
    where: { domainId: scopeId },
    select: { id: true },
  });
  const playbookIds = playbooks.map((p) => p.id);

  if (playbookIds.length === 0) {
    return {
      count: 0,
      sampleNames: [],
      etaSeconds: 0,
      cacheHit: false,
      source: "live",
    };
  }

  const [count, sampleRows] = await Promise.all([
    prisma.callerPlaybook.count({
      where: { playbookId: { in: playbookIds }, status: "ACTIVE" },
    }),
    prisma.callerPlaybook.findMany({
      where: { playbookId: { in: playbookIds }, status: "ACTIVE" },
      include: { caller: { select: { name: true } } },
      orderBy: { enrolledAt: "asc" },
      take: 3,
    }),
  ]);

  return {
    count,
    sampleNames: sampleFirstNames(sampleRows),
    etaSeconds: etaFor(count),
    cacheHit: false,
    source: "live",
  };
}

async function previewSystem(): Promise<RecomposePreview> {
  // DISTINCT callers across all ACTIVE enrollments — a SYSTEM-spec edit
  // can touch any active learner regardless of their playbook.
  const rows = await prisma.callerPlaybook.findMany({
    where: { status: "ACTIVE" },
    select: { callerId: true },
    distinct: ["callerId"],
  });
  const count = rows.length;

  const sampleRows = await prisma.callerPlaybook.findMany({
    where: { status: "ACTIVE" },
    include: { caller: { select: { name: true } } },
    orderBy: { enrolledAt: "asc" },
    take: 6, // overfetch slightly; dedupe in sampleFirstNames
  });

  return {
    count,
    sampleNames: sampleFirstNames(sampleRows),
    etaSeconds: etaFor(count),
    cacheHit: false,
    source: "live",
  };
}

export async function previewRecomposeFanout(
  scope: RecomposePreviewScope,
  scopeId: string | null,
): Promise<RecomposePreview> {
  if (scope === "system") {
    return previewSystem();
  }
  if (!scopeId) {
    return {
      count: 0,
      sampleNames: [],
      etaSeconds: 0,
      cacheHit: false,
      source: "live",
    };
  }
  if (scope === "playbook") return previewPlaybook(scopeId);
  return previewDomain(scopeId);
}
