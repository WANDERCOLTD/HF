import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import MicrosoftEntraIDProvider from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { sendMagicLinkEmail, EMAIL_FROM_DEFAULT } from "./email";
import { withRenamedSessionModel } from "./auth/with-renamed-session-model";
import type { UserRole } from "@prisma/client";
import type { Provider } from "next-auth/providers";

// NextAuth carries its own nested `@auth/core` copy, so the `Adapter` type
// it consumes at its config boundary differs nominally from the top-level
// `@auth/core` Adapter that `@auth/prisma-adapter` returns. Both are
// structurally identical — they're the same source file installed twice
// due to npm dedupe semantics. We extract NextAuth's adapter type from
// its own `NextAuthConfig` and cast through `unknown` at the single
// boundary, rather than letting the resolution gap leak further into the
// codebase. (Not a behaviour change; the wrapper at
// `./auth/with-renamed-session-model.ts` enforces the AdapterSession
// surface contract by construction.)
type NextAuthCfg = Exclude<
  Parameters<typeof NextAuth>[0],
  (...args: never[]) => unknown
>;
type NextAuthAdapter = NonNullable<
  NextAuthCfg extends { adapter?: infer A } ? A : never
>;

/**
 * OAuth providers (#1141 follow-up). Each provider is registered ONLY
 * when its env vars are present, so the code ships safely without the
 * operator having created the OAuth apps yet — `/api/auth/providers`
 * just won't list a provider whose credentials are missing. The /login
 * UI iterates the response and renders a button per registered provider.
 *
 * To enable Google:
 *   1. Create an OAuth 2.0 Client ID in Google Cloud Console
 *      (https://console.cloud.google.com/apis/credentials)
 *   2. Authorised redirect URIs:
 *      - http://localhost:3000/api/auth/callback/google (local dev)
 *      - https://dev.humanfirstfoundation.com/api/auth/callback/google
 *      - https://staging.humanfirstfoundation.com/api/auth/callback/google
 *      - https://app.humanfirstfoundation.com/api/auth/callback/google
 *   3. Store creds in Secret Manager as GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
 *   4. Reference them in the Cloud Run service (see hf-admin-dev for
 *      the RESEND_API_KEY pattern, set in this session)
 *
 * To enable Microsoft Entra (Azure AD):
 *   1. Register an app at https://entra.microsoft.com
 *   2. Add redirect URI matching the routes above (substituting `microsoft-entra-id`)
 *   3. Add API permission Microsoft.Graph.User.Read (delegated)
 *   4. Generate a client secret
 *   5. Store as AZURE_AD_CLIENT_ID + AZURE_AD_CLIENT_SECRET + AZURE_AD_TENANT_ID
 *      (tenant can be 'common' for multi-tenant)
 */
function oauthProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    list.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Force account selection on every sign-in attempt so users with
        // multiple Google accounts always pick the right one.
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }
  if (
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET
  ) {
    list.push(
      MicrosoftEntraIDProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
        // 'common' = multi-tenant (any Microsoft work or school account).
        // Override with a specific tenant id if HF goes single-tenant.
        issuer: `https://login.microsoftonline.com/${
          process.env.AZURE_AD_TENANT_ID ?? "common"
        }/v2.0`,
      }),
    );
  }
  return list;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      role: UserRole;
      assignedDomainId: string | null;
      institutionId: string | null;
      avatarInitials: string | null;
      // Owned LEARNER Caller.id for STUDENT sessions. null for non-STUDENT roles
      // or transient null for STUDENTs with no LEARNER profile yet. Used by
      // middleware.ts to enforce path-scope on /api/callers/[callerId]/** and
      // /api/caller-graph/[callerId]/** without a DB hit at the edge.
      learnerCallerId: string | null;
    };
  }

  interface User {
    role: UserRole;
    assignedDomainId?: string | null;
    institutionId?: string | null;
    avatarInitials?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    learnerCallerId?: string | null;
  }
}

// Warn early if email is not configured (magic links will fail silently otherwise)
if (!process.env.SMTP_PASSWORD && !process.env.RESEND_API_KEY) {
  console.warn("[auth] No SMTP_PASSWORD or RESEND_API_KEY set — magic link emails will fail. Set one to enable email sign-in.");
}

