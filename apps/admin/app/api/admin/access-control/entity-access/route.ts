import { NextResponse } from "next/server";
import { requireAuth, isAuthError, ROLE_LEVEL } from "@/lib/permissions";
import { requireEntityAccess, isEntityAuthError, invalidateAccessCache } from "@/lib/access-control";
import { ContractRegistry } from "@/lib/contracts/registry";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { auditLog, AuditAction } from "@/lib/audit";
import type { UserRole } from "@prisma/client";

const VALID_SCOPES = ["ALL", "DOMAIN", "OWN", "NONE"];
const VALID_OPS = ["C", "R", "U", "D"];

/**
 * @api GET /api/admin/access-control/entity-access
 * @auth ADMIN
 * @description Load the ENTITY_ACCESS_V1 contract for the access matrix editor
 */
export async function GET() {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const contract = await ContractRegistry.getContract(config.specs.entityAccessV1);

  if (!contract) {
    return NextResponse.json(
      { ok: false, error: "ENTITY_ACCESS_V1 contract not found. Run npm run db:seed to populate." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, contract });
}

/**
 * @api POST /api/admin/access-control/entity-access
 * @auth rbac_policy:U
 * @description Update the ENTITY_ACCESS_V1 contract matrix (meta-RBAC: caller can only modify roles strictly below their authority level)
 */
export async function POST(req: Request) {
  // Meta-RBAC: permission to modify the access matrix is itself governed by the access matrix
  const authResult = await requireEntityAccess("rbac_policy", "U");
  if (isEntityAuthError(authResult)) return authResult.error;

  const { session } = authResult;

  const body = await req.json();
  const matrix = body.matrix as Record<string, Record<string, string>>;

  if (!matrix || typeof matrix !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'matrix'" },
      { status: 400 }
    );
  }

  // Meta-RBAC authority enforcement: caller can only modify roles strictly below their authority level
  const callerLevel = ROLE_LEVEL[session.user.role];
  for (const entity of Object.keys(matrix)) {
    const roles = matrix[entity];
    if (typeof roles !== "object") {
      return NextResponse.json(
        { ok: false, error: `Invalid roles object for entity '${entity}'` },
        { status: 400 }
      );
    }
    for (const role of Object.keys(roles)) {
      const targetLevel = ROLE_LEVEL[role as UserRole] ?? -1;
      if (targetLevel >= callerLevel) {
        return NextResponse.json(
          {
            ok: false,
            error: `Cannot modify rules for role '${role}' — same or higher authority level than ${session.user.role}`,
          },
          { status: 403 }
        );
      }
    }
  }

  // Validate matrix entries
  for (const [entity, roles] of Object.entries(matrix)) {
    if (typeof roles !== "object") {
      return NextResponse.json(
        { ok: false, error: `Invalid roles object for entity '${entity}'` },
        { status: 400 }
      );
    }
    for (const [role, rule] of Object.entries(roles)) {
      if (rule === "NONE") continue; // NONE with no ops is valid shorthand
      const parts = rule.split(":");
      if (parts.length !== 2) {
        return NextResponse.json(
          { ok: false, error: `Invalid rule format for ${entity}.${role}: '${rule}' (expected SCOPE:OPS)` },
          { status: 400 }
        );
      }
      const [scope, ops] = parts;
      if (!VALID_SCOPES.includes(scope)) {
        return NextResponse.json(
          { ok: false, error: `Invalid scope for ${entity}.${role}: '${scope}'` },
          { status: 400 }
        );
      }
      if (scope === "NONE" && ops) {
        return NextResponse.json(
          { ok: false, error: `NONE scope cannot have operations for ${entity}.${role}` },
          { status: 400 }
        );
      }
      for (const op of ops.split("")) {
        if (!VALID_OPS.includes(op)) {
          return NextResponse.json(
            { ok: false, error: `Invalid operation '${op}' for ${entity}.${role}` },
            { status: 400 }
          );
        }
      }
    }
  }

  // Load existing contract, merge in updated matrix
  const contract = await ContractRegistry.getContract(config.specs.entityAccessV1);
  if (!contract) {
    return NextResponse.json(
      { ok: false, error: "ENTITY_ACCESS_V1 contract not found. Run npm run db:seed first." },
      { status: 404 }
    );
  }

  const updated = { ...contract, matrix };

  await prisma.systemSetting.upsert({
    where: { key: "contract:ENTITY_ACCESS_V1" },
    update: { value: JSON.stringify(updated) },
    create: { key: "contract:ENTITY_ACCESS_V1", value: JSON.stringify(updated) },
  });

  // Bust cache so changes take effect immediately
  invalidateAccessCache();

  // Log the change
  await auditLog({
    userId: session.user.id,
    userEmail: session.user.email,
    action: AuditAction.UPDATED_ENTITY_ACCESS,
    entityType: "EntityAccessMatrix",
    metadata: { modifiedRoles: Object.keys(matrix.reduce((acc: Record<string, boolean>, entity: string) => {
      Object.keys(matrix[entity]).forEach(role => { acc[role] = true; });
      return acc;
    }, {})) },
  });

  return NextResponse.json({ ok: true });
}
