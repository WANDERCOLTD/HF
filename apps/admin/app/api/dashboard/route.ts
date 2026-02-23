import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/dashboard
 * @visibility internal
 * @scope dashboard:read
 * @auth session
 * @tags dashboard
 * @description Consolidated dashboard data — entity previews, counts, recent calls, active tasks. Role-scoped.
 * @response 200 { ok: true, role: string, entities: {...}, counts: {...}, recentCalls: [...], activeTasks: [...] }
 * @response 401 Unauthorized
 * @response 500 { ok: false, error: "..." }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("TESTER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const role = session.user.role;
    const userId = session.user.id;
    const isAdmin = ["SUPERADMIN", "ADMIN", "OPERATOR"].includes(role);
    const isSuperAdmin = role === "SUPERADMIN";
    const isTester = ["TESTER", "VIEWER", "SUPER_TESTER"].includes(role);
    const isSuperTester = role === "SUPER_TESTER";

    // DEMO: no DB calls needed
    if (role === "DEMO") {
      return NextResponse.json({
        ok: true,
        role,
        entities: {},
        counts: { domains: 0, playbooks: 0, callers: 0, calls: 0 },
        recentCalls: [],
        activeTasks: [],
      });
    }

    // Scope filter for tester-level roles
    const callerScope = isTester ? { userId } : {};

    // Build parallel queries based on role
    const queries: Record<string, Promise<unknown>> = {};

    // ── Counts ──────────────────────────────────────────
    queries.domainCount = isAdmin || isSuperTester
      ? prisma.domain.count({ where: { isActive: true } }).catch(() => 0)
      : Promise.resolve(0);

    queries.playbookCount = isAdmin
      ? prisma.playbook.count().catch(() => 0)
      : Promise.resolve(0);

    queries.callerCount = prisma.caller.count({
      where: { archivedAt: null, ...callerScope },
    }).catch(() => 0);

    queries.callCount = prisma.call.count({
      where: isTester ? { caller: { userId } } : {},
    }).catch(() => 0);

    if (isSuperAdmin) {
      queries.specCount = prisma.analysisSpec.count().catch(() => 0);
      queries.parameterCount = prisma.parameter.count().catch(() => 0);
    }

    // ── Entity Previews (latest 5) ──────────────────────
    if (isAdmin || isSuperTester) {
      queries.domains = prisma.domain.findMany({
        where: { isActive: true },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, slug: true, kind: true,
          _count: { select: { callers: true, playbooks: true } },
        },
      }).catch(() => []);
    }

    if (isAdmin) {
      queries.playbooks = prisma.playbook.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, status: true,
          domain: { select: { name: true } },
          _count: { select: { enrollments: true } },
        },
      }).catch(() => []);

      queries.communities = prisma.domain.findMany({
        where: { isActive: true, kind: "COMMUNITY" },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, slug: true, kind: true,
          _count: { select: { callers: true } },
        },
      }).catch(() => []);
    }

    queries.callers = prisma.caller.findMany({
      where: { archivedAt: null, ...callerScope },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true,
        domain: { select: { name: true } },
        calls: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        },
      },
    }).catch(() => []);

    if (isSuperAdmin) {
      queries.specs = prisma.analysisSpec.findMany({
        take: 5,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, name: true, slug: true, specRole: true, version: true,
        },
      }).catch(() => []);
    }

    // ── Recent Calls ────────────────────────────────────
    const callsLimit = isAdmin ? 8 : isSuperTester ? 5 : 5;
    queries.recentCalls = prisma.call.findMany({
      where: isTester ? { caller: { userId } } : {},
      take: callsLimit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        caller: { select: { id: true, name: true } },
      },
    }).catch(() => []);

    // ── Active Tasks ────────────────────────────────────
    if (isAdmin) {
      queries.activeTasks = prisma.userTask.findMany({
        where: { status: "in_progress" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true, taskType: true, currentStep: true, totalSteps: true,
          context: true, updatedAt: true,
        },
      }).catch(() => []);
    }

    // ── Execute all in parallel ─────────────────────────
    const keys = Object.keys(queries);
    const values = await Promise.all(Object.values(queries));
    const results: Record<string, unknown> = {};
    keys.forEach((k, i) => { results[k] = values[i]; });

    // ── Transform entity previews ───────────────────────
    const entities: Record<string, unknown[]> = {};

    if (results.domains) {
      entities.domains = (results.domains as Array<{
        id: string; name: string; slug: string; kind: string;
        _count: { callers: number; playbooks: number };
      }>).map(d => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        kind: d.kind,
        callerCount: d._count.callers,
        playbookCount: d._count.playbooks,
      }));
    }

    if (results.playbooks) {
      entities.playbooks = (results.playbooks as Array<{
        id: string; name: string; status: string;
        domain: { name: string } | null;
        _count: { enrollments: number };
      }>).map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        domainName: p.domain?.name ?? null,
        callerCount: p._count.enrollments,
      }));
    }

    if (results.callers) {
      entities.callers = (results.callers as Array<{
        id: string; name: string | null;
        domain: { name: string } | null;
        calls: Array<{ createdAt: Date }>;
      }>).map(c => ({
        id: c.id,
        name: c.name,
        domainName: c.domain?.name ?? null,
        lastCallAt: c.calls[0]?.createdAt?.toISOString() ?? null,
      }));
    }

    if (results.specs) {
      entities.specs = (results.specs as Array<{
        id: string; name: string; slug: string; specRole: string; version: string | null;
      }>).map(s => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        role: s.specRole,
        version: s.version,
      }));
    }

    if (results.communities) {
      entities.communities = (results.communities as Array<{
        id: string; name: string; slug: string; kind: string;
        _count: { callers: number };
      }>).map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        kind: c.kind,
        callerCount: c._count.callers,
      }));
    }

    // ── Transform recent calls ──────────────────────────
    const recentCalls = (results.recentCalls as Array<{
      id: string; createdAt: Date;
      caller: { id: string; name: string | null } | null;
    }>).map(call => ({
      id: call.id,
      createdAt: call.createdAt.toISOString(),
      callerName: call.caller?.name ?? null,
      callerId: call.caller?.id ?? null,
    }));

    // ── Transform active tasks ──────────────────────────
    const activeTasks = (results.activeTasks as Array<{
      id: string; taskType: string; currentStep: number; totalSteps: number;
      context: unknown; updatedAt: Date;
    }> ?? []).map(task => ({
      id: task.id,
      taskType: task.taskType,
      currentStep: task.currentStep,
      totalSteps: task.totalSteps,
      context: task.context as Record<string, unknown>,
      updatedAt: task.updatedAt.toISOString(),
    }));

    // ── Counts ──────────────────────────────────────────
    const counts: Record<string, number> = {
      domains: results.domainCount as number,
      playbooks: results.playbookCount as number,
      callers: results.callerCount as number,
      calls: results.callCount as number,
    };
    if (isSuperAdmin) {
      counts.specs = results.specCount as number;
      counts.parameters = results.parameterCount as number;
    }

    return NextResponse.json({
      ok: true,
      role,
      entities,
      counts,
      recentCalls,
      activeTasks,
    });
  } catch (error: unknown) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load dashboard data" },
      { status: 500 }
    );
  }
}
