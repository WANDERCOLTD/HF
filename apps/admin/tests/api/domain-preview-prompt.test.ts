/**
 * Tests for Domain Preview Prompt API route:
 *   POST /api/domains/[domainId]/preview-prompt
 *
 * Business rules:
 *   - Composes a first-call prompt for a domain without persisting it
 *   - Uses an existing caller if available, creates a preview caller if not
 *   - Returns both promptSummary and voicePrompt renderings
 *   - Does NOT create a ComposedPrompt record
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  domain: {
    findUnique: vi.fn(),
  },
  caller: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  composedPrompt: {
    create: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'test-user', email: 'test@example.com', role: 'ADMIN' } },
  }),
  isAuthError: vi.fn((result: any) => 'error' in result),
}));

const mockComposition = {
  llmPrompt: { _version: "2.0", _quickStart: { you_are: "A test tutor" } },
  callerContext: "test context",
  sections: {},
  loadedData: {
    caller: { name: "Test" },
    memories: [{ id: "m1" }],
    recentCalls: [],
    playbooks: [{ name: "Test Playbook" }],
  },
  resolvedSpecs: {
    identitySpec: { name: "TUT-001" },
    contentSpec: null,
    voiceSpec: null,
  },
  metadata: {
    sectionsActivated: ["quickstart", "identity", "preamble"],
    sectionsSkipped: ["memories"],
    activationReasons: { quickstart: "always" },
    loadTimeMs: 12,
    transformTimeMs: 5,
    mergedTargetCount: 3,
  },
};

vi.mock('@/lib/prompt/composition', () => ({
  loadComposeConfig: vi.fn().mockResolvedValue({
    fullSpecConfig: { thresholds: { high: 0.65, low: 0.35 } },
    sections: [],
    specSlug: "COMP-001",
  }),
  executeComposition: vi.fn().mockResolvedValue(mockComposition),
}));

vi.mock('@/lib/prompt/composition/renderPromptSummary', () => ({
  renderPromptSummary: vi.fn().mockReturnValue("# SESSION PROMPT\n## Quick Start\nYou are a test tutor."),
  renderVoicePrompt: vi.fn().mockReturnValue("[IDENTITY]\nA test tutor helping learners."),
}));

// =====================================================
// HELPERS
// =====================================================

function createMockRequest(method: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3000'), { method });
}

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

// =====================================================
// TESTS
// =====================================================

describe('POST /api/domains/[domainId]/preview-prompt', () => {
  let POST: typeof import('@/app/api/domains/[domainId]/preview-prompt/route').POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/domains/[domainId]/preview-prompt/route');
    POST = mod.POST;
  });

  it('returns 404 when domain does not exist', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);

    const res = await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'missing-id' })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Domain not found');
  });

  it('uses existing caller when domain has callers', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'dom-1', name: 'Tutoring', slug: 'tutoring',
    });
    mockPrisma.caller.findFirst.mockResolvedValue({
      id: 'caller-1',
    });

    const res = await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'dom-1' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.callerId).toBe('caller-1');
    expect(body.createdPreviewCaller).toBe(false);
    expect(mockPrisma.caller.create).not.toHaveBeenCalled();
  });

  it('creates preview caller when domain has no callers', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'dom-1', name: 'Tutoring', slug: 'tutoring',
    });
    mockPrisma.caller.findFirst.mockResolvedValue(null);
    mockPrisma.caller.create.mockResolvedValue({
      id: 'preview-caller-1',
      name: '[Preview] Tutoring',
    });

    const res = await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'dom-1' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.callerId).toBe('preview-caller-1');
    expect(body.createdPreviewCaller).toBe(true);
    expect(mockPrisma.caller.create).toHaveBeenCalledWith({
      data: {
        name: '[Preview] Tutoring',
        domainId: 'dom-1',
      },
    });
  });

  it('does NOT persist a ComposedPrompt record', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'dom-1', name: 'Tutoring', slug: 'tutoring',
    });
    mockPrisma.caller.findFirst.mockResolvedValue({ id: 'caller-1' });

    await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'dom-1' })
    );

    expect(mockPrisma.composedPrompt.create).not.toHaveBeenCalled();
  });

  it('returns both promptSummary and voicePrompt', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'dom-1', name: 'Tutoring', slug: 'tutoring',
    });
    mockPrisma.caller.findFirst.mockResolvedValue({ id: 'caller-1' });

    const res = await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'dom-1' })
    );
    const body = await res.json();

    expect(body.promptSummary).toContain('SESSION PROMPT');
    expect(body.voicePrompt).toContain('[IDENTITY]');
    expect(body.llmPrompt).toBeDefined();
    expect(body.llmPrompt._quickStart.you_are).toBe('A test tutor');
  });

  it('returns composition metadata', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'dom-1', name: 'Tutoring', slug: 'tutoring',
    });
    mockPrisma.caller.findFirst.mockResolvedValue({ id: 'caller-1' });

    const res = await POST(
      createMockRequest('POST'),
      makeParams({ domainId: 'dom-1' })
    );
    const body = await res.json();

    expect(body.metadata.sectionsActivated).toEqual(['quickstart', 'identity', 'preamble']);
    expect(body.metadata.sectionsSkipped).toEqual(['memories']);
    expect(body.metadata.loadTimeMs).toBe(12);
    expect(body.metadata.transformTimeMs).toBe(5);
    expect(body.metadata.identitySpec).toBe('TUT-001');
    expect(body.metadata.playbooksUsed).toEqual(['Test Playbook']);
    expect(body.metadata.memoriesCount).toBe(1);
    expect(body.metadata.behaviorTargetsCount).toBe(3);
  });
});
