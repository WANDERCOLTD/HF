import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock auth
vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: any) => 'error' in r),
}));

// Mock terminology
vi.mock('@/lib/terminology', () => ({
  resolveTerminology: vi.fn(),
}));

import { requireAuth, isAuthError } from '@/lib/permissions';
import { resolveTerminology } from '@/lib/terminology';
import { GET } from '@/app/api/terminology/route';

describe('GET /api/terminology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject unauthenticated users', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 }),
    } as any);
    vi.mocked(isAuthError).mockReturnValue(true);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('should return TECHNICAL_TERMS for ADMIN user', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      session: {
        user: { role: 'ADMIN', institutionId: null },
      },
    } as any);
    vi.mocked(isAuthError).mockReturnValue(false);
    vi.mocked(resolveTerminology).mockResolvedValue({
      domain: 'Institution',
      playbook: 'Playbook',
      spec: 'Spec',
      caller: 'Caller',
      cohort: 'Cohort',
      instructor: 'Instructor',
      session: 'Session',
      persona: 'Persona',
      supervisor: 'Supervisor',
      teach_action: 'Teach',
      learning_noun: 'Learning',
    } as any);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.terms.domain).toBe('Institution');
    expect(data.terms.caller).toBe('Caller');
    expect(resolveTerminology).toHaveBeenCalledWith('ADMIN', null);
  });

  it('should return institution type terms for EDUCATOR with institution', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      session: {
        user: { role: 'EDUCATOR', institutionId: 'inst-123' },
      },
    } as any);
    vi.mocked(isAuthError).mockReturnValue(false);
    vi.mocked(resolveTerminology).mockResolvedValue({
      domain: 'School',
      playbook: 'Lesson Plan',
      spec: 'Content',
      caller: 'Student',
      cohort: 'Class',
      instructor: 'Teacher',
      session: 'Lesson',
      persona: 'Teaching Style',
      supervisor: 'My Teacher',
      teach_action: 'Teach',
      learning_noun: 'Learning',
    } as any);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.terms.domain).toBe('School');
    expect(data.terms.caller).toBe('Student');
    expect(data.terms.instructor).toBe('Teacher');
    expect(resolveTerminology).toHaveBeenCalledWith('EDUCATOR', 'inst-123');
  });

  it('should return all 14 term keys', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      session: {
        user: { role: 'VIEWER', institutionId: null },
      },
    } as any);
    vi.mocked(isAuthError).mockReturnValue(false);
    vi.mocked(resolveTerminology).mockResolvedValue({
      domain: 'Institution',
      playbook: 'Playbook',
      spec: 'Spec',
      caller: 'Caller',
      cohort: 'Cohort',
      instructor: 'Instructor',
      session: 'Session',
      session_short: 'Session',
      persona: 'Persona',
      supervisor: 'Supervisor',
      mentor: 'Supervisor',
      teach_action: 'Teach',
      learning_noun: 'Learning',
      group: 'Group',
    } as any);

    const res = await GET();
    const data = await res.json();

    const keys = Object.keys(data.terms);
    expect(keys).toContain('domain');
    expect(keys).toContain('playbook');
    expect(keys).toContain('spec');
    expect(keys).toContain('caller');
    expect(keys).toContain('cohort');
    expect(keys).toContain('instructor');
    expect(keys).toContain('session');
    expect(keys).toContain('session_short');
    expect(keys).toContain('persona');
    expect(keys).toContain('supervisor');
    expect(keys).toContain('mentor');
    expect(keys).toContain('teach_action');
    expect(keys).toContain('learning_noun');
    expect(keys).toContain('group');
    expect(keys.length).toBe(14);
  });
});
