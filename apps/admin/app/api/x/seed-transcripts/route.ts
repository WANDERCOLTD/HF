import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { deleteCallersData } from "@/lib/gdpr/delete-caller-data";
import { config } from "@/lib/config";

/**
 * @api POST /api/x/seed-transcripts
 * @visibility internal
 * @scope dev:seed
 * @auth bearer
 * @tags dev-tools
 * @description Recursively imports all transcript files (.json, .txt) from HF_KB_PATH/sources/transcripts/raw. Wraps the /api/transcripts/import endpoint. In "replace" mode, deletes ALL existing callers and calls first. In "keep" mode, skips duplicates.
 * @body mode string - "replace" (delete all first) or "keep" (skip duplicates, default)
 * @response 200 { ok: true, message: "...", sourceDir: "...", mode: "...", details: {...} }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    // Parse body to get mode
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || "keep";

    // If replace mode, delete all existing callers and calls first
    if (mode === "replace") {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();

      try {
        console.log("🗑️  REPLACE mode: Deleting all existing Callers and Calls...");

        // CALLER-scope BehaviorTargets that are NOT pinned to a caller
        // identity: the chokepoint removes identity-scoped rows, these have
        // no identity to hang off.
        await prisma.behaviorTarget.deleteMany({
          where: { scope: "CALLER", callerIdentityId: null },
        });

        const allCallers = await prisma.caller.findMany({ select: { id: true } });
        await deleteCallersData(
          allCallers.map((c) => c.id),
          prisma,
        );

        console.log("   ✓ All Callers and Calls deleted");
      } finally {
        await prisma.$disconnect();
      }
    }

    // Determine domain - check if companion domain exists, otherwise use default
    const domainSlug = await determineDomainSlug();

    // Call the existing import endpoint with fromKbPath mode
    const importUrl = new URL("/api/transcripts/import", request.url);
    const importResponse = await fetch(importUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": config.security.internalApiSecret,
      },
      body: JSON.stringify({
        fromKbPath: true,
        domainSlug,
      }),
    });

    const importResult = await importResponse.json();

    if (importResult.ok) {
      const modeLabel = mode === "replace" ? " (replaced all existing)" : " (kept existing, skipped duplicates)";
      return NextResponse.json({
        ok: true,
        message: `Imported ${importResult.callsImported} calls from ${importResult.created} new callers (${importResult.filesProcessed} files processed)${modeLabel}`,
        sourceDir: importResult.sourceDir,
        mode,
        details: importResult,
      });
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: importResult.error || "Import failed",
          details: importResult,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("POST /api/x/seed-transcripts error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to import transcripts",
      },
      { status: 500 }
    );
  }
}

/**
 * Determines which domain to assign imported callers to
 * Priority: companion > wnf > default
 */
async function determineDomainSlug(): Promise<string> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Check for companion domain
    const companion = await prisma.domain.findUnique({
      where: { slug: "companion" },
    });
    if (companion) return "companion";

    // Check for WNF domain
    const wnf = await prisma.domain.findUnique({
      where: { slug: "wnf" },
    });
    if (wnf) return "wnf";

    // Check for default domain
    const defaultDomain = await prisma.domain.findFirst({
      where: { slug: "default" },
    });
    if (defaultDomain) return "default";

    // If no domains exist, use "default" (will be created by import)
    return "default";
  } finally {
    await prisma.$disconnect();
  }
}
