/**
 * @api {get} /api/tallyseal-bridge/[...slug]
 * @description Phase 1 admin-bridge mount — exposes read-only audit
 *   inspection endpoints (`/health`, `/intents`, `/intent/:id/events`,
 *   `/intent/:id/bundle`, `/intent/:id/bundle.pdf`) to the tallyseal
 *   admin-viewer UI per Sprint D.
 *
 * Auth: bridgeAuthFromStaticKey against TALLYSEAL_BRIDGE_DEV_SECRET
 * (dev-mode only; Phase 2 switches to bridgeAuthFromOidc per
 * Q-BRIDGE-RECORDER-DURABILITY hardening item).
 *
 * Scope: EnrollmentIntake → compliance-officer →
 * events + bundle-jsonld + bundle-pdf. Default-DENY everywhere else.
 *
 * Phase 1 posture (intentional gaps, all documented in tallyseal Q-A):
 *   - bundleSource.load → null → 404 for /intent/:id/*
 *   - intentLister.list → []
 *   - PrismaNoopProjection.current() → null → 403 for scope-filtered
 *     endpoints. Only /health and /intents return 200 in Phase 1.
 *   - accessRecorder is a no-op (Q-BRIDGE-RECORDER-DURABILITY).
 *
 * Middleware bypass: /api/tallyseal-bridge MUST be in
 * apps/admin/middleware.ts apiTokenRoutes — the bridge handles its
 * own auth via bridgeAuthFromStaticKey, NOT NextAuth session.
 *
 * Env: TALLYSEAL_BRIDGE_DEV_SECRET — bearer secret the bridge
 * compares against in constant time. Dev-mode only.
 */

import {
  createBridgeRouter,
  bridgeAuthFromStaticKey,
  toNextRouteHandler,
  type BridgeRouter,
  type BridgeActor,
} from "@tallyseal/admin-bridge";
import { getEventStore } from "@/lib/intake/hf-adapter/event-store";
import { getProjection } from "@/lib/intake/hf-adapter/projection";
import {
  bundleSource,
  intentLister,
  accessRecorder,
} from "@/lib/intake/hf-adapter/bridge-callbacks";

const DEV_ACTOR: BridgeActor = {
  id: "dev-compliance-officer" as BridgeActor["id"],
  role: "compliance-officer" as BridgeActor["role"],
  orgId: "hf-dev" as BridgeActor["orgId"],
  name: "Dev Compliance Officer",
};

type WebHandler = (request: Request) => Promise<Response>;

// Lazy handler singleton — built on first request (not at module
// import) because getEventStore() is async and lazy-migrates the
// @tallyseal/prisma-adapter ledger on first call. In-flight-promise
// guard pattern mirrors lib/intake/hf-adapter/event-store.ts:41-54 so
// concurrent first-requests on cold start don't double-init.
let handlerSingleton: WebHandler | null = null;
let handlerInFlight: Promise<WebHandler> | null = null;

async function getBridgeHandler(): Promise<WebHandler> {
  if (handlerSingleton) return handlerSingleton;
  if (handlerInFlight) return handlerInFlight;
  handlerInFlight = (async () => {
    const secret = process.env.TALLYSEAL_BRIDGE_DEV_SECRET;
    if (!secret) {
      throw new Error(
        "[tallyseal-bridge] TALLYSEAL_BRIDGE_DEV_SECRET is required for Phase 1 dev-mode auth.",
      );
    }
    const eventStore = await getEventStore();
    const projection = getProjection();
    const router: BridgeRouter = createBridgeRouter({
      eventStore,
      projection,
      authVerify: bridgeAuthFromStaticKey({ secret, actor: DEV_ACTOR }),
      intentScopes: {
        defaultPolicy: "deny",
        perIntent: {
          EnrollmentIntake: {
            allowedRoles: ["compliance-officer"],
            allowedSections: ["events", "bundle-jsonld", "bundle-pdf"],
          },
        },
      },
      bundleSource,
      intentLister,
      accessRecorder,
    });
    const handler = toNextRouteHandler(router, {
      mountPoint: "/api/tallyseal-bridge",
    });
    handlerSingleton = handler;
    return handler;
  })();
  try {
    return await handlerInFlight;
  } finally {
    handlerInFlight = null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const handler = await getBridgeHandler();
  return handler(request);
}

/** Test-only: reset the singleton between fixtures. */
export function __resetBridgeHandlerForTests(): void {
  handlerSingleton = null;
  handlerInFlight = null;
}
