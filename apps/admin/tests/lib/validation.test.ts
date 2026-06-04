import { describe, it, expect } from "vitest";
import { validateBody, inviteAcceptSchema, joinPostSchema, authLoginSchema } from "@/lib/validation";

describe("lib/validation", () => {
  describe("validateBody", () => {
    it("returns ok:true with parsed data for valid input", () => {
      const result = validateBody(inviteAcceptSchema, {
        token: "abc-123",
        firstName: "Jane",
        lastName: "Doe",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.firstName).toBe("Jane");
        expect(result.data.lastName).toBe("Doe");
      }
    });

    it("trims whitespace from name fields", () => {
      const result = validateBody(inviteAcceptSchema, {
        token: "abc",
        firstName: "  Jane  ",
        lastName: "  Doe  ",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.firstName).toBe("Jane");
        expect(result.data.lastName).toBe("Doe");
      }
    });

    it("returns ok:false with 400 error for missing fields", async () => {
      const result = validateBody(inviteAcceptSchema, {
        token: "abc",
        // missing firstName and lastName
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
        const body = await result.error.json();
        expect(body.ok).toBe(false);
        expect(body.error).toBe("Invalid request");
        expect(body.details).toBeInstanceOf(Array);
      }
    });

    it("rejects empty strings", () => {
      const result = validateBody(inviteAcceptSchema, {
        token: "",
        firstName: "",
        lastName: "",
      });
      expect(result.ok).toBe(false);
    });

    it("rejects strings exceeding max length", () => {
      const result = validateBody(inviteAcceptSchema, {
        token: "a".repeat(300),
        firstName: "a".repeat(200),
        lastName: "Doe",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("joinPostSchema", () => {
    it("validates email format", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Jane",
        lastName: "Doe",
        email: "not-an-email",
      });
      expect(result.ok).toBe(false);
    });

    it("accepts valid email and lowercases it", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Jane",
        lastName: "Doe",
        email: "Jane@Example.COM",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.email).toBe("jane@example.com");
      }
    });

    // #1036 — ageRange propagation
    it("accepts a valid GDPR age band", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Tessa",
        lastName: "Bloom",
        email: "tessa@example.com",
        ageRange: "25-34",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.ageRange).toBe("25-34");
    });

    it("treats ageRange as optional", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Tessa",
        lastName: "Bloom",
        email: "tessa@example.com",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.ageRange).toBeUndefined();
    });

    it("rejects an invalid age-band string", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Tessa",
        lastName: "Bloom",
        email: "tessa@example.com",
        ageRange: "twenty-something",
      });
      expect(result.ok).toBe(false);
    });

    it("accepts under-18 at schema level (route handler enforces the adult-only policy)", () => {
      const result = validateBody(joinPostSchema, {
        firstName: "Tessa",
        lastName: "Bloom",
        email: "tessa@example.com",
        ageRange: "under-18",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.ageRange).toBe("under-18");
    });
  });

  describe("authLoginSchema", () => {
    it("requires token field", () => {
      const result = validateBody(authLoginSchema, {});
      expect(result.ok).toBe(false);
    });

    it("accepts valid token", () => {
      const result = validateBody(authLoginSchema, { token: "my-secret-token" });
      expect(result.ok).toBe(true);
    });
  });
});
