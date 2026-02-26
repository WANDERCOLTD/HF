import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TEMPLATE_SETS } from "@/lib/institution-types/group-templates";

/**
 * @api GET /api/playbook-groups/templates
 * @visibility internal
 * @scope groups:read
 * @auth bearer
 * @tags groups, departments, templates
 * @query typeSlug - Optional institution type slug to filter templates (e.g. "school", "corporate")
 * @description List available group templates, optionally filtered by institution type.
 * @response 200 { ok: true, templates: [...], defaultId: string|null }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const typeSlug = request.nextUrl.searchParams.get("typeSlug");

  let templates = TEMPLATE_SETS;
  if (typeSlug) {
    templates = templates.filter((t) => t.forTypes.includes(typeSlug));
  }

  const defaultTemplate = templates.find((t) => t.isDefault) || null;

  return NextResponse.json({
    ok: true,
    templates: templates.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      forTypes: t.forTypes,
      isDefault: t.isDefault || false,
      groupCount: t.groups.length,
      groups: t.groups.map((g) => ({
        name: g.name,
        groupType: g.groupType,
        styleNotes: g.styleNotes || null,
      })),
    })),
    defaultId: defaultTemplate?.id || null,
  });
}
