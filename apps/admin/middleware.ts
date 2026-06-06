import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
import { getRequiredRole, hasRequiredRole } from "@/lib/page-roles";

// Edge-compatible middleware - no Node.js dependencies
// For database sessions, we can only check cookie existence here
// Full session validation happens in server components via auth()

const publicRoutes = ["/login", "/login/verify", "/login/error", "/invite", "/join", "/intake"];
// Routes that handle their own auth (webhooks, external APIs)
const apiTokenRoutes = ["/api/auth", "/api/vapi", "/api/voice", "/api/webhook", "/api/invite", "/api/join", "/api/health", "/api/ready", "/api/system/readiness", "/api/system/db-target", "/api/intake", "/api/tallyseal-bridge"];

// Internal API secret for server-to-server calls (bypasses session check)
// No fallback — if unset, internal-secret bypass is disabled (fail-closed)
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

// CORS: allowed origins from env (comma-separated), empty = no cross-origin allowed
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;


/** Add CORS headers to a response if the origin is in the allow-list */
function withCors(response: NextResponse, origin: string | null): NextResponse {
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  return response;
}

/** Prevent Cloudflare/CDN from caching dynamic pages (all non-static responses) */
function noCache(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  return response;
}

/** Session cookie names in priority order */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

/** Get the session cookie name and value */
function getSessionCookie(request: NextRequest) {
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = request.cookies.get(name);
    if (cookie) return { name, value: cookie.value };
  }
  return null;
}

export type TokenClaims = { role: string | null; learnerCallerId: string | null };

/** Decode JWT to extract claims — fail-open on decode errors (fall through to auth()) */
async function getClaimsFromToken(tokenValue: string, cookieName: string): Promise<TokenClaims | null> {
  if (!AUTH_SECRET) return null; // No secret configured — skip decode, let auth() handle it
  try {
    const token = await decode({
      token: tokenValue,
      secret: AUTH_SECRET,
      salt: cookieName,
    });
    if (!token) return null;
    return {
      role: (token.role as string) ?? null,
      learnerCallerId: (token.learnerCallerId as string | null) ?? null,
    };
  } catch {
    // Decode failed — let the request through, auth() will handle it
    return null;
  }
}

/** Path-segment routes where STUDENT sessions must match their own caller (A5). */
const STUDENT_CALLER_SCOPE_PATTERN = /^\/api\/(?:callers|caller-graph)\/([^/]+)(?:\/|$)/;

/**
 * Pure decision function — exported for unit tests. Returns `blocked: true`
 * iff the request path is a caller-scoped route AND the caller is a STUDENT
 * whose claimed `learnerCallerId` does not match the path segment.
 * Non-STUDENT roles and non-caller-scoped paths pass through.
 */
export function checkStudentCallerScope(
  pathname: string,
  claims: TokenClaims | null,
): { blocked: boolean } {
  const match = STUDENT_CALLER_SCOPE_PATTERN.exec(pathname);
  if (!match) return { blocked: false };
  if (claims?.role !== "STUDENT") return { blocked: false };
  return { blocked: claims.learnerCallerId !== match[1] };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");

  // --- CORS preflight for API routes ---
  if (pathname.startsWith("/api/") && request.method === "OPTIONS") {
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-internal-secret",
      "Access-Control-Max-Age": "86400",
    };
    if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return new NextResponse(null, { status: 204, headers });
  }

  // Allow public routes (login pages — still no-cache, they're dynamic)
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return noCache(withCors(NextResponse.next(), origin));
  }

  // Allow API routes with their own auth (APIs set their own cache headers)
  if (apiTokenRoutes.some((route) => pathname.startsWith(route))) {
    return withCors(NextResponse.next(), origin);
  }

  // Allow internal server-to-server API calls with secret header
  const internalSecret = request.headers.get("x-internal-secret");
  if (INTERNAL_API_SECRET && internalSecret === INTERNAL_API_SECRET) {
    return withCors(NextResponse.next(), origin);
  }

  // Check for session cookie (JWT or database session)
  // NextAuth v5 uses different cookie names depending on environment
  const sessionToken = getSessionCookie(request);

  if (!sessionToken) {
    // No session cookie - redirect to login
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // --- STUDENT caller-scope enforcement (A5) ---
  // Closes the leak class fixed at lib/learner-scope.ts (#977) for path-segment
  // routes by checking the JWT's `learnerCallerId` claim against the segment.
  // STUDENTs (role level 1, admitted alongside VIEWER by requireAuth("VIEWER"))
  // can only ever read their own LEARNER caller — supplying a foreign id in the
  // path returns 403 before the handler runs. No DB hit at the edge.
  // Query-param leaks (?callerId=) and callId→callerId routes need per-route
  // helpers and are not handled here.
  if (STUDENT_CALLER_SCOPE_PATTERN.test(pathname)) {
    const claims = await getClaimsFromToken(sessionToken.value, sessionToken.name);
    if (checkStudentCallerScope(pathname, claims).blocked) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: "Forbidden — caller scope mismatch" }),
        { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }
  }

  // --- Page-level RBAC enforcement ---
  // Check if this /x/ page requires a minimum role (derived from sidebar manifest)
  if (pathname.startsWith("/x/")) {
    const requiredRole = getRequiredRole(pathname);
    if (requiredRole) {
      const claims = await getClaimsFromToken(sessionToken.value, sessionToken.name);
      if (claims?.role && !hasRequiredRole(claims.role, requiredRole)) {
        // Insufficient role — redirect to dashboard
        return NextResponse.redirect(new URL("/x", request.nextUrl.origin));
      }
      // If role is null (decode failed), fall through — auth() will catch it
    }
  }

  // Session cookie exists - allow (full validation in server components)
  return noCache(withCors(NextResponse.next(), origin));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|icons/.*|sounds/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
