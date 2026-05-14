/**
 * Tests for Onboarding API Routes
 *
 * Covers:
 * - GET /api/onboarding - returns 404 when spec not in DB
 * - GET /api/onboarding - returns persona data from DB
 * - GET /api/onboarding/personas - returns fallback personas when spec not in DB
 * - GET /api/onboarding/personas - lists personas from DB
 * - Uses config.specs.onboarding (not hardcoded slug)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock prisma
const mockPrisma = {
  analysisSpec: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  promptSlug: {
    upsert: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Mock auth - default to passing
vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'test-user', role: 'ADMIN' } },
  }),
  isAuthError: vi.fn((result) => 'error' in result),
}));

// Mock config
vi.mock('@/lib/config', () => ({
  config: {
    specs: {
      onboarding: 'INIT-001',
      onboardingSlugPrefix: 'init.',
    },
  },
}));

// Mock registry (used in onboarding/route.ts)
vi.mock('@/lib/registry', () => ({
  PARAMS: {},
}));

// Mock fallback-settings (used in onboarding/personas/route.ts)
vi.mock('@/lib/fallback-settings', () => ({
  getOnboardingPersonasFallback: vi.fn().mockResolvedValue([
    { slug: 'tutor', name: 'Tutor', description: 'Patient teaching expert' },
  ]),
}));

// Test helpers
function createMockGetRequest(url: string = 'http://localhost:3000/api/onboarding'): NextRequest {
  return new NextRequest(url);
}


// Sample spec data
const MOCK_ONBOARDING_SPEC = {
  id: 'spec-123',
  slug: 'init-001-caller-onboarding',
  name: 'Caller Onboarding',
  description: 'Onboarding spec',
  updatedAt: new Date('2026-01-01'),
  config: {
    personas: {
      defaultPersona: 'tutor',
      tutor: {
        name: 'Tutor',
        description: 'A helpful tutor',
        icon: '📚',
        defaultTargets: { knowledge: 0.7 },
        firstCallFlow: {
          phases: [{ phase: 'intro', instructionSlug: 'init.phase.intro.tutor' }],
          successMetrics: ['completed_intro'],
        },
        welcomeSlug: 'init.welcome.tutor',
        welcomeTemplate: 'Hello, I am your tutor!',
      },
      coach: {
        name: 'Coach',
        description: 'A motivating coach',
        icon: '🏋️',
        defaultTargets: { motivation: 0.8 },
        firstCallFlow: { phases: [], successMetrics: [] },
        welcomeSlug: 'init.welcome.coach',
      },
    },
    parameters: [
      { id: 'default_targets_quality', config: { defaultTargets: { overall: 0.5 } } },
    ],
  },
};

describe('GET /api/onboarding', () => {
  let GET: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/app/api/onboarding/route');
    GET = mod.GET;
  });

  it('returns 404 when onboarding spec not found in DB', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const req = createMockGetRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('INIT-001');
    expect(body.error).toContain('spec-sync');
  });

  it('returns persona data from DB', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(MOCK_ONBOARDING_SPEC);

    const req = createMockGetRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe('database');
    expect(body.selectedPersona).toBe('tutor');
    expect(body.availablePersonas).toContain('tutor');
    expect(body.availablePersonas).toContain('coach');
  });

  it('selects requested persona via query param', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(MOCK_ONBOARDING_SPEC);

    const req = createMockGetRequest('http://localhost:3000/api/onboarding?persona=coach');
    const res = await GET(req);
    const body = await res.json();

    expect(body.selectedPersona).toBe('coach');
    expect(body.personaName).toBe('Coach');
  });

  it('falls back to default persona for unknown slug', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(MOCK_ONBOARDING_SPEC);

    const req = createMockGetRequest('http://localhost:3000/api/onboarding?persona=nonexistent');
    const res = await GET(req);
    const body = await res.json();

    expect(body.selectedPersona).toBe('tutor');
  });

  it('uses config.specs.onboarding for slug lookup (not hardcoded)', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(MOCK_ONBOARDING_SPEC);

    const req = createMockGetRequest();
    await GET(req);

    // Verify the query used the config value (lowercased)
    const findFirstCall = mockPrisma.analysisSpec.findFirst.mock.calls[0][0];
    const slugContains = findFirstCall.where.OR[0].slug.contains;
    expect(slugContains).toBe('init-001');
  });
});

describe('GET /api/onboarding/personas', () => {
  let GET: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/app/api/onboarding/personas/route');
    GET = mod.GET;
  });

  it('returns fallback personas when spec not in DB', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe('fallback');
    expect(body.personas).toHaveLength(1);
    expect(body.personas[0].slug).toBe('tutor');
    expect(body.defaultPersona).toBe('tutor');
  });

  it('lists all personas from DB spec', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      id: 'spec-123',
      slug: 'init-001-caller-onboarding',
      config: MOCK_ONBOARDING_SPEC.config,
      updatedAt: new Date(),
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe('database');
    expect(body.defaultPersona).toBe('tutor');
    expect(body.personas).toHaveLength(2);
    expect(body.personas[0].slug).toBe('tutor');
    expect(body.personas[1].slug).toBe('coach');
  });

  it('uses config.specs.onboarding for slug lookup', async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    await GET();

    const findFirstCall = mockPrisma.analysisSpec.findFirst.mock.calls[0][0];
    expect(findFirstCall.where.OR[0].slug.contains).toBe('init-001');
  });
});

