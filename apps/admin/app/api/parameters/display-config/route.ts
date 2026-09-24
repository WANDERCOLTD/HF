import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/parameters/display-config
 * @visibility public
 * @scope parameters:read
 * @auth session
 * @tags parameters
 * @description Returns parameter display configuration for UI rendering. Dynamically groups canonical parameters (Big Five, VARK, Other) with labels, colors, and section metadata. No hardcoding.
 * @response 200 { ok: true, grouped: { "Big Five": [], "VARK": [], "Other": [] }, params: Record<string, ParamDisplayInfo>, totalParameters: number }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    // Fetch all canonical parameters that should be displayed in personality profiles
    const parameters = await prisma.parameter.findMany({
      where: {
        isCanonical: true,
        deprecatedAt: null,
      },
      select: {
        parameterId: true,
        name: true,
        definition: true,
        sectionId: true,
        scaleType: true,
        interpretationHigh: true,
        interpretationLow: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Group parameters by category for organized display
    const grouped: Record<string, any[]> = {
      "Big Five": [],
      "VARK": [],
      "Other": [],
    };

    // Assign default colors based on parameter type
    const colorPalette = {
      "BEH-B5-O": "#3b82f6",      // blue
      "BEH-B5-C": "#8b5cf6",      // violet
      "BEH-B5-E": "#10b981",      // emerald
      "BEH-B5-A": "#f59e0b",      // amber
      "BEH-B5-N": "#ef4444",      // red
      "VARK-V": "#3b82f6",    // blue
      "VARK-A": "#8b5cf6",    // violet
      "VARK-R": "#10b981",    // emerald
      "VARK-K": "#f59e0b",    // amber
    };

    for (const param of parameters) {
      const displayInfo = {
        parameterId: param.parameterId,
        label: param.name
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
        description: param.definition || '',
        color: colorPalette[param.parameterId as keyof typeof colorPalette] || "#6b7280", // default gray
        section: param.sectionId || 'Other',
        scaleType: param.scaleType,
        interpretationHigh: param.interpretationHigh,
        interpretationLow: param.interpretationLow,
      };

      // Categorize by parameter ID prefix
      if (param.parameterId.startsWith('B5-')) {
        grouped["Big Five"].push(displayInfo);
      } else if (param.parameterId.startsWith('VARK-')) {
        grouped["VARK"].push(displayInfo);
      } else {
        grouped["Other"].push(displayInfo);
      }
    }

    // Build flat map for quick lookups
    const paramMap: Record<string, any> = {};
    parameters.forEach(param => {
      paramMap[param.parameterId] = {
        parameterId: param.parameterId,
        label: param.name
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
        description: param.definition || '',
        color: colorPalette[param.parameterId as keyof typeof colorPalette] || "#6b7280",
        section: param.sectionId || 'Other',
      };
    });

    return NextResponse.json({
      ok: true,
      grouped,
      params: paramMap,
      totalParameters: parameters.length,
    });
  } catch (error: any) {
    console.error("[api/parameters/display-config] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Failed to fetch parameter display config",
      },
      { status: 500 }
    );
  }
}
