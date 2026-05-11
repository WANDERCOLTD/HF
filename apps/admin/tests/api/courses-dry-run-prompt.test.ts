/**
 * Tests for Course Dry-Run Prompt API route:
 *   POST /api/courses/[courseId]/dry-run-prompt
 *
 * Business rules:
 *   - Composes a first-call prompt for a course without persisting it
 *   - Picks an existing enrolled learner if available, falls back to any
 *     caller in the domain. Never creates a new caller.
 *   - Returns the rendered prompt, llmPrompt JSON, and the compose trace
 *   - Does NOT create a Call OR ComposedPrompt record
 *   - Requires OPERATOR auth (matches other admin write/preview endpoints)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  caller: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  callerPlaybook: { findFirst: vi.fn() },
  composedPrompt: { create: vi.fn() },
  call: { create: vi.fn() },
  mediaAsset: { findMany: vi.fn().mockResolvedValue([]) },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx: unknown) => tx ?? mockPrisma,
}));

vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'test-user', role: 'OPERATOR' } },
  }),
  isAuthError: vi.fn((result: any) => 'error' in result),
}));

const mockComposition = {
  llmPrompt: {
    _version: '2.0',
    _quickStart: { you_are: 'A maths tutor' },
    identity: { role: 'Maths tutor' },
  },
  callerContext: 'context',
  sections: {},
  loadedData: {
    caller: { id: 'caller-1', domain: { slug: 'tutoring' } },
    memories: [],
    recentCalls: [],
    playbooks: [{ name: 'GCSE Maths' }],
    visualAids: [],
  },
  resolvedSpecs: { identitySpec: { name: 'TUT-001' }, voiceSpec: null },
  metadata: {
    sectionsActivated: ['quickstart', 'identity'],
    sectionsSkipped: ['memories'],
    activationReasons: { quickstart: 'Always', memories: 'SKIPPED: no rows' },
    loadTimeMs: 14,
    transformTimeMs: 6,
    mergedTargetCount: 0,
    composeTrace: {
      loadersFired: { playbooks: 1 },
      loadersEmpty: { memories: 'no rows' },
      assertionsExcluded: { count: 0, firstReasons: [] },
      onboardingFlowSource: 'Playbook GCSE Maths',
      onboardingOverriddenByPlaybook: false,
      mediaPalette: [],
      sectionsActivatedCount: 2,
      sectionsSkippedCount: 1,
    },
  },
};

vi.mock('@/lib/prompt/composition', () => ({
  loadComposeConfig: vi.fn().mockResolvedValue({
    fullSpecConfig: { thresholds: { high: 0.65, low: 0.35 } },
    sections: [],
    specSlug: 'COMP-001',
  }),
  executeComposition: vi.fn().mockResolvedValue(mockComposition),
}));

vi.mock('@/lib/prompt/composition/renderPromptSummary', () => ({
  renderPromptSummary: vi.fn().mockReturnValue('# SESSION PROMPT\nYou are a maths tutor.'),
}));

// =====================================================
// HELPERS
// =====================================================

function createRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/courses/course-1/dry-run-prompt'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeParams(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}

// =====================================================
// TESTS
// =====================================================

describe('POST /api/courses/[courseId]/dry-run-prompt', () => {
  let POST: typeof import('@/app/api/courses/[courseId]/dry-run-prompt/route').POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/courses/[courseId]/dry-run-prompt/route');
    POST = mod.POST;
  });

  it('returns 404 when course does not exist', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const res = await POST(createRequest(), makeParams('missing'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Course not found');
  });

  it('returns 400 when course has no domainId', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'Test', domainId: null,
    });

    const res = await POST(createRequest(), makeParams('course-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no domain/i);
  });

  it('returns 400 when no caller exists in the domain', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.caller.findFirst.mockResolvedValue(null);

    const res = await POST(createRequest(), makeParams('course-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no caller/i);
  });

  it('uses enrolled learner when one exists', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: 'enrolled-1' });

    const res = await POST(createRequest({ callSequence: 1 }), makeParams('course-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.callerId).toBe('enrolled-1');
    expect(body.dryRun).toBe(true);
  });

  it('falls back to any caller in the domain when no enrollments', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    mockPrisma.caller.findFirst.mockResolvedValue({ id: 'any-1' });

    const res = await POST(createRequest(), makeParams('course-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.callerId).toBe('any-1');
  });

  it('does NOT create a Call OR ComposedPrompt record', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: 'enrolled-1' });

    await POST(createRequest(), makeParams('course-1'));

    expect(mockPrisma.composedPrompt.create).not.toHaveBeenCalled();
    expect(mockPrisma.call.create).not.toHaveBeenCalled();
    expect(mockPrisma.caller.create).not.toHaveBeenCalled();
  });

  it('returns the rendered prompt, llmPrompt, and trace', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: 'enrolled-1' });

    const res = await POST(createRequest({ callSequence: 1 }), makeParams('course-1'));
    const body = await res.json();

    expect(body.promptSummary).toContain('SESSION PROMPT');
    expect(body.llmPrompt._quickStart.you_are).toBe('A maths tutor');
    expect(body.trace).toBeTruthy();
    expect(body.trace.onboardingFlowSource).toBe('Playbook GCSE Maths');
    expect(body.metadata.identitySpec).toBe('TUT-001');
    expect(body.metadata.sectionsActivated).toEqual(['quickstart', 'identity']);
  });

  it('honours explicit simCallerId and verifies it exists', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.caller.findUnique.mockResolvedValue({ id: 'explicit-1', domainId: 'dom-1' });

    const res = await POST(
      createRequest({ simCallerId: 'explicit-1' }),
      makeParams('course-1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.callerId).toBe('explicit-1');
    expect(mockPrisma.callerPlaybook.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when explicit simCallerId does not exist', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'course-1', name: 'GCSE Maths', domainId: 'dom-1',
    });
    mockPrisma.caller.findUnique.mockResolvedValue(null);

    const res = await POST(
      createRequest({ simCallerId: 'ghost' }),
      makeParams('course-1'),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Caller not found');
  });
});
