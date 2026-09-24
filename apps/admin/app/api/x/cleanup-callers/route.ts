import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallerData } from "@/lib/gdpr/delete-caller-data";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/x/cleanup-callers
 * @visibility internal
 * @scope dev:cleanup
 * @auth bearer
 * @tags dev-tools
 * @description Deletes all callers that have 0 calls (orphaned records). Removes related records (memories, attributes, targets, personality data) before deleting the caller.
 * @response 200 { ok: true, message: "...", deleted: number, skipped: number, remaining: number, errors?: [...] }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    // Find all callers with 0 calls
    const allCallers = await prisma.caller.findMany({
      include: {
        _count: { select: { calls: true } },
      },
    });

    const orphaned = allCallers.filter((c) => c._count.calls === 0);

    let deleted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const caller of orphaned) {
      try {
        await deleteCallerData(caller.id);
        deleted++;
      } catch (e: any) {
        // If deletion fails (e.g., other FK constraints), skip it
        errors.push(`${caller.name || caller.id}: ${e.message}`);
        skipped++;
      }
    }

    // Get final count
    const remaining = await prisma.caller.count();

    return NextResponse.json({
      ok: true,
      message: `Deleted ${deleted} orphaned callers${skipped > 0 ? `, skipped ${skipped}` : ""}`,
      deleted,
      skipped,
      remaining,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    });
  } catch (error: any) {
    console.error("POST /api/x/cleanup-callers error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Cleanup failed" },
      { status: 500 }
    );
  }
}
