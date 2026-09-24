import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { ContractRegistry } from "@/lib/contracts/registry";
import { config } from "@/lib/config";

/**
 * @api GET /api/admin/access-matrix
 * @visibility internal
 * @scope admin:read
 * @auth session
 * @tags admin, rbac
 * @description Load the ENTITY_ACCESS_V1 contract for the access matrix viewer
 * @response 200 { ok: true, contract: object }
 * @response 404 { ok: false, error: "Contract not found" }
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
