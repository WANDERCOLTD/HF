import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock auth
vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: any) => 'error' in r),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => {
  const _p = {
  prisma: {
    institutionType: {
      findMany: vi.fn(),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/admin/terminology/route';

const mockAdminAuth = {
  session: { user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' } },
};

describe('GET /api/admin/terminology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockAdminAuth as any);
    vi.mocked(isAuthError).mockReturnValue(false);
  });

  it('should reject non-admin users', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      error: new Response('Forbidden', { status: 403 }),
    } as any);
    vi.mocked(isAuthError).mockReturnValue(true);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('should return technical terms and institution types', async () => {
    vi.mocked(prisma.institutionType.findMany).mockResolvedValue([
      {
        id: 'type-1',
        slug: 'school',
        name: 'School',
        terminology: {
          domain: 'School',
          playbook: 'Lesson Plan',
          spec: 'Content',
          caller: 'Student',
          cohort: 'Class',
          instructor: 'Teacher',
          session: 'Lesson',
        },
        _count: { institutions: 3 },
      },
      {
        id: 'type-2',
        slug: 'corporate',
        name: 'Corporate',
        terminology: {
          domain: 'Organization',
          playbook: 'Training Plan',
          spec: 'Content',
          caller: 'Employee',
          cohort: 'Team',
          instructor: 'Trainer',
          session: 'Training Session',
        },
        _count: { institutions: 1 },
      },
    ] as any);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    // Technical terms baseline
    expect(data.technicalTerms).toEqual({
      domain: 'Institution',
      playbook: 'Subject',
      spec: 'Spec',
      caller: 'Caller',
      cohort: 'Cohort',
      instructor: 'Instructor',
      session: 'Lesson',
      session_short: 'Lesson',
      persona: 'Persona',
      supervisor: 'Supervisor',
      mentor: 'Supervisor',
      teach_action: 'Teach',
      learning_noun: 'Learning',
      group: 'Group',
    });

    // Institution types
    expect(data.types).toHaveLength(2);
    expect(data.types[0]).toEqual({
      id: 'type-1',
      slug: 'school',
      name: 'School',
      terminology: expect.objectContaining({ domain: 'School', caller: 'Student' }),
      institutionCount: 3,
    });
    expect(data.types[1]).toEqual({
      id: 'type-2',
      slug: 'corporate',
      name: 'Corporate',
      terminology: expect.objectContaining({ domain: 'Organization', caller: 'Employee' }),
      institutionCount: 1,
    });
  });

  it('should return empty types array when none exist', async () => {
    vi.mocked(prisma.institutionType.findMany).mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.types).toEqual([]);
    expect(data.technicalTerms).toBeDefined();
  });

  it('should only return active institution types', async () => {
    await GET();

    expect(prisma.institutionType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      }),
    );
  });

  it('should require ADMIN role', async () => {
    await GET();

    expect(requireAuth).toHaveBeenCalledWith('ADMIN');
  });
});
