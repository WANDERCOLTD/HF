/**
 * Course-level staleness aggregate — #1429.
 *
 * Powered `<StalePromptPillForCourse />` mounted in the
 * `CourseDesignConsole` header (retired P5 / #1850). The route still
 * exists and is consumed by chat tools + can be re-mounted by Journey
 * tab when a stale-pill surface is needed. Lists every demo caller
 * (`CallerPlaybook.policyMode='demo'`) enrolled in the course and
 * reports how many have a stale prompt by reusing the same
 * `isPromptStale` check that powers the per-caller `<StalePromptPill />`.
 *
 * 4 indexed reads per caller × N demo callers. A 30-second in-memory
 * cache (keyed by `courseId`) prevents the Console header from firing
 * a fresh aggregation on every React render. The cache is intentionally
 * NOT cross-process — staleness data is short-lived and this route is
 * not a candidate for Redis. `?nocache=1` bypasses the cache so the
 * [Reprompt all] button's post-fanout refetch sees fresh data.
 *
 * Auth: OPERATOR+ (matches the per-caller staleness route).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { isPromptStale } from "@/lib/compose/staleness";

export const runtime = "nodejs";

interface StaleCallerEntry {
  callerId: string;
  name: string;
  lastComposedAt: string | null;
}

interface AggregateResponse {
  ok: true;
  totalDemoCallers: number;
  staleCount: number;
  staleCallers: StaleCallerEntry[];
  cachedAt: string;
}

interface CacheEntry {
  value: AggregateResponse;
  expiresAt: number;
}

// 30-second TTL — matches the rationale captured in the AC: the
// 4-query-per-caller cost adds up on a Console page that re-renders
// (lens swaps, sidetray opens) several times in 30s.
const CACHE_TTL_MS = 30_000;
const aggregateCache = new Map<string, CacheEntry>();

/** Exposed for tests — drop any cached entries between runs. */
export function _resetStalenessAggregateCache(): void {
  aggregateCache.clear();
}

/**
 * @api GET /api/courses/:courseId/staleness-aggregate
 * @visibility internal
 * @scope courses:read
 * @auth session (OPERATOR+)
 * @description Aggregates prompt staleness across every demo caller
 *   (`CallerPlaybook.policyMode='demo'`, `status='ACTIVE'`) on the
 *   course. Powers `<StalePromptPillForCourse />` in the Course Design
 *   Console header.
 * @query nocache "1" - Bypass the 30s in-memory cache (used by the
 *   [Reprompt all] post-fanout refetch).
 * @response 200 { ok: true, totalDemoCallers: number, staleCount: number, staleCallers: Array<{ callerId, name, lastComposedAt }>, cachedAt: string }
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;
    const url = new URL(req.url);
    const bypassCache = url.searchParams.get("nocache") === "1";

    if (!bypassCache) {
      const cached = aggregateCache.get(courseId);
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json(cached.value);
      }
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const enrollments = await prisma.callerPlaybook.findMany({
      where: {
        playbookId: courseId,
        policyMode: "demo",
        status: "ACTIVE",
      },
      select: {
        caller: {
          select: {
            id: true,
            name: true,
            domainId: true,
          },
        },
      },
    });

    const stale: StaleCallerEntry[] = [];
    // Run staleness checks in parallel — each is 4 indexed reads.
    await Promise.all(
      enrollments.map(async (enrollment) => {
        const caller = enrollment.caller;
        if (!caller) return;

        const latest = await prisma.composedPrompt.findFirst({
          where: { callerId: caller.id, playbookId: courseId, status: "active" },
          orderBy: { composedAt: "desc" },
          select: { composedAt: true },
        });
        const composedAt = latest?.composedAt ?? null;
        const isStale = await isPromptStale({
          composedAt,
          playbookId: courseId,
          callerId: caller.id,
          domainId: caller.domainId ?? null,
        });
        if (isStale) {
          stale.push({
            callerId: caller.id,
            name: caller.name ?? caller.id.slice(0, 8),
            lastComposedAt: composedAt?.toISOString() ?? null,
          });
        }
      }),
    );

    const response: AggregateResponse = {
      ok: true,
      totalDemoCallers: enrollments.length,
      staleCount: stale.length,
      staleCallers: stale.sort((a, b) => a.name.localeCompare(b.name)),
      cachedAt: new Date().toISOString(),
    };

    aggregateCache.set(courseId, {
      value: response,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(response);
  } catch (err: unknown) {
    console.error("[staleness-aggregate] error:", err);
    const message = err instanceof Error ? err.message : "Failed to compute staleness aggregate";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