// `@auth/prisma-adapter` returns the top-level `@auth/core` Adapter, but
// our wrapper imports its Adapter type from `next-auth/adapters` — which
// resolves to the nested copy. Cast the PrismaAdapter return through
// `unknown` to bridge the two structurally-identical types at this single
// boundary. The wrapper preserves the AdapterSession surface contract.
const adapter = withRenamedSessionModel(
  PrismaAdapter(prisma) as unknown as NextAuthAdapter,
  prisma,
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  // #1341 — NextAuth's `model Session` was renamed to `AuthSession` so
  // the canonical learner-Session parent can take the simple name.
  // The wrapper redirects the adapter's four session methods at
  // `prisma.authSession.*`. JWT strategy makes these dormant for
  // credentials sign-in, but the wrapper keeps them functional.
  // See the `// NextAuth carries…` block above the imports for why this
  // is routed through `unknown`.
  adapter,
  session: {
    strategy: "jwt", // JWT for credentials support
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify",
    error: "/login/error",
  },
  providers: [
    // Password login (for dev/demo - no email setup needed)
    CredentialsProvider({
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        console.log("[Auth] Authorize called with:", credentials?.email);

        if (!credentials?.email || !credentials?.password) {
          console.log("[Auth] Missing credentials");
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            isActive: true,
            role: true,
            assignedDomainId: true,
            institutionId: true,
            avatarInitials: true,
          },
        });

        console.log("[Auth] User found:", user?.email, "active:", user?.isActive);

        if (!user || !user.isActive) {
          console.log("[Auth] User not found or inactive");
          return null;
        }

        // Check password
        if (user.passwordHash) {
          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash
          );
          if (!valid) {
            console.log("[Auth] Password hash check failed");
            return null;
          }
        } else {
          // No password set — password auth unavailable for this user.
          // Use magic link or set SEED_ADMIN_PASSWORD in seed script.
          console.log("[Auth] No passwordHash set, password auth unavailable");
          return null;
        }

        console.log("[Auth] Success, returning user");
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          assignedDomainId: user.assignedDomainId,
          avatarInitials: user.avatarInitials,
        };
      },
    }),
    // Magic link (when email is configured)
    EmailProvider({
      server: {
        host: process.env.SMTP_HOST || "smtp.resend.com",
        port: parseInt(process.env.SMTP_PORT || "587"),
        auth: {
          user: process.env.SMTP_USER || "resend",
          pass: process.env.SMTP_PASSWORD || process.env.RESEND_API_KEY || "",
        },
      },
      from: process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT,
      sendVerificationRequest: async ({ identifier: email, url }) => {
        await sendMagicLinkEmail({ to: email, url });
      },
    }),
    // OAuth providers — only registered when env vars are set, so the
    // /api/auth/providers response (which the /login UI iterates) only
    // shows providers that actually work. See oauthProviders() above for
    // setup instructions.
    ...oauthProviders(),
  ],
  callbacks: {
    async signIn({ user, account }) {
      console.log("[Auth signIn callback] provider:", account?.provider, "user:", user?.email);

      // Credentials provider handles its own validation
      if (account?.provider === "credentials") {
        console.log("[Auth signIn callback] Credentials - allowing");
        return true;
      }

      if (!user.email) return false;

      // Check if user has a valid invite or already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (existingUser) {
        // Existing user - allow sign in if active
        return existingUser.isActive;
      }

      // New user policy depends on the provider:
      // - OAuth (google / microsoft-entra-id): allow auto-signup as
      //   STUDENT for the market test phase. PrismaAdapter creates the
      //   User row from the OAuth profile; the User.role default in the
      //   schema is STUDENT. Tighten this later (require invite, restrict
      //   to verified-domain emails, etc.) by flipping the env flag
      //   AUTH_OAUTH_REQUIRE_INVITE=1.
      // - Email (magic link) + everything else: require a valid Invite
      //   row. Existing behaviour, unchanged.
      const isOauth =
        account?.provider === "google" ||
        account?.provider === "microsoft-entra-id";
      const oauthRequiresInvite =
        process.env.AUTH_OAUTH_REQUIRE_INVITE === "1";

      if (isOauth && !oauthRequiresInvite) {
        console.log(
          `[Auth signIn callback] OAuth ${account?.provider} new user — auto-signup as STUDENT`,
        );
        return true;
      }

      const invite = await prisma.invite.findFirst({
        where: {
          email: user.email,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!invite) {
        console.log(
          `[Auth signIn callback] No valid invite for ${user.email} via ${account?.provider} — rejecting`,
        );
        return false;
      }

      return true;
    },

    async jwt({ token, user, trigger }) {
      // On sign in, add user info to token
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.assignedDomainId = user.assignedDomainId ?? null;
        token.institutionId = user.institutionId ?? null;
        token.avatarInitials = user.avatarInitials ?? null;
        // Stamp learnerCallerId on sign-in for STUDENTs so middleware
        // can enforce caller-scope at the edge without a DB hit (A5).
        if (user.role === "STUDENT") {
          const owned = await prisma.caller.findFirst({
            where: { userId: user.id, role: "LEARNER" },
            select: { id: true },
          });
          token.learnerCallerId = owned?.id ?? null;
        } else {
          token.learnerCallerId = null;
        }
      }
      // On session update (e.g. after profile save), refresh from DB
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { avatarInitials: true, name: true, role: true, assignedDomainId: true, institutionId: true },
        });
        if (fresh) {
          token.avatarInitials = fresh.avatarInitials ?? null;
          token.name = fresh.name;
          token.role = fresh.role;
          token.assignedDomainId = fresh.assignedDomainId ?? null;
          token.institutionId = fresh.institutionId ?? null;
          if (fresh.role === "STUDENT") {
            const owned = await prisma.caller.findFirst({
              where: { userId: token.id as string, role: "LEARNER" },
              select: { id: true },
            });
            token.learnerCallerId = owned?.id ?? null;
          } else {
            token.learnerCallerId = null;
          }
        }
      }
      // Validate user still exists in DB (catches stale JWT after db:reset).
      // Check at most once per 5 minutes to avoid a DB hit on every request.
      if (token.id && !user) {
        const now = Date.now();
        const lastCheck = (token.userExistsCheckedAt as number) ?? 0;
        if (now - lastCheck > 5 * 60 * 1000) {
          const exists = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { id: true, role: true },
          });
          if (!exists) {
            // User was deleted (e.g. db:reset) — clear token to force re-login
            return { ...token, id: null, role: null };
          }
          // Backfill learnerCallerId for sessions issued before A5 landed,
          // or refresh if a STUDENT's LEARNER caller was rotated.
          if (exists.role === "STUDENT" && token.learnerCallerId === undefined) {
            const owned = await prisma.caller.findFirst({
              where: { userId: token.id as string, role: "LEARNER" },
              select: { id: true },
            });
            token.learnerCallerId = owned?.id ?? null;
          } else if (exists.role !== "STUDENT" && token.learnerCallerId !== null) {
            token.learnerCallerId = null;
          }
          token.userExistsCheckedAt = now;
        }
      }
      return token;
    },

    async session({ session, token }) {
      // For JWT sessions, get user info from token
      if (token) {
        // If user was invalidated (deleted after db:reset), strip session
        if (!token.id) {
          (session as any).user = undefined;
          return session;
        }
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.assignedDomainId = (token.assignedDomainId as string) ?? null;
        session.user.institutionId = (token.institutionId as string) ?? null;
        session.user.avatarInitials = (token.avatarInitials as string) ?? null;
        session.user.learnerCallerId = (token.learnerCallerId as string | null) ?? null;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.email) return;

      // Find and consume the invite, apply the role
      const invite = await prisma.invite.findFirst({
        where: {
          email: user.email,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (invite) {
        await prisma.$transaction([
          // Mark invite as used
          prisma.invite.update({
            where: { id: invite.id },
            data: { usedAt: new Date() },
          }),
          // Apply the role from the invite
          prisma.user.update({
            where: { id: user.id },
            data: { role: invite.role },
          }),
        ]);
      }
    },
  },
});
