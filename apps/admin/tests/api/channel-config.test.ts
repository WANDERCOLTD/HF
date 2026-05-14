import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  channelConfig: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@test.com", role: "ADMIN" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

describe("/api/settings/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.resetModules() omitted
  });

  describe("GET", () => {
    it("returns all channel configs", async () => {
      mockPrisma.channelConfig.findMany.mockResolvedValue([
        {
          id: "cc-1",
          channelType: "sim",
          domainId: null,
          isEnabled: true,
          config: {},
          priority: 0,
          domain: null,
        },
      ]);

      const { GET } = await import("@/app/api/settings/channels/route");
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.channels).toHaveLength(1);
      expect(data.channels[0].channelType).toBe("sim");
    });
  });

  describe("POST", () => {
    it("upserts a channel config", async () => {
      mockPrisma.channelConfig.upsert.mockResolvedValue({
        id: "cc-2",
        channelType: "whatsapp",
        domainId: "domain-1",
        isEnabled: true,
        config: { apiKey: "xxx" },
        priority: 1,
      });

      const { POST } = await import("@/app/api/settings/channels/route");
      const request = new NextRequest("http://localhost/api/settings/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelType: "whatsapp",
          domainId: "domain-1",
          isEnabled: true,
          config: { apiKey: "xxx" },
          priority: 1,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.channel.channelType).toBe("whatsapp");
    });

    it("returns 400 when channelType missing", async () => {
      const { POST } = await import("@/app/api/settings/channels/route");
      const request = new NextRequest("http://localhost/api/settings/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: true }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
    });
  });

  describe("DELETE", () => {
    it("deletes a channel config by id", async () => {
      const { DELETE } = await import("@/app/api/settings/channels/route");
      const request = new NextRequest("http://localhost/api/settings/channels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "cc-1" }),
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockPrisma.channelConfig.delete).toHaveBeenCalledWith({
        where: { id: "cc-1" },
      });
    });

    it("returns 400 when id missing", async () => {
      const { DELETE } = await import("@/app/api/settings/channels/route");
      const request = new NextRequest("http://localhost/api/settings/channels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
    });
  });
});
