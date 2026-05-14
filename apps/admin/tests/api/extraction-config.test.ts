/**
 * Tests for GET/PUT /api/domains/:domainId/extraction-config
 *
 * Verifies:
 * - Auth enforcement
 * - GET returns merged config with override status
 * - PUT saves domain override
 * - PUT with null resets to defaults
 * - 404 for non-existent domain
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  resolveExtractionConfigForDomain: vi.fn(),
  domainFindUnique: vi.fn(),
  playbookFindFirst: vi.fn(),
  analysisSpecCreate: vi.fn(),
  analysisSpecUpdate: vi.fn(),
  analysisSpecDelete: vi.fn(),
  playbookItemDeleteMany: vi.fn(),
  playbookItemCreate: vi.fn(),
  playbookItemAggregate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/content-trust/resolve-config", () => ({
  resolveExtractionConfigForDomain: mocks.resolveExtractionConfigForDomain,
  ExtractionConfig: {},
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    domain: { findUnique: mocks.domainFindUnique },
    playbook: { findFirst: mocks.playbookFindFirst },
    analysisSpec: {
      create: mocks.analysisSpecCreate,
      update: mocks.analysisSpecUpdate,
      delete: mocks.analysisSpecDelete,
    },
    playbookItem: {
      deleteMany: mocks.playbookItemDeleteMany,
      create: mocks.playbookItemCreate,
      aggregate: mocks.playbookItemAggregate,
    },
    $transaction: (fn: any) => fn({
      analysisSpec: {
        create: mocks.analysisSpecCreate,
        delete: mocks.analysisSpecDelete,
      },
      playbookItem: {
        deleteMany: mocks.playbookItemDeleteMany,
        create: mocks.playbookItemCreate,
        aggregate: mocks.playbookItemAggregate,
      },
    }),
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

import { GET, PUT } from "@/app/api/domains/[domainId]/extraction-config/route";
import { NextRequest } from "next/server";

const makeGetRequest = () =>
  new NextRequest("http://localhost:3000/api/domains/dom-1/extraction-config");

const makePutRequest = (body: any) =>
  new NextRequest("http://localhost:3000/api/domains/dom-1/extraction-config", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const makeParams = () => Promise.resolve({ domainId: "dom-1" });

const MOCK_CONFIG = {
  extraction: {
    systemPrompt: "test",
    categories: [],
    llmConfig: { temperature: 0.1, maxTokens: 4000 },
    chunkSize: 8000,
    maxAssertionsPerDocument: 500,
    rules: { requirePrecision: [], noInvention: true, trackTaxYear: false, trackValidity: true },
  },
  structuring: {
    systemPrompt: "test",
    levels: [
      { depth: 0, label: "overview", maxChildren: 1, renderAs: "paragraph" },
      { depth: 1, label: "detail", maxChildren: 4, renderAs: "bullet" },
    ],
    targetChildCount: 3,
    llmConfig: { temperature: 0.2, maxTokens: 8000 },
  },
  rendering: {
    defaultMaxDepth: 1,
    depthAdaptation: { entryLevel: -1, fastPace: -1, advancedPriorKnowledge: -1 },
  },
};

describe("GET /api/domains/:domainId/extraction-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent domain", async () => {
    mocks.domainFindUnique.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it("returns merged config with override status", async () => {
    mocks.domainFindUnique.mockResolvedValue({ id: "dom-1" });
    mocks.resolveExtractionConfigForDomain.mockResolvedValue(MOCK_CONFIG);
    // No override spec found (returns null playbook)
    mocks.playbookFindFirst.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params: makeParams() });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.config).toEqual(MOCK_CONFIG);
    expect(data.hasOverride).toBe(false);
  });

  it("reports hasOverride when domain spec exists", async () => {
    mocks.domainFindUnique.mockResolvedValue({ id: "dom-1" });
    mocks.resolveExtractionConfigForDomain.mockResolvedValue(MOCK_CONFIG);
    mocks.playbookFindFirst.mockResolvedValue({
      items: [{ spec: { id: "spec-1", config: {} } }],
    });

    const res = await GET(makeGetRequest(), { params: makeParams() });
    const data = await res.json();
    expect(data.hasOverride).toBe(true);
    expect(data.overrideSpecId).toBe("spec-1");
  });
});

describe("PUT /api/domains/:domainId/extraction-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
  });

  it("returns 404 for non-existent domain", async () => {
    mocks.domainFindUnique.mockResolvedValue(null);

    const res = await PUT(makePutRequest({ config: {} }), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it("resets override when config is null", async () => {
    mocks.domainFindUnique.mockResolvedValue({ id: "dom-1", name: "Test" });
    // Existing override exists
    mocks.playbookFindFirst.mockResolvedValueOnce({
      items: [{ spec: { id: "spec-1", config: {} } }],
    });
    mocks.playbookItemDeleteMany.mockResolvedValue({ count: 1 });
    mocks.analysisSpecDelete.mockResolvedValue({});
    // After reset, no override
    mocks.resolveExtractionConfigForDomain.mockResolvedValue(MOCK_CONFIG);
    mocks.playbookFindFirst.mockResolvedValueOnce(null);

    const res = await PUT(makePutRequest({ config: null }), { params: makeParams() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasOverride).toBe(false);
  });

  it("returns 400 when no published playbook for new override", async () => {
    mocks.domainFindUnique.mockResolvedValue({ id: "dom-1", name: "Test" });
    // No existing override
    mocks.playbookFindFirst
      .mockResolvedValueOnce(null) // findDomainOverrideSpec
      .mockResolvedValueOnce(null); // find published playbook

    const overrideConfig = { rendering: { defaultMaxDepth: 2 } };
    const res = await PUT(makePutRequest({ config: overrideConfig }), { params: makeParams() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("published playbook");
  });

  it("updates existing override", async () => {
    mocks.domainFindUnique.mockResolvedValue({ id: "dom-1", name: "Test" });
    // Existing override exists
    mocks.playbookFindFirst.mockResolvedValueOnce({
      items: [{ spec: { id: "spec-1", config: {} } }],
    });
    mocks.analysisSpecUpdate.mockResolvedValue({});
    // After save
    mocks.resolveExtractionConfigForDomain.mockResolvedValue(MOCK_CONFIG);
    mocks.playbookFindFirst.mockResolvedValueOnce({
      items: [{ spec: { id: "spec-1", config: {} } }],
    });

    const overrideConfig = { rendering: { defaultMaxDepth: 2 } };
    const res = await PUT(makePutRequest({ config: overrideConfig }), { params: makeParams() });
    expect(res.status).toBe(200);

    expect(mocks.analysisSpecUpdate).toHaveBeenCalledWith({
      where: { id: "spec-1" },
      data: { config: overrideConfig },
    });
  });
});
