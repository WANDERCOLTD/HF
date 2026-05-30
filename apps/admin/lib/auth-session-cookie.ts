import type { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

export interface SessionTokenUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
}

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function getSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/**
 * Mint a NextAuth v5 session JWT and write it to the response as the
 * session cookie. The salt passed to `encode` MUST match the cookie name
 * — NextAuth's reader derives its decryption key from `secret + salt`,
 * so any mismatch yields a silently-unreadable token (issue #980).
 */
export async function mintAndSetSessionCookie(
  response: NextResponse,
  user: SessionTokenUser,
  options: { skipCookie?: boolean } = {},
): Promise<NextResponse> {
  if (options.skipCookie) return response;

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error("MISSING_NEXTAUTH_SECRET");

  const cookieName = getSessionCookieName();
  const isProduction = process.env.NODE_ENV === "production";

  const jwt = await encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    secret,
    salt: cookieName,
    maxAge: MAX_AGE_SECONDS,
  });

  response.cookies.set(cookieName, jwt, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });

  return response;
}
