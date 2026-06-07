/**
 * Voice-config route tests (#1271 Slices C + D promotion from manual).
 *
 * Covers /api/playbooks/[id]/voice-config + /api/domains/[id]/voice-config
 * — GET (resolved cascade + schema fields) and PATCH (per-field write
 * with LOCKED_KEYS / SECRET_KEYS / allowedKeys rejection).
 *
 * Tests target the route handlers directly with mocked Prisma + mocked
 * voice loaders so the cascade resolver itself isn't exercised here —
 * that's covered by config.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  domain: { findUnique: vi.fn(), update: vi.fn() },
  caller: { findFirst: vi.fn() },
  callerPlaybook: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const mockUpdatePlaybookConfig = vi.fn();
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: mockUpdatePlaybookConfig,
}));

const mockLoad = vi.fn();
vi.mock("@/lib/voice/load-voice-config", () => ({
  loadResolvedVoiceConfig: mockLoad,
}));

vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: vi.fn(async () => ({
    defaultProviderSlug: "vapi",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: true,
    endCallPhrases: ["goodbye"],
    maxCostPerCallUsd: null,
  })),
}));

vi.mock("@/lib/voice/provider-factory", () => ({
  getVoiceProvider: vi.fn(async () => ({
    slug: "vapi",
    getConfigSchema: () => ({
      fields: [
        { key: "apiKey", label: "Key", type: "string", sensitive: true },
        { key: "voiceId", label: "Voice ID", type: "string", sensitive: false },
        { key: "transcriber", label: "STT", type: "enum", sensitive: false, enumValues: ["deepgram"] },
      ],
    }),
  })),
}));

function buildRequest(url: string, opts: { method?: string; body?: unknown } = {}) {
  return new Request(url, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

async function loadPlaybookRoute() {
  return await import("../../app/api/playbooks/[playbookId]/voice-config/route");
}
async function loadDomainRoute() {
  return await import("../../app/api/domains/[domainId]/voice-config/route");
}

describe("/api/playbooks/:playbookId/voice-config (#1271 Slice C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValue({
      provider: { value: "vapi", source: "system" },
      model: { value: null, source: "system" },
      fields: {
        autoPipeline: { value: true, source: "system" },
        silenceTimeoutSeconds: { value: 30, source: "system" },
        voiceId: { value: "rachel", source: "provider" },
      },
    });
  });

  describe("GET", () => {
    it("returns the resolved cascade + allowed key set + this-layer overrides", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-1",
        name: "Sales 101",
        domainId: "dom-1",
        config: { voice: { autoPipeline: false } },
      });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: "c-1" });

      const { GET } = await loadPlaybookRoute();
      const res = await GET(
        buildRequest("http://x/api/playbooks/pb-1/voice-config"),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.playbookId).toBe("pb-1");
      expect(body.enabledProviderSlug).toBe("vapi");
      expect(body.resolved.fields.autoPipeline.value).toBe(true);
      expect(body.allowedKeys).toContain("voiceId");
      expect(body.allowedKeys).toContain("autoPipeline");
      expect(body.allowedKeys).not.toContain("apiKey"); // sensitive filtered
      expect(body.allowedKeys).not.toContain("provider"); // locked
      expect(body.courseOverrides).toEqual({ autoPipeline: false });
    });

    it("404 when playbook does not exist", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue(null);
      const { GET } = await loadPlaybookRoute();
      const res = await GET(
        buildRequest("http://x/api/playbooks/missing/voice-config"),
        { params: Promise.resolve({ playbookId: "missing" }) },
      );
      expect(res.status).toBe(404);
    });

    it("resolves with callerId null when the playbook has no callers yet", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-2",
        name: "Empty",
        domainId: "dom-1",
        config: {},
      });
      mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);

      const { GET } = await loadPlaybookRoute();
      const res = await GET(
        buildRequest("http://x/api/playbooks/pb-2/voice-config"),
        { params: Promise.resolve({ playbookId: "pb-2" }) },
      );
      expect(res.status).toBe(200);
      expect(mockLoad).toHaveBeenCalledWith({ callerId: null, playbookId: "pb-2" });
    });
  });

  describe("PATCH", () => {
    beforeEach(() => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-1",
        config: { voice: { autoPipeline: true } },
      });
    });

    it("accepts a cascadeable key and writes via updatePlaybookConfig", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "autoPipeline", value: false },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.applied).toBe("set");
      expect(mockUpdatePlaybookConfig).toHaveBeenCalledWith("pb-1", {
        voice: { autoPipeline: false },
      });
    });

    it("accepts a per-VP schema field (voiceId)", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "voiceId", value: "rachel-v2" },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(200);
      expect(mockUpdatePlaybookConfig).toHaveBeenCalled();
    });

    it("REJECTS LOCKED_KEYS (provider)", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "provider", value: "retell" },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(400);
      expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    });

    it("REJECTS LOCKED_KEYS (model)", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "model", value: "claude-x" },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(400);
      expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    });

    it("REJECTS SECRET_KEYS (apiKey)", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "apiKey", value: "sk-leak" },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(400);
      expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    });

    it("REJECTS unknown key not in cascadeableKeys", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "totallyMadeUpKey", value: "x" },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(400);
    });

    it("`value: null` clears the override (delete-key semantics)", async () => {
      mockPrisma.playbook.findUnique.mockResolvedValue({
        id: "pb-1",
        config: { voice: { autoPipeline: false, voiceId: "rachel" } },
      });
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "autoPipeline", value: null },
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.applied).toBe("cleared");
      // voice object should NOT contain autoPipeline (cleared), still has voiceId.
      expect(mockUpdatePlaybookConfig).toHaveBeenCalledWith("pb-1", {
        voice: { voiceId: "rachel" },
      });
    });

    it("400 when body is malformed", async () => {
      const { PATCH } = await loadPlaybookRoute();
      const res = await PATCH(
        buildRequest("http://x/api/playbooks/pb-1/voice-config", {
          method: "PATCH",
          body: { key: "" }, // empty
        }),
        { params: Promise.resolve({ playbookId: "pb-1" }) },
      );
      expect(res.status).toBe(400);
    });
  });
});

describe("/api/domains/:domainId/voice-config (#1271 Slice D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValue({
      provider: { value: "vapi", source: "system" },
      model: { value: null, source: "system" },
      fields: {
        autoPipeline: { value: true, source: "system" },
        voiceId: { value: "rachel", source: "provider" },
      },
    });
  });

  describe("GET", () => {
    it("returns resolved cascade + domain overrides", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "dom-1",
        name: "Tutor",
        slug: "tutor",
        config: { voice: { autoPipeline: false }, somethingElse: "x" },
      });
      mockPrisma.caller.findFirst.mockResolvedValue({ id: "c-1" });

      const { GET } = await loadDomainRoute();
      const res = await GET(
        buildRequest("http://x/api/domains/dom-1/voice-config"),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.domainOverrides).toEqual({ autoPipeline: false });
    });

    it("resolves with playbookId null (domain layer, not playbook)", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "dom-1",
        name: "Tutor",
        slug: "tutor",
        config: {},
      });
      mockPrisma.caller.findFirst.mockResolvedValue({ id: "c-1" });

      const { GET } = await loadDomainRoute();
      await GET(
        buildRequest("http://x/api/domains/dom-1/voice-config"),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      expect(mockLoad).toHaveBeenCalledWith({ callerId: "c-1", playbookId: null });
    });

    it("404 when domain does not exist", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue(null);
      const { GET } = await loadDomainRoute();
      const res = await GET(
        buildRequest("http://x/api/domains/missing/voice-config"),
        { params: Promise.resolve({ domainId: "missing" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH", () => {
    beforeEach(() => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "dom-1",
        config: { voice: {}, somethingElse: "preserved" },
      });
      mockPrisma.domain.update.mockResolvedValue({});
    });

    it("accepts a cascadeable key and writes to Domain.config.voice", async () => {
      const { PATCH } = await loadDomainRoute();
      const res = await PATCH(
        buildRequest("http://x/api/domains/dom-1/voice-config", {
          method: "PATCH",
          body: { key: "autoPipeline", value: false },
        }),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      expect(res.status).toBe(200);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith({
        where: { id: "dom-1" },
        data: { config: { somethingElse: "preserved", voice: { autoPipeline: false } } },
      });
    });

    it("REJECTS LOCKED_KEYS (provider)", async () => {
      const { PATCH } = await loadDomainRoute();
      const res = await PATCH(
        buildRequest("http://x/api/domains/dom-1/voice-config", {
          method: "PATCH",
          body: { key: "provider", value: "retell" },
        }),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      expect(res.status).toBe(400);
      expect(mockPrisma.domain.update).not.toHaveBeenCalled();
    });

    it("REJECTS SECRET_KEYS (apiKey)", async () => {
      const { PATCH } = await loadDomainRoute();
      const res = await PATCH(
        buildRequest("http://x/api/domains/dom-1/voice-config", {
          method: "PATCH",
          body: { key: "apiKey", value: "sk-leak" },
        }),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      expect(res.status).toBe(400);
      expect(mockPrisma.domain.update).not.toHaveBeenCalled();
    });

    it("`value: null` clears the domain override but preserves other config keys", async () => {
      mockPrisma.domain.findUnique.mockResolvedValue({
        id: "dom-1",
        config: { voice: { autoPipeline: false, voiceId: "rachel" }, communityKind: "K" },
      });
      const { PATCH } = await loadDomainRoute();
      const res = await PATCH(
        buildRequest("http://x/api/domains/dom-1/voice-config", {
          method: "PATCH",
          body: { key: "autoPipeline", value: null },
        }),
        { params: Promise.resolve({ domainId: "dom-1" }) },
      );
      expect(res.status).toBe(200);
      expect(mockPrisma.domain.update).toHaveBeenCalledWith({
        where: { id: "dom-1" },
        data: {
          config: {
            communityKind: "K",
            voice: { voiceId: "rachel" },
          },
        },
      });
    });
  });
});
