import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import sidebarManifest from "@/lib/sidebar/sidebar-manifest.json";

const SETTING_KEY = "sidebar.visibility_rules";

type SidebarVisibilityRules = {
  sections: Record<
    string,
    { requiredRole: string | null; defaultHiddenFor: string[] }
  >;
};

const VALID_ROLES = ["SUPERADMIN", "ADMIN", "OPERATOR", "SUPER_TESTER", "TESTER", "DEMO"];
const SECTION_IDS = (sidebarManifest as { id: string }[]).map((s) => s.id);

/**
 * Build default visibility rules from the sidebar manifest JSON
 */
function buildDefaultRules(): SidebarVisibilityRules {
  const sections: SidebarVisibilityRules["sections"] = {};
  for (const section of sidebarManifest as { id: string; requiredRole?: string; defaultHiddenFor?: string[] }[]) {
    sections[section.id] = {
      requiredRole: section.requiredRole ?? null,
      defaultHiddenFor: section.defaultHiddenFor ?? [],
    };
  }
  return { sections };
}

/**
 * @api GET /api/admin/access-control/sidebar-visibility
 * @auth ADMIN
 * @description Load sidebar visibility rules (DB-backed, falls back to manifest)
 */
export async function GET() {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY },
  });

  if (setting) {
    const rules = JSON.parse(setting.value) as SidebarVisibilityRules;
    return NextResponse.json({ ok: true, rules, source: "db" });
  }

  return NextResponse.json({ ok: true, rules: buildDefaultRules(), source: "manifest" });
}

/**
 * @api POST /api/admin/access-control/sidebar-visibility
 * @auth ADMIN
 * @description Save sidebar visibility rules
 */
export async function POST(req: Request) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const body = await req.json();
  const rules = body.rules as SidebarVisibilityRules;

  // Validate structure
  if (!rules?.sections || typeof rules.sections !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'rules.sections'" },
      { status: 400 }
    );
  }

  // Validate each section
  for (const [sectionId, config] of Object.entries(rules.sections)) {
    if (!SECTION_IDS.includes(sectionId)) {
      return NextResponse.json(
        { ok: false, error: `Unknown section ID: ${sectionId}` },
        { status: 400 }
      );
    }
    if (config.requiredRole !== null && !VALID_ROLES.includes(config.requiredRole)) {
      return NextResponse.json(
        { ok: false, error: `Invalid role for section '${sectionId}': ${config.requiredRole}` },
        { status: 400 }
      );
    }
    if (!Array.isArray(config.defaultHiddenFor)) {
      return NextResponse.json(
        { ok: false, error: `defaultHiddenFor must be an array for section '${sectionId}'` },
        { status: 400 }
      );
    }
    for (const role of config.defaultHiddenFor) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json(
          { ok: false, error: `Invalid role in defaultHiddenFor for '${sectionId}': ${role}` },
          { status: 400 }
        );
      }
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(rules) },
    create: { key: SETTING_KEY, value: JSON.stringify(rules) },
  });

  return NextResponse.json({ ok: true });
}
