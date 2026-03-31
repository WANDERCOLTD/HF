import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { sendMagicLinkEmail, EMAIL_FROM_DEFAULT } from "./email";
import type { UserRole } from "@prisma/client";
import type { Adapter } from "next-auth/adapters";

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
    };
  }

  interface User {
    role: UserRole;
    assignedDomainId?: string | null;
    institutionId?: string | null;
    avatarInitials?: string | null;
  }
}

// Warn early if email is not configured (magic links will fail silently otherwise)
if (!process.env.SMTP_PASSWORD && !process.env.RESEND_API_KEY) {
  console.warn("[auth] No SMTP_PASSWORD or RESEND_API_KEY set — magic link emails will fail. Set one to enable email sign-in.");
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma) as Adapter,
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

      // New user - check for valid invite
      const invite = await prisma.invite.findFirst({
        where: {
          email: user.email,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!invite) {
        // No valid invite - deny signup
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
            select: { id: true },
          });
          if (!exists) {
            // User was deleted (e.g. db:reset) — clear token to force re-login
            return { ...token, id: null, role: null };
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
