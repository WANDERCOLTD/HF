/**
 * #1341 (epic #1338 Slice 0) — NextAuth PrismaAdapter wrapper.
 *
 * The new learner-facing `model Session` (parent of voice call / sim /
 * text chat / enrolment / assessment) collides with NextAuth's
 * pre-existing `model Session`. We renamed the NextAuth one to
 * `AuthSession` so the canonical learner table can take the simple
 * name. `@auth/prisma-adapter` hardcodes `p.session.*` for its four
 * session methods (`getSessionAndUser`, `createSession`, `updateSession`,
 * `deleteSession`), so we wrap the upstream adapter and redirect those
 * four methods at `prisma.authSession.*`.
 *
 * JWT is the active session strategy (`lib/auth.ts` — `session.strategy:
 * "jwt"`), so these methods are effectively dormant for credentials
 * sign-in. The wrapper still keeps them functional for any future
 * `database` strategy migration or email-magic-link flow that requires
 * a session row.
 *
 * Pattern is intentionally minimal — pass-through everywhere except
 * the four session methods. Bumping `@auth/prisma-adapter` is safe
 * provided the four method signatures don't change; if they do, this
 * file is a small surface to update.
 */
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { PrismaClient } from "@prisma/client";

type SessionRedirected = Adapter & {
  /** Surface marker for tests. */
  __sessionModel: "AuthSession";
};

/**
 * Wrap a `PrismaAdapter(prisma)` so that its session methods read and
 * write `prisma.authSession.*` instead of the dropped `prisma.session.*`.
 *
 * All non-session methods (user / account / verification token /
 * authenticator) are pass-through.
 */
export function withRenamedSessionModel(
  base: Adapter,
  prisma: PrismaClient,
): SessionRedirected {
  return {
    ...base,
    async getSessionAndUser(
      sessionToken: string,
    ): Promise<{ session: AdapterSession; user: AdapterUser } | null> {
      const row = await prisma.authSession.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!row) return null;
      const { user, ...session } = row;
      // The Prisma row shape matches AdapterSession (id, sessionToken,
      // userId, expires) — cast is safe.
      return {
        user: user as unknown as AdapterUser,
        session: session as unknown as AdapterSession,
      };
    },
    async createSession(data: AdapterSession): Promise<AdapterSession> {
      const row = await prisma.authSession.create({
        // Cast through unknown — `stripUndefined` preserves the shape the
        // Prisma client expects but TS can't prove that without a chain
        // through `unknown`.
        data: stripUndefined(
          data as unknown as Record<string, unknown>,
        ) as unknown as Parameters<typeof prisma.authSession.create>[0]["data"],
      });
      return row as unknown as AdapterSession;
    },
    async updateSession(
      data: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">,
    ): Promise<AdapterSession | null | undefined> {
      const row = await prisma.authSession.update({
        where: { sessionToken: data.sessionToken },
        data: stripUndefined(
          data as unknown as Record<string, unknown>,
        ) as unknown as Parameters<typeof prisma.authSession.update>[0]["data"],
      });
      return row as unknown as AdapterSession;
    },
    async deleteSession(sessionToken: string): Promise<void> {
      await prisma.authSession.delete({ where: { sessionToken } });
    },
    __sessionModel: "AuthSession",
  };
}

/** Mirror of the upstream adapter's helper — Prisma errors on undefined. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out as T;
}
