/**
 * Tests for ComposedPrompt viewer + diff API routes:
 *   GET /api/composed-prompts/[promptId]
 *   GET /api/composed-prompts/[promptId]/diff
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = {
  composedPrompt: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'u', role: 'OPERATOR' } },
  }),
  isAuthError: vi.fn((r: any) => 'error' in r),
}));

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url));
}

describe('GET /api/composed-prompts/[promptId]', () => {
  let GET: typeof import('@/app/api/composed-prompts/[promptId]/route').GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/composed-prompts/[promptId]/route');
    GET = mod.GET;
  });

  it('returns 404 when prompt not found', async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValue(null);

    const res = await GET(
      makeRequest('http://localhost/api/composed-prompts/missing'),
      makeParams({ promptId: 'missing' }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Prompt not found');
  });

  it('returns the prompt + sibling list scoped to its playbook', async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValue({
      id: 'p1',
      callerId: 'c1',
      playbookId: 'pb1',
      playbook: { id: 'pb1', name: 'GCSE Maths' },
      prompt: '# prompt',
      llmPrompt: {},
      status: 'active',
      triggerType: 'manual',
      composedAt: new Date(),
      inputs: {},
      triggerCall: null,
    });
    mockPrisma.composedPrompt.findMany.mockResolvedValue([
      { id: 'p0', composedAt: new Date(), triggerType: 'manual', status: 'superseded', callerId: 'c1', model: 'det' },
    ]);

    const res = await GET(
      makeRequest('http://localhost/api/composed-prompts/p1'),
      makeParams({ promptId: 'p1' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.prompt.id).toBe('p1');
    expect(body.siblings).toHaveLength(1);
    expect(mockPrisma.composedPrompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ playbookId: 'pb1' }) }),
    );
  });
});

describe('GET /api/composed-prompts/[promptId]/diff', () => {
  let GET: typeof import('@/app/api/composed-prompts/[promptId]/diff/route').GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/composed-prompts/[promptId]/diff/route');
    GET = mod.GET;
  });

  it('returns 404 when right prompt missing', async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValueOnce(null);

    const res = await GET(
      makeRequest('http://localhost/api/composed-prompts/p1/diff?against=previous'),
      makeParams({ promptId: 'p1' }),
    );

    expect(res.status).toBe(404);
  });

  it('returns empty diff with message when no earlier prompt exists', async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValueOnce({
      id: 'p1', prompt: 'hello', composedAt: new Date(), playbookId: 'pb1', triggerType: 'manual',
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const res = await GET(
      makeRequest('http://localhost/api/composed-prompts/p1/diff?against=previous'),
      makeParams({ promptId: 'p1' }),
    );
    const body = await res.json();

    expect(body.left).toBeNull();
    expect(body.lines).toEqual([]);
    expect(body.message).toMatch(/no earlier prompt/i);
  });

  it('returns unified diff + lines when two prompts differ', async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValueOnce({
      id: 'p1', prompt: 'hello world\nline2', composedAt: new Date('2026-05-10'), playbookId: 'pb1', triggerType: 'manual',
    });
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce({
      id: 'p0', prompt: 'hello earth\nline2', composedAt: new Date('2026-05-09'), playbookId: 'pb1', triggerType: 'manual',
    });

    const res = await GET(
      makeRequest('http://localhost/api/composed-prompts/p1/diff?against=previous'),
      makeParams({ promptId: 'p1' }),
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.left.id).toBe('p0');
    expect(body.right.id).toBe('p1');
    expect(body.unifiedDiff).toContain('hello');
    expect(body.lines.some((l: any) => l.added)).toBe(true);
    expect(body.lines.some((l: any) => l.removed)).toBe(true);
  });
});
