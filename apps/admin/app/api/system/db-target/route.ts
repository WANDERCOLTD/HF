import { NextResponse } from "next/server";

/**
 * @api GET /api/system/db-target
 * @visibility public
 * @auth none
 * @description Returns the live DB target name parsed from the runtime DATABASE_URL.
 *   Used by the status-bar chip and avatar ring so they reflect a live
 *   `/db-route` secret-rebind without a rebuild. NEXT_PUBLIC_DB_TARGET is
 *   build-baked and can't follow a runtime secret change.
 * @response 200 { ok: true, dbTarget: "sandbox" | "staging" | "pilot" | "prod" | null, dbName: string | null }
 */
export const dynamic = "force-dynamic";

function parseDbName(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/([a-zA-Z0-9_-]+)(?:\?|$)/);
  return m?.[1] ?? null;
}

function nameToTarget(dbName: string | null): string | null {
  if (!dbName) return null;
  const stripped = dbName.replace(/^hf_/, "").toLowerCase();
  if (["sandbox", "staging", "pilot", "prod", "dev"].includes(stripped)) {
    return stripped === "dev" ? "sandbox" : stripped;
  }
  return null;
}

export async function GET() {
  const dbName = parseDbName(process.env.DATABASE_URL);
  const dbTarget = nameToTarget(dbName);
  return NextResponse.json({ ok: true, dbTarget, dbName });
}
