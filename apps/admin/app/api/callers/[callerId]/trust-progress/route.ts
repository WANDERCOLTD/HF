import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurriculumProgress,
  getActiveCurricula,
  computeTrustWeightedProgress,
  extractModuleTrustLevels,
} from "@/lib/curriculum/track-progress";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/trust-progress
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, content-trust
 * @description Compute trust-weighted progress for a caller across all active curricula
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, curricula: TrustProgressEntry[] }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;


    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    // Verify caller exists
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { id: true },
    });

    if (!caller) {
      return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
    }

    // Get all curricula the caller has progress in
    let specSlugs: string[];
    try {
      specSlugs = await getActiveCurricula(callerId);
    } catch {
      // Contract not loaded — return empty
      return NextResponse.json({ ok: true, curricula: [] });
    }

    if (specSlugs.length === 0) {
      return NextResponse.json({ ok: true, curricula: [] });
    }

    // For each curriculum, compute trust-weighted progress
    const curricula = await Promise.all(
      specSlugs.map(async (specSlug) => {
        // Get mastery progress
        const progress = await getCurriculumProgress(callerId, specSlug);

        // Find the CONTENT spec to get module trust levels
        const contentSpec = await prisma.analysisSpec.findFirst({
          where: {
            slug: specSlug,
            specRole: "CONTENT",
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            slug: true,
            config: true,
          },
        });

        // Extract module trust levels from spec config
        let moduleTrustLevels: Record<string, string> = {};
        if (contentSpec?.config) {
          const config = contentSpec.config as Record<string, any>;
          const modules = config?.modules || config?.sourceAuthority?.moduleCoverage || [];
          if (Array.isArray(modules) && modules.length > 0) {
            moduleTrustLevels = await extractModuleTrustLevels(modules);
          }
        }

        // Compute dual-track progress
        const trustProgress = await computeTrustWeightedProgress(
          progress.modulesMastery,
          moduleTrustLevels
        );

        return {
          specSlug,
          specName: contentSpec?.name || specSlug,
          specId: contentSpec?.id || null,
          currentModuleId: progress.currentModuleId,
          lastAccessedAt: progress.lastAccessedAt,
          ...trustProgress,
        };
      })
    );

    return NextResponse.json({ ok: true, curricula });
  } catch (error: any) {
    console.error("[trust-progress] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to compute trust progress" },
      { status: 500 }
    );
  }
}
