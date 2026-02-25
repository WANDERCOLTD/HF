import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { headers } from "next/headers";

// System setting key for audit logging toggle
const AUDIT_ENABLED_KEY = "audit_logging_enabled";

// Common audit actions
export const AuditAction = {
  // Auth
  LOGIN: "login",
  LOGOUT: "logout",
  INVITE_SENT: "invite_sent",
  INVITE_ACCEPTED: "invite_accepted",

  // Pipeline
  RAN_PIPELINE: "ran_pipeline",

  // Callers
  CREATED_CALLER: "created_caller",
  UPDATED_CALLER: "updated_caller",
  DELETED_CALLER: "deleted_caller",

  // Calls
  IMPORTED_CALL: "imported_call",
  DELETED_CALL: "deleted_call",

  // Playbooks
  CREATED_PLAYBOOK: "created_playbook",
  UPDATED_PLAYBOOK: "updated_playbook",
  DELETED_PLAYBOOK: "deleted_playbook",

  // Specs
  CREATED_SPEC: "created_spec",
  UPDATED_SPEC: "updated_spec",
  DELETED_SPEC: "deleted_spec",
  IMPORTED_SPEC: "imported_spec",

  // Settings
  UPDATED_SETTING: "updated_setting",
  TOGGLED_AUDIT: "toggled_audit",

  // GDPR
  EXPORTED_CALLER_DATA: "exported_caller_data",
  RETENTION_CLEANUP: "retention_cleanup",

  // Masquerade
  MASQUERADE_START: "masquerade_start",
  MASQUERADE_STOP: "masquerade_stop",

  // Bulk Operations
  BULK_DELETED_CALLERS: "bulk_deleted_callers",
  BULK_DELETED_PLAYBOOKS: "bulk_deleted_playbooks",
  BULK_DEACTIVATED_DOMAINS: "bulk_deactivated_domains",
  BULK_DELETED_SUBJECTS: "bulk_deleted_subjects",

  // RBAC and Terminology
  UPDATED_ENTITY_ACCESS: "updated_entity_access",
  RESET_ENTITY_ACCESS: "reset_entity_access",
  UPDATED_TERMINOLOGY: "updated_terminology",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

interface AuditLogParams {
  userId?: string;
  userEmail?: string;
  action: AuditActionType | string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Check if audit logging is enabled
 */
export async function isAuditEnabled(): Promise<boolean> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: AUDIT_ENABLED_KEY },
    });

    if (!setting) {
      // Default to disabled
      return false;
    }

    return JSON.parse(setting.value) === true;
  } catch {
    return false;
  }
}

/**
 * Set audit logging enabled/disabled
 */
export async function setAuditEnabled(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: AUDIT_ENABLED_KEY },
    update: { value: JSON.stringify(enabled) },
    create: { key: AUDIT_ENABLED_KEY, value: JSON.stringify(enabled) },
  });
}

/**
 * Log an audit event (if audit logging is enabled)
 */
export async function auditLog(params: AuditLogParams): Promise<void> {
  try {
    // Check if audit logging is enabled
    const enabled = await isAuditEnabled();
    if (!enabled) {
      return;
    }

    // Get request context (IP, user agent) if available
    let ipAddress: string | undefined;
    let userAgent: string | undefined;

    try {
      const headersList = await headers();
      ipAddress = headersList.get("x-forwarded-for")?.split(",")[0] ||
                  headersList.get("x-real-ip") ||
                  undefined;
      userAgent = headersList.get("user-agent") || undefined;
    } catch {
      // Headers not available (e.g., in non-request context)
    }

    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        userEmail: params.userEmail,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata as unknown as Prisma.InputJsonValue,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    // Never throw on audit logging failure - just log to console
    console.error("[AuditLog] Failed to log event:", error);
  }
}

/**
 * Get recent audit logs (for display in admin UI)
 */
export async function getRecentAuditLogs(limit = 50) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Get audit logs for a specific entity
 */
export async function getEntityAuditLogs(entityType: string, entityId: string, limit = 20) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(userId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
