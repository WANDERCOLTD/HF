import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
import { getRequiredRole, hasRequiredRole } from "@/lib/page-roles";

// Edge-compatible middleware - no Node.js dependencies
// For database sessions, we can only check cookie existence here
// Full session validation happens in server components via auth()

const publicRoutes = ["/login", "/login/verify", "/login/error", "/invite", "/join"];
// Routes that handle their own auth (webhooks, external APIs)
const apiTokenRoutes = ["/api/auth", "/api/vapi", "/api/webhook", "/api/invite", "/api/join", "/api/health", "/api/ready", "/api/system/readiness"];

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

/** Decode JWT to extract role — fail-open on decode errors (fall through to auth()) */
async function getRoleFromToken(tokenValue: string, cookieName: string): Promise<string | null> {
  if (!AUTH_SECRET) return null; // No secret configured — skip decode, let auth() handle it
  try {
    const token = await decode({
      token: tokenValue,
      secret: AUTH_SECRET,
      salt: cookieName,
    });
    return (token?.role as string) ?? null;
  } catch {
    // Decode failed — let the request through, auth() will handle it
    return null;
  }
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

  // --- Page-level RBAC enforcement ---
  // Check if this /x/ page requires a minimum role (derived from sidebar manifest)
  if (pathname.startsWith("/x/")) {
    const requiredRole = getRequiredRole(pathname);
    if (requiredRole) {
      const userRole = await getRoleFromToken(sessionToken.value, sessionToken.name);
      if (userRole && !hasRequiredRole(userRole, requiredRole)) {
        // Insufficient role — redirect to dashboard
        return NextResponse.redirect(new URL("/x", request.nextUrl.origin));
      }
      // If userRole is null (decode failed), fall through — auth() will catch it
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
