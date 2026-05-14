import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma before importing the module under test
vi.mock('@/lib/prisma', () => {
  const _p = {
  prisma: {
    institution: {
      findUnique: vi.fn(),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { prisma } from '@/lib/prisma';
import {
  resolveTerminology,
  resolveTermLabel,
  TECHNICAL_TERMS,
  invalidateTerminologyCache,
} from '@/lib/terminology';
import type { TermMap } from '@/lib/terminology/types';

const SCHOOL_TERMS: TermMap = {
  domain: 'School',
  playbook: 'Lesson Plan',
  spec: 'Content',
  caller: 'Student',
  cohort: 'Class',
  instructor: 'Teacher',
  session: 'Lesson',
  session_short: 'Lesson',
  persona: 'Teaching Style',
  supervisor: 'My Teacher',
  mentor: 'Teacher',
  teach_action: 'Teach',
  learning_noun: 'Learning',
  group: 'Department',
};

describe('lib/terminology (two-tier resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTerminologyCache();
  });

  describe('resolveTerminology', () => {
    it('should return TECHNICAL_TERMS for ADMIN role', async () => {
      const terms = await resolveTerminology('ADMIN');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should return TECHNICAL_TERMS for SUPERADMIN role', async () => {
      const terms = await resolveTerminology('SUPERADMIN');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should return TECHNICAL_TERMS for SUPER_TESTER role', async () => {
      const terms = await resolveTerminology('SUPER_TESTER');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should return TECHNICAL_TERMS when no institutionId provided', async () => {
      const terms = await resolveTerminology('EDUCATOR');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should return TECHNICAL_TERMS when institutionId is null', async () => {
      const terms = await resolveTerminology('EDUCATOR', null);
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should return institution type terminology for non-admin with institution', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: { terminology: SCHOOL_TERMS },
      } as any);

      const terms = await resolveTerminology('EDUCATOR', 'inst-1');

      expect(terms.domain).toBe('School');
      expect(terms.playbook).toBe('Lesson Plan');
      expect(terms.spec).toBe('Content');
      expect(terms.caller).toBe('Student');
      expect(terms.cohort).toBe('Class');
      expect(terms.instructor).toBe('Teacher');
      expect(terms.session).toBe('Lesson');
    });

    it('should fallback to TECHNICAL_TERMS if institution has no type', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: null,
      } as any);

      const terms = await resolveTerminology('EDUCATOR', 'inst-1');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should fallback to TECHNICAL_TERMS if institution not found', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue(null);

      const terms = await resolveTerminology('EDUCATOR', 'inst-nonexistent');
      expect(terms).toEqual(TECHNICAL_TERMS);
    });

    it('should merge partial terminology with TECHNICAL_TERMS as fallback', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: {
          terminology: {
            domain: 'Organization',
            // Missing other keys — should fallback
          },
        },
      } as any);

      const terms = await resolveTerminology('EDUCATOR', 'inst-1');

      expect(terms.domain).toBe('Organization');
      expect(terms.playbook).toBe('Course'); // fallback to TECHNICAL_TERMS
      expect(terms.caller).toBe('Caller'); // fallback
    });

    it('should cache results for same institutionId', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: { terminology: SCHOOL_TERMS },
      } as any);

      await resolveTerminology('EDUCATOR', 'inst-1');
      await resolveTerminology('EDUCATOR', 'inst-1');

      // Only one DB call due to caching
      expect(prisma.institution.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should not cache for admin roles (they skip DB lookup)', async () => {
      await resolveTerminology('ADMIN', 'inst-1');

      expect(prisma.institution.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveTermLabel', () => {
    it('should return singular label for admin', async () => {
      const label = await resolveTermLabel('domain', 'ADMIN');
      expect(label).toBe('Institution');
    });

    it('should return plural label when requested', async () => {
      const label = await resolveTermLabel('domain', 'ADMIN', undefined, true);
      expect(label).toBe('Institutions');
    });

    it('should return institution-specific label for educator', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: { terminology: SCHOOL_TERMS },
      } as any);

      const label = await resolveTermLabel('caller', 'EDUCATOR', 'inst-1');
      expect(label).toBe('Student');
    });

    it('should return plural institution-specific label', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: { terminology: SCHOOL_TERMS },
      } as any);

      const label = await resolveTermLabel('caller', 'EDUCATOR', 'inst-1', true);
      expect(label).toBe('Students');
    });
  });

  describe('invalidateTerminologyCache', () => {
    it('should clear cache so next call hits DB', async () => {
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({
        id: 'inst-1',
        type: { terminology: SCHOOL_TERMS },
      } as any);

      await resolveTerminology('EDUCATOR', 'inst-1');
      expect(prisma.institution.findUnique).toHaveBeenCalledTimes(1);

      invalidateTerminologyCache();

      await resolveTerminology('EDUCATOR', 'inst-1');
      expect(prisma.institution.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
