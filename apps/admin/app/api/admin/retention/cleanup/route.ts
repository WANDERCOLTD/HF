import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { auditLog, AuditAction } from "@/lib/audit";
import { deleteCallerData } from "@/lib/gdpr/delete-caller-data";

const BATCH_LIMIT = 100;

/**
 * @api POST /api/admin/retention/cleanup
 * @visibility internal
 * @scope admin:write
 * @auth session
 * @tags admin, gdpr
 * @description Process data retention cleanup. Deletes expired caller data
 *   and old audit logs based on retention config. Idempotent — safe to call
 *   repeatedly from an external cron/scheduler.
 */
export async function POST() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const callerRetentionDays = config.retention.callerDataDays;
    const auditRetentionDays = config.retention.auditLogDays;

    // Both disabled — nothing to do
    if (callerRetentionDays <= 0 && auditRetentionDays <= 0) {
      return NextResponse.json({
        ok: true,
        results: { skipped: true, reason: "retention disabled" },
      });
    }

    let callersDeleted = 0;
    let auditLogsDeleted = 0;
    let expiredCallsDeleted = 0;

    // --- Caller data cleanup ---
    if (callerRetentionDays > 0) {
      const cutoffDate = new Date(Date.now() - callerRetentionDays * 86400000);

      // Find callers with no recent activity
      const expiredCallers = await prisma.caller.findMany({
        where: {
          AND: [
            { createdAt: { lt: cutoffDate } },
            {
              OR: [
                { calls: { none: {} } },
                { calls: { every: { createdAt: { lt: cutoffDate } } } },
              ],
            },
          ],
        },
        select: { id: true },
        take: BATCH_LIMIT,
      });

      for (const caller of expiredCallers) {
        try {
          await deleteCallerData(caller.id);
          callersDeleted++;
        } catch (err) {
          console.error(`[retention] Failed to delete caller ${caller.id}:`, err);
        }
      }
    }

    // --- Audit log cleanup ---
    if (auditRetentionDays > 0) {
      const auditCutoff = new Date(Date.now() - auditRetentionDays * 86400000);
      const result = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: auditCutoff } },
      });
      auditLogsDeleted = result.count;
    }

    // --- Row-level Call expiry cleanup (#1917 / I-PR3) ---
    // Distinct policy from caller-level cleanup above: this purges
    // INDIVIDUAL Call rows whose `regulatoryExpiresAt` has elapsed,
    // independent of caller activity. Stamped at create-time by
    // `lib/privacy/stamp-regulatory-expiry.ts` (or NULL on legacy rows,
    // which this query intentionally skips — legacy callers still flow
    // through the caller-level cleanup above when they go dormant).
    const expiredCalls = await prisma.call.deleteMany({
      where: { regulatoryExpiresAt: { lte: new Date() } },
    });
    expiredCallsDeleted = expiredCalls.count;

    // Audit the cleanup itself
    auditLog({
      userId: authResult.session.user.id,
      userEmail: authResult.session.user.email,
      action: AuditAction.RETENTION_CLEANUP,
      entityType: "System",
      metadata: {
        callerRetentionDays,
        auditRetentionDays,
        callersDeleted,
        auditLogsDeleted,
        expiredCallsDeleted,
      },
    });

    return NextResponse.json({
      ok: true,
      results: {
        callerRetention: {
          enabled: callerRetentionDays > 0,
          retentionDays: callerRetentionDays,
          callersDeleted,
        },
        auditLogRetention: {
          enabled: auditRetentionDays > 0,
          retentionDays: auditRetentionDays,
          auditLogsDeleted,
        },
        regulatoryCallExpiry: {
          // Always enabled — when nothing has a stamped expiry the query
          // is a no-op (deletes 0 rows).
          expiredCallsDeleted,
        },
      },
    });
  } catch (error: any) {
    console.error("[retention] Cleanup error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Retention cleanup failed" },
      { status: 500 }
    );
  }
}
