import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isLoggingEnabled,
  setLoggingEnabled,
  getEnabledTypes,
  setEnabledTypes,
  LogType,
} from "@/lib/logger";
import { requireAuth, isAuthError } from "@/lib/permissions";
import type { LogEntry } from "@/lib/log-types";

/**
 * @api GET /api/logs/ai-calls
 * @visibility internal
 * @scope logs:read
 * @auth session
 * @tags logs
 * @description Returns parsed log entries from the AppLog table, newest first (max 100). Includes current logging status and enabled log types. Supports filtering by log type.
 * @query type string - Filter by log type(s), comma-separated: "ai", "api", "system", "user" (optional)
 * @response 200 { logs: [...], loggingEnabled: boolean, enabledTypes: [...] }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const loggingEnabled = isLoggingEnabled();
    const enabledTypes = getEnabledTypes();

    const typeFilter = request.nextUrl.searchParams.get("type");
    const filterTypes = typeFilter ? typeFilter.split(",") : null;

    const rows = await prisma.appLog.findMany({
      where: filterTypes ? { type: { in: filterTypes } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Map DB rows to the LogEntry shape the LogViewer expects
    const logs: LogEntry[] = rows.map((row) => ({
      timestamp: row.createdAt.toISOString(),
      type: row.type as LogEntry["type"],
      stage: row.stage,
      ...(row.level ? { level: row.level as LogEntry["level"] } : {}),
      message: row.message ?? undefined,
      promptLength: row.promptLength ?? undefined,
      promptPreview: row.promptPreview ?? undefined,
      responseLength: row.responseLength ?? undefined,
      responsePreview: row.responsePreview ?? undefined,
      usage:
        row.inputTokens != null || row.outputTokens != null
          ? { inputTokens: row.inputTokens ?? undefined, outputTokens: row.outputTokens ?? undefined }
          : undefined,
      durationMs: row.durationMs ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    }));

    return NextResponse.json({ logs, loggingEnabled, enabledTypes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({
      logs: [],
      loggingEnabled: true,
      enabledTypes: ["ai", "api", "system", "user"],
      error: message,
    });
  }
}

/**
 * @api PATCH /api/logs/ai-calls
 * @visibility internal
 * @scope logs:write
 * @auth session
 * @tags logs
 * @description Toggle logging on/off and/or set which log types are enabled. Both fields are optional and can be set independently. Config is DB-backed via SystemSetting.
 * @body enabled boolean - Enable or disable logging (optional)
 * @body enabledTypes string[] - Array of log types to enable: "ai", "api", "system", "user" (optional)
 * @response 200 { ok: true, loggingEnabled: boolean, enabledTypes: [...] }
 * @response 400 { ok: false, error: "..." }
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();

    if (typeof body.enabled === "boolean") {
      await setLoggingEnabled(body.enabled);
    }

    if (Array.isArray(body.enabledTypes)) {
      await setEnabledTypes(body.enabledTypes as LogType[]);
    }

    return NextResponse.json({
      ok: true,
      loggingEnabled: isLoggingEnabled(),
      enabledTypes: getEnabledTypes(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/**
 * @api DELETE /api/logs/ai-calls
 * @visibility internal
 * @scope logs:write
 * @auth session
 * @tags logs
 * @description Clears all log entries from the AppLog table.
 * @response 200 { ok: true, deleted: number }
 */
export async function DELETE() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const result = await prisma.appLog.deleteMany();
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message });
  }
}
