/**
 * Tests for Domain management API routes:
 *   DELETE /api/domains/[domainId]  — soft-delete (deactivate) a domain
 *   DELETE /api/playbooks/[playbookId] — remove a playbook (used from domain detail)
 *
 * Business rules:
 *   - Cannot delete the default domain
 *   - Cannot delete a domain that still has callers assigned
 *   - Cannot delete a PUBLISHED playbook (must archive first)
 *   - Domain delete is a soft-delete (sets isActive = false)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  domain: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  playbook: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  playbookItem: {
    deleteMany: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Mock auth — routes now call requireAuth() which calls auth()
vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: 'test-user', email: 'test@example.com', role: 'ADMIN' } },
  }),
  isAuthError: vi.fn((result: any) => 'error' in result),
}));

// Mock deletePlaybookData — used by DELETE /api/playbooks/[playbookId]
const mockDeletePlaybookData = vi.fn();
vi.mock('@/lib/gdpr/delete-playbook-data', () => ({
  deletePlaybookData: (...args: any[]) => mockDeletePlaybookData(...args),
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
// DOMAIN DELETE TESTS
// =====================================================

describe('DELETE /api/domains/[domainId]', () => {
  let DELETE: typeof import('@/app/api/domains/[domainId]/route').DELETE;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/domains/[domainId]/route');
    DELETE = mod.DELETE;
  });

  it('returns 404 when domain does not exist', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ domainId: 'missing-id' })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it('blocks deletion of the default domain', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'domain-1',
      isDefault: true,
      _count: { callers: 0 },
    });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ domainId: 'domain-1' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/default/i);
  });

  it('blocks deletion when domain has callers', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'domain-2',
      isDefault: false,
      _count: { callers: 5 },
    });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ domainId: 'domain-2' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/5 callers/);
    expect(body.error).toMatch(/reassign/i);
  });

  it('soft-deletes a domain with zero callers', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'domain-3',
      isDefault: false,
      _count: { callers: 0 },
    });
    mockPrisma.domain.update.mockResolvedValue({ id: 'domain-3', isActive: false });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ domainId: 'domain-3' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/deactivated/i);
    expect(mockPrisma.domain.update).toHaveBeenCalledWith({
      where: { id: 'domain-3' },
      data: { isActive: false },
    });
  });

  it('does not hard-delete the domain row', async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: 'domain-4',
      isDefault: false,
      _count: { callers: 0 },
    });
    mockPrisma.domain.update.mockResolvedValue({ id: 'domain-4', isActive: false });

    await DELETE(
      createMockRequest('DELETE'),
      makeParams({ domainId: 'domain-4' })
    );

    // Should call update (soft delete), not delete
    expect(mockPrisma.domain.update).toHaveBeenCalled();
  });
});

// =====================================================
// PLAYBOOK DELETE TESTS (remove from domain)
// =====================================================

describe('DELETE /api/playbooks/[playbookId]', () => {
  let DELETE: typeof import('@/app/api/playbooks/[playbookId]/route').DELETE;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/app/api/playbooks/[playbookId]/route');
    DELETE = mod.DELETE;
  });

  it('returns 404 when playbook does not exist', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ playbookId: 'missing-pb' })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it('blocks deletion of a PUBLISHED playbook', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'pb-1',
      status: 'PUBLISHED',
      domainId: 'domain-1',
    });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ playbookId: 'pb-1' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/published/i);
    expect(body.error).toMatch(/archive/i);
  });

  it('deletes a DRAFT playbook and its items', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'pb-2',
      status: 'DRAFT',
      domainId: 'domain-1',
    });
    mockDeletePlaybookData.mockResolvedValue({
      callerPlaybooks: 0,
      cohortPlaybooks: 0,
      goalsNullified: 0,
      callsNullified: 0,
      composedPromptsNullified: 0,
      behaviorTargetsNullified: 0,
      invitesNullified: 0,
      childVersionsNullified: 0,
      playbookItems: 3,
      playbookSubjects: 0,
    });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ playbookId: 'pb-2' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockDeletePlaybookData).toHaveBeenCalledWith('pb-2');
  });

  it('deletes an ARCHIVED playbook', async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: 'pb-3',
      status: 'ARCHIVED',
      domainId: 'domain-1',
    });
    mockDeletePlaybookData.mockResolvedValue({
      callerPlaybooks: 0,
      cohortPlaybooks: 0,
      goalsNullified: 0,
      callsNullified: 0,
      composedPromptsNullified: 0,
      behaviorTargetsNullified: 0,
      invitesNullified: 0,
      childVersionsNullified: 0,
      playbookItems: 0,
      playbookSubjects: 0,
    });

    const res = await DELETE(
      createMockRequest('DELETE'),
      makeParams({ playbookId: 'pb-3' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
