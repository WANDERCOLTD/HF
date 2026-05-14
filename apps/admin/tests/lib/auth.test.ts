/**
 * Tests for lib/auth.ts — NextAuth Configuration
 *
 * Tests the NextAuth callbacks and credential authorization logic
 * that are configured in the auth module. Since the module passes
 * these as config to NextAuth(), we capture them via a mock and
 * test their behavior directly.
 *
 * Covers:
 *   - CredentialsProvider authorize() function
 *   - signIn callback (credentials, existing users, invite-based signup)
 *   - jwt callback (token enrichment)
 *   - session callback (session enrichment from token)
 *   - createUser event (invite consumption)
 *   - Module exports (handlers, signIn, signOut, auth)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// =====================================================
// MOCK SETUP
// =====================================================

// Capture the NextAuth config so we can test callbacks/authorize directly
let capturedConfig: any = null;

const mockNextAuth = vi.fn((config: any) => {
  capturedConfig = config;
  return {
    handlers: { GET: vi.fn(), POST: vi.fn() },
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  default: (config: any) => mockNextAuth(config),
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));

vi.mock("next-auth/providers/email", () => ({
  default: vi.fn(() => ({ id: "email", name: "Email" })),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: any) => ({
    id: "credentials",
    name: "Password",
    ...config,
  })),
}));

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

// Mock prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  invite: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Unmock @/lib/auth so we can test the real module (overrides global setup.ts mock)
vi.unmock("@/lib/auth");

// =====================================================
// HELPERS
// =====================================================

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    role: "OPERATOR",
    isActive: true,
    passwordHash: null,
    assignedDomainId: null,
    ...overrides,
  };
}

function makeInvite(overrides: Record<string, any> = {}) {
  return {
    id: "invite-1",
    email: "new@example.com",
    role: "TESTER",
    usedAt: null,
    expiresAt: new Date(Date.now() + 86400000), // tomorrow
    ...overrides,
  };
}

// =====================================================
// IMPORT MODULE (triggers NextAuth call, captures config)
// =====================================================

beforeAll(async () => {
  await import("@/lib/auth");
});

// =====================================================
// TESTS
// =====================================================

describe("lib/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------
  // Module exports
  // -------------------------------------------------

  describe("module exports", () => {
    it("provides a config object to NextAuth", () => {
      expect(capturedConfig).toBeDefined();
      expect(capturedConfig.callbacks).toBeDefined();
      expect(capturedConfig.providers).toBeDefined();
      expect(capturedConfig.events).toBeDefined();
    });

    it("exports handlers, signIn, signOut, auth", async () => {
      const mod = await import("@/lib/auth");
      expect(mod.handlers).toBeDefined();
      expect(mod.signIn).toBeDefined();
      expect(mod.signOut).toBeDefined();
      expect(mod.auth).toBeDefined();
    });
  });

  // -------------------------------------------------
  // NextAuth config structure
  // -------------------------------------------------

  describe("NextAuth configuration", () => {
    it("uses JWT session strategy", () => {
      expect(capturedConfig.session.strategy).toBe("jwt");
    });

    it("configures custom sign-in page", () => {
      expect(capturedConfig.pages.signIn).toBe("/login");
    });

    it("configures custom verify-request page", () => {
      expect(capturedConfig.pages.verifyRequest).toBe("/login/verify");
    });

    it("configures custom error page", () => {
      expect(capturedConfig.pages.error).toBe("/login/error");
    });

    it("has two providers configured", () => {
      expect(capturedConfig.providers).toHaveLength(2);
    });
  });

  // -------------------------------------------------
  // Credentials authorize()
  // -------------------------------------------------

  describe("credentials authorize()", () => {
    let authorize: (credentials: any) => Promise<any>;

    beforeAll(() => {
      // The credentials provider is the first provider in the config
      const credProvider = capturedConfig.providers[0];
      authorize = credProvider.authorize;
    });

    it("returns null when email is missing", async () => {
      const result = await authorize({ password: "secret" });
      expect(result).toBeNull();
    });

    it("returns null when password is missing", async () => {
      const result = await authorize({ email: "test@example.com" });
      expect(result).toBeNull();
    });

    it("returns null when both email and password are missing", async () => {
      const result = await authorize({});
      expect(result).toBeNull();
    });

    it("returns null when credentials is empty", async () => {
      const result = await authorize({});
      expect(result).toBeNull();
    });

    it("returns null when user is not found in DB", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await authorize({
        email: "nobody@example.com",
        password: "secret",
      });

      expect(result).toBeNull();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "nobody@example.com" },
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
    });

    it("returns null when user is inactive", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({ isActive: false })
      );

      const result = await authorize({
        email: "test@example.com",
        password: "secret",
      });

      expect(result).toBeNull();
    });

    it("returns user when passwordHash matches via bcrypt", async () => {
      const user = makeUser({ passwordHash: "$2a$10$hashedvalue" });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const result = await authorize({
        email: "test@example.com",
        password: "correctpassword",
      });

      expect(bcrypt.compare).toHaveBeenCalledWith(
        "correctpassword",
        "$2a$10$hashedvalue"
      );
      expect(result).toEqual({
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        role: "OPERATOR",
        assignedDomainId: null,
      });
    });

    it("returns null when bcrypt comparison fails", async () => {
      const user = makeUser({ passwordHash: "$2a$10$hashedvalue" });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await authorize({
        email: "test@example.com",
        password: "wrongpassword",
      });

      expect(result).toBeNull();
    });

    it("rejects any password for users without passwordHash", async () => {
      const user = makeUser({ passwordHash: null });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await authorize({
        email: "test@example.com",
        password: "admin123",
      });

      expect(result).toBeNull();
    });

    it("rejects all passwords for users without passwordHash", async () => {
      const user = makeUser({ passwordHash: null });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await authorize({
        email: "test@example.com",
        password: "anypassword",
      });

      expect(result).toBeNull();
    });

    it("includes assignedDomainId in returned user object", async () => {
      const user = makeUser({
        passwordHash: "$2a$10$hashedvalue",
        assignedDomainId: "domain-42",
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const result = await authorize({
        email: "test@example.com",
        password: "correctpassword",
      });

      expect(result).toEqual(
        expect.objectContaining({ assignedDomainId: "domain-42" })
      );
    });
  });

  // -------------------------------------------------
  // signIn callback
  // -------------------------------------------------

  describe("signIn callback", () => {
    let signInCallback: (params: any) => Promise<boolean>;

    beforeAll(() => {
      signInCallback = capturedConfig.callbacks.signIn;
    });

    it("allows credentials provider sign-in unconditionally", async () => {
      const result = await signInCallback({
        user: makeUser(),
        account: { provider: "credentials" },
      });

      expect(result).toBe(true);
    });

    it("rejects sign-in when user has no email (non-credentials)", async () => {
      const result = await signInCallback({
        user: { id: "user-1", email: null },
        account: { provider: "email" },
      });

      expect(result).toBe(false);
    });

    it("allows active existing user to sign in", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({ isActive: true })
      );

      const result = await signInCallback({
        user: { email: "test@example.com" },
        account: { provider: "email" },
      });

      expect(result).toBe(true);
    });

    it("rejects inactive existing user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({ isActive: false })
      );

      const result = await signInCallback({
        user: { email: "test@example.com" },
        account: { provider: "email" },
      });

      expect(result).toBe(false);
    });

    it("allows new user with valid invite", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.invite.findFirst.mockResolvedValue(makeInvite());

      const result = await signInCallback({
        user: { email: "new@example.com" },
        account: { provider: "email" },
      });

      expect(result).toBe(true);
      expect(mockPrisma.invite.findFirst).toHaveBeenCalledWith({
        where: {
          email: "new@example.com",
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it("rejects new user without invite", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.invite.findFirst.mockResolvedValue(null);

      const result = await signInCallback({
        user: { email: "stranger@example.com" },
        account: { provider: "email" },
      });

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------
  // jwt callback
  // -------------------------------------------------

  describe("jwt callback", () => {
    let jwtCallback: (params: any) => Promise<any>;

    beforeAll(() => {
      jwtCallback = capturedConfig.callbacks.jwt;
    });

    it("adds user fields to token on initial sign-in", async () => {
      const token = { sub: "user-1" };
      const user = {
        id: "user-1",
        role: "ADMIN",
        assignedDomainId: "domain-5",
      };

      const result = await jwtCallback({ token, user });

      expect(result.id).toBe("user-1");
      expect(result.role).toBe("ADMIN");
      expect(result.assignedDomainId).toBe("domain-5");
    });

    it("sets assignedDomainId to null when user has undefined value", async () => {
      const token = { sub: "user-1" };
      const user = {
        id: "user-1",
        role: "TESTER",
        assignedDomainId: undefined,
      };

      const result = await jwtCallback({ token, user });

      expect(result.assignedDomainId).toBeNull();
    });

    it("returns token unchanged on subsequent requests (no user)", async () => {
      const token = {
        sub: "user-1",
        id: "user-1",
        role: "OPERATOR",
        assignedDomainId: null,
      };

      const result = await jwtCallback({ token, user: undefined });

      expect(result).toEqual(token);
    });
  });

  // -------------------------------------------------
  // session callback
  // -------------------------------------------------

  describe("session callback", () => {
    let sessionCallback: (params: any) => Promise<any>;

    beforeAll(() => {
      sessionCallback = capturedConfig.callbacks.session;
    });

    it("enriches session with token data", async () => {
      const session = {
        user: {
          id: "",
          email: "test@example.com",
          name: "Test",
          image: null,
          role: "",
          assignedDomainId: null,
        },
      };
      const token = {
        id: "user-1",
        role: "ADMIN",
        assignedDomainId: "domain-5",
      };

      const result = await sessionCallback({ session, token });

      expect(result.user.id).toBe("user-1");
      expect(result.user.role).toBe("ADMIN");
      expect(result.user.assignedDomainId).toBe("domain-5");
    });

    it("sets assignedDomainId to null when token has no domain", async () => {
      const session = {
        user: {
          id: "",
          email: "test@example.com",
          name: "Test",
          image: null,
          role: "",
          assignedDomainId: null,
        },
      };
      const token = {
        id: "user-1",
        role: "TESTER",
        assignedDomainId: undefined,
      };

      const result = await sessionCallback({ session, token });

      expect(result.user.assignedDomainId).toBeNull();
    });

    it("returns session unchanged when token is falsy", async () => {
      const session = {
        user: {
          id: "original-id",
          email: "test@example.com",
          name: "Test",
          role: "VIEWER",
          assignedDomainId: null,
        },
      };

      const result = await sessionCallback({ session, token: null });

      expect(result.user.id).toBe("original-id");
    });
  });

  // -------------------------------------------------
  // createUser event
  // -------------------------------------------------

  describe("createUser event", () => {
    let createUserEvent: (params: any) => Promise<void>;

    beforeAll(() => {
      createUserEvent = capturedConfig.events.createUser;
    });

    it("does nothing when user has no email", async () => {
      await createUserEvent({ user: { id: "user-1", email: null } });

      expect(mockPrisma.invite.findFirst).not.toHaveBeenCalled();
    });

    it("finds and consumes invite when user has email", async () => {
      const invite = makeInvite({ email: "new@example.com", role: "TESTER" });
      mockPrisma.invite.findFirst.mockResolvedValue(invite);
      mockPrisma.$transaction.mockResolvedValue(undefined);

      await createUserEvent({
        user: { id: "user-1", email: "new@example.com" },
      });

      expect(mockPrisma.invite.findFirst).toHaveBeenCalledWith({
        where: {
          email: "new@example.com",
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });

      // Transaction should mark invite used + update user role
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(2);
    });

    it("skips transaction when no valid invite found", async () => {
      mockPrisma.invite.findFirst.mockResolvedValue(null);

      await createUserEvent({
        user: { id: "user-1", email: "no-invite@example.com" },
      });

      expect(mockPrisma.invite.findFirst).toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
