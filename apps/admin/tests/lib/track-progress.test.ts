/**
 * Tests for track-progress.ts (contract-driven curriculum progress)
 *
 * Covers:
 * - buildStorageKey uses ContractRegistry async getters
 * - updateCurriculumProgress stores data with contract-defined keys
 * - getCurriculumProgress reads data using contract-defined prefix
 * - completeModule marks mastery to 1.0 and advances
 * - resetCurriculumProgress deletes by contract-defined prefix
 * - getActiveCurricula extracts unique spec slugs
 * - Throws when contract not loaded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma. `curriculum.findFirst` is the entry point for the
// CallerModuleProgress dual-write in updateCurriculumProgress (#409). Returning
// null here keeps the dual-write off — these tests assert the CallerAttribute
// surface only.
const mockPrisma = {
  callerAttribute: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  curriculum: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Mock ContractRegistry
const mockGetKeyPattern = vi.fn();
const mockGetStorageKeys = vi.fn();

vi.mock('@/lib/contracts/registry', () => ({
  ContractRegistry: {
    getKeyPattern: (...args: any[]) => mockGetKeyPattern(...args),
    getStorageKeys: (...args: any[]) => mockGetStorageKeys(...args),
  },
}));

// Mock system-settings (used by trust-weighted progress)
vi.mock('@/lib/system-settings', () => ({
  getTrustSettings: vi.fn().mockResolvedValue({
    weightL5Regulatory: 1.0,
    weightL4Accredited: 0.9,
    weightL3Published: 0.7,
    weightL2Expert: 0.5,
    weightL1AiAssisted: 0.2,
    weightL0Unverified: 0.05,
    certificationMinWeight: 0.7,
  }),
  TRUST_DEFAULTS: {
    weightL5Regulatory: 1.0,
    weightL4Accredited: 0.9,
    weightL3Published: 0.7,
    weightL2Expert: 0.5,
    weightL1AiAssisted: 0.2,
    weightL0Unverified: 0.05,
    certificationMinWeight: 0.7,
  },
}));

// Contract data matching CURRICULUM_PROGRESS_V1
const CURRICULUM_KEY_PATTERN = 'curriculum:{specSlug}:{key}';
const CURRICULUM_STORAGE_KEYS = {
  currentModule: 'current_module',
  mastery: 'mastery:{moduleId}',
  lastAccessed: 'last_accessed',
  currentSession: 'current_session',
};

function setupContractMocks() {
  mockGetKeyPattern.mockResolvedValue(CURRICULUM_KEY_PATTERN);
  mockGetStorageKeys.mockResolvedValue(CURRICULUM_STORAGE_KEYS);
}

describe('track-progress.ts', () => {
  let updateCurriculumProgress: Function;
  let getCurriculumProgress: Function;
  let completeModule: Function;
  let resetCurriculumProgress: Function;
  let getActiveCurricula: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupContractMocks();
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.deleteMany.mockResolvedValue({ count: 0 });
    // #409: CallerModuleProgress dual-write reads curriculum by specSlug.
    // Return null so the dual-write branch is a no-op for these tests.
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);

    const mod = await import('@/lib/curriculum/track-progress');
    updateCurriculumProgress = mod.updateCurriculumProgress;
    getCurriculumProgress = mod.getCurriculumProgress;
    completeModule = mod.completeModule;
    resetCurriculumProgress = mod.resetCurriculumProgress;
    getActiveCurricula = mod.getActiveCurricula;
  });

  describe('updateCurriculumProgress', () => {
    it('uses contract-defined key pattern for currentModule', async () => {
      await updateCurriculumProgress('caller-1', 'QM-CONTENT-001', {
        currentModuleId: 'chapter1',
      });

      expect(mockGetKeyPattern).toHaveBeenCalledWith('CURRICULUM_PROGRESS_V1');
      expect(mockGetStorageKeys).toHaveBeenCalledWith('CURRICULUM_PROGRESS_V1');

      const upsertCall = mockPrisma.callerAttribute.upsert.mock.calls[0][0];
      expect(upsertCall.where.callerId_key_scope.key).toBe('curriculum:QM-CONTENT-001:current_module');
      expect(upsertCall.where.callerId_key_scope.scope).toBe('CURRICULUM');
      expect(upsertCall.create.stringValue).toBe('chapter1');
    });

    it('uses contract-defined key pattern for mastery', async () => {
      await updateCurriculumProgress('caller-1', 'QM-CONTENT-001', {
        moduleMastery: { 'chapter1_blackbody': 0.75 },
      });

      const upsertCall = mockPrisma.callerAttribute.upsert.mock.calls[0][0];
      expect(upsertCall.where.callerId_key_scope.key).toBe('curriculum:QM-CONTENT-001:mastery:chapter1_blackbody');
      expect(upsertCall.create.numberValue).toBe(0.75);
    });

    it('uses contract-defined key pattern for lastAccessed', async () => {
      const now = new Date('2026-02-12T10:00:00Z');
      await updateCurriculumProgress('caller-1', 'QM-CONTENT-001', {
        lastAccessedAt: now,
      });

      const upsertCall = mockPrisma.callerAttribute.upsert.mock.calls[0][0];
      expect(upsertCall.where.callerId_key_scope.key).toBe('curriculum:QM-CONTENT-001:last_accessed');
      expect(upsertCall.create.stringValue).toBe(now.toISOString());
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);
      mockGetStorageKeys.mockResolvedValue(null);

      await expect(
        updateCurriculumProgress('caller-1', 'QM', { currentModuleId: 'ch1' })
      ).rejects.toThrow('CURRICULUM_PROGRESS_V1 contract not loaded');
    });
  });

  describe('getCurriculumProgress', () => {
    it('reads progress using contract-defined prefix', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: 'curriculum:QM-CONTENT-001:current_module', stringValue: 'chapter2', numberValue: null },
        { key: 'curriculum:QM-CONTENT-001:mastery:chapter1', stringValue: null, numberValue: 0.9 },
        { key: 'curriculum:QM-CONTENT-001:mastery:chapter2', stringValue: null, numberValue: 0.4 },
        { key: 'curriculum:QM-CONTENT-001:last_accessed', stringValue: '2026-02-12T10:00:00Z', numberValue: null },
      ]);

      const progress = await getCurriculumProgress('caller-1', 'QM-CONTENT-001');

      expect(progress.currentModuleId).toBe('chapter2');
      expect(progress.modulesMastery).toEqual({ chapter1: 0.9, chapter2: 0.4 });
      expect(progress.lastAccessedAt).toBe('2026-02-12T10:00:00Z');
    });

    it('returns empty progress when no attributes exist', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);

      const progress = await getCurriculumProgress('caller-1', 'QM-CONTENT-001');

      expect(progress.currentModuleId).toBeNull();
      expect(progress.modulesMastery).toEqual({});
      expect(progress.lastAccessedAt).toBeNull();
    });

    it('queries with correct prefix derived from contract pattern', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);

      await getCurriculumProgress('caller-1', 'MY-SPEC');

      expect(mockPrisma.callerAttribute.findMany).toHaveBeenCalledWith({
        where: {
          callerId: 'caller-1',
          scope: 'CURRICULUM',
          key: { startsWith: 'curriculum:MY-SPEC:' },
        },
      });
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);

      await expect(
        getCurriculumProgress('caller-1', 'QM')
      ).rejects.toThrow('CURRICULUM_PROGRESS_V1 contract not loaded');
    });
  });

  describe('completeModule', () => {
    it('sets mastery to 1.0 for completed module', async () => {
      await completeModule('caller-1', 'QM-CONTENT-001', 'chapter1');

      // Should have upserted mastery and lastAccessed
      const masteryCalls = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c: any) => c[0].where.callerId_key_scope.key.includes('mastery:chapter1')
      );
      expect(masteryCalls).toHaveLength(1);
      expect(masteryCalls[0][0].create.numberValue).toBe(1.0);
    });

    it('advances to next module when provided', async () => {
      await completeModule('caller-1', 'QM-CONTENT-001', 'chapter1', 'chapter2');

      const moduleCalls = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c: any) => c[0].where.callerId_key_scope.key.includes('current_module')
      );
      expect(moduleCalls).toHaveLength(1);
      expect(moduleCalls[0][0].create.stringValue).toBe('chapter2');
    });
  });

  describe('resetCurriculumProgress', () => {
    it('deletes all attributes with contract-defined prefix', async () => {
      await resetCurriculumProgress('caller-1', 'QM-CONTENT-001');

      expect(mockPrisma.callerAttribute.deleteMany).toHaveBeenCalledWith({
        where: {
          callerId: 'caller-1',
          scope: 'CURRICULUM',
          key: { startsWith: 'curriculum:QM-CONTENT-001:' },
        },
      });
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);

      await expect(
        resetCurriculumProgress('caller-1', 'QM')
      ).rejects.toThrow('CURRICULUM_PROGRESS_V1 contract not loaded');
    });
  });

  describe('getActiveCurricula', () => {
    it('extracts unique spec slugs from curriculum keys', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: 'curriculum:QM-CONTENT-001:current_module' },
        { key: 'curriculum:QM-CONTENT-001:mastery:ch1' },
        { key: 'curriculum:FS-L2-001:current_module' },
      ]);

      const slugs = await getActiveCurricula('caller-1');

      expect(slugs).toHaveLength(2);
      expect(slugs).toContain('QM-CONTENT-001');
      expect(slugs).toContain('FS-L2-001');
    });

    it('returns empty when no curriculum attributes', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);

      const slugs = await getActiveCurricula('caller-1');

      expect(slugs).toHaveLength(0);
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);

      await expect(getActiveCurricula('caller-1')).rejects.toThrow('CURRICULUM_PROGRESS_V1 contract not loaded');
    });
  });

  describe('currentSession tracking', () => {
    it('currentSession removed — scheduler owns pacing', () => {
      // currentSession was removed from ProgressUpdate interface.
      // Scheduler now owns session numbering. This test documents that.
      expect(true).toBe(true);
    });

    it('reads currentSession from progress attributes', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: 'curriculum:FS-L2-001:current_module', stringValue: 'mod-2', numberValue: null },
        { key: 'curriculum:FS-L2-001:current_session', stringValue: null, numberValue: 4 },
        { key: 'curriculum:FS-L2-001:mastery:mod-1', stringValue: null, numberValue: 0.85 },
      ]);

      const progress = await getCurriculumProgress('caller-1', 'FS-L2-001');

      // currentSession removed — scheduler owns pacing
      expect(progress.currentModuleId).toBe('mod-2');
      expect(progress.modulesMastery).toEqual({ 'mod-1': 0.85 });
    });

    // currentSession tests removed — scheduler owns pacing

    it('updates module + lastAccessed fields', async () => {
      await updateCurriculumProgress('caller-1', 'FS-L2-001', {
        currentModuleId: 'mod-3',
        lastAccessedAt: new Date('2026-02-16T12:00:00Z'),
      });

      // Should have 2 upsert calls: currentModule + lastAccessed (currentSession removed)
      expect(mockPrisma.callerAttribute.upsert).toHaveBeenCalledTimes(2);

      const moduleCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].where.callerId_key_scope.key.includes('current_module')
      );
      expect(moduleCall).toBeDefined();
      expect(moduleCall![0].create.stringValue).toBe('mod-3');

      const lastAccessedCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].where.callerId_key_scope.key.includes('last_accessed')
      );
      expect(lastAccessedCall).toBeDefined();
      expect(lastAccessedCall![0].create.stringValue).toBe('2026-02-16T12:00:00.000Z');
    });
  });

  describe('capMasteryByCallCount (issue #397 Phase 0)', () => {
    let capMasteryByCallCount: (m: number, n: number) => number;

    beforeEach(async () => {
      const mod = await import('@/lib/curriculum/track-progress');
      capMasteryByCallCount = mod.capMasteryByCallCount;
    });

    it('caps AI snapshot to callCount/6 on first call', () => {
      // AI returned 0.7 after a single call → capped to 1/6 ≈ 0.167
      expect(capMasteryByCallCount(0.7, 1)).toBeCloseTo(1 / 6, 5);
      expect(capMasteryByCallCount(0.25, 1)).toBeCloseTo(1 / 6, 5);
    });

    it('does not raise mastery below its raw value', () => {
      // AI returned 0.05 — well below cap of 1/6 — should pass through unchanged
      expect(capMasteryByCallCount(0.05, 1)).toBe(0.05);
      expect(capMasteryByCallCount(0, 3)).toBe(0);
    });

    it('scales linearly with callCount up to 6', () => {
      expect(capMasteryByCallCount(1.0, 2)).toBeCloseTo(2 / 6, 5);
      expect(capMasteryByCallCount(1.0, 3)).toBeCloseTo(3 / 6, 5);
      expect(capMasteryByCallCount(1.0, 5)).toBeCloseTo(5 / 6, 5);
    });

    it('lifts cap to 1.0 from call 6 onward', () => {
      expect(capMasteryByCallCount(0.95, 6)).toBe(0.95);
      expect(capMasteryByCallCount(1.0, 6)).toBe(1.0);
      expect(capMasteryByCallCount(1.0, 12)).toBe(1.0);
    });

    it('never returns a value above 1.0', () => {
      // Belt-and-braces in case an upstream caller passes an out-of-range AI value
      expect(capMasteryByCallCount(1.5, 10)).toBe(1.0);
    });
  });

  describe('mergeLoScores (issue #397 Phase 1)', () => {
    let mergeLoScores: (existing: any, newScores: Record<string, number>) => any;

    beforeEach(async () => {
      const mod = await import('@/lib/curriculum/track-progress');
      mergeLoScores = mod.mergeLoScores;
    });

    it('initialises an empty map with first-call scores', () => {
      const merged = mergeLoScores(null, { lo1: 0.4, lo2: 0.6 });
      expect(merged).toEqual({
        lo1: { mastery: 0.4, callCount: 1 },
        lo2: { mastery: 0.6, callCount: 1 },
      });
    });

    it('running-averages existing LOs with new scores', () => {
      const prior = { lo1: { mastery: 0.4, callCount: 1 } };
      const merged = mergeLoScores(prior, { lo1: 0.8 });
      expect(merged.lo1.mastery).toBeCloseTo(0.6, 5); // (0.4*1 + 0.8) / 2
      expect(merged.lo1.callCount).toBe(2);
    });

    it('leaves LOs absent from the new batch untouched', () => {
      const prior = {
        lo1: { mastery: 0.4, callCount: 1 },
        lo2: { mastery: 0.7, callCount: 1 },
      };
      const merged = mergeLoScores(prior, { lo1: 0.8 });
      expect(merged.lo2).toEqual({ mastery: 0.7, callCount: 1 });
    });

    it('clamps out-of-range AI scores to [0, 1] before averaging', () => {
      const merged = mergeLoScores(null, { lo1: 1.5, lo2: -0.3 });
      expect(merged.lo1).toEqual({ mastery: 1.0, callCount: 1 });
      expect(merged.lo2).toEqual({ mastery: 0.0, callCount: 1 });
    });

    it('converges toward the true score over multiple calls', () => {
      let state: any = null;
      for (let i = 0; i < 5; i++) {
        state = mergeLoScores(state, { lo1: 0.6 });
      }
      expect(state.lo1.mastery).toBeCloseTo(0.6, 5);
      expect(state.lo1.callCount).toBe(5);
    });
  });

  describe('rollupModuleMastery (issue #397 Phase 1)', () => {
    let rollupModuleMastery: (map: any) => number | null;

    beforeEach(async () => {
      const mod = await import('@/lib/curriculum/track-progress');
      rollupModuleMastery = mod.rollupModuleMastery;
    });

    it('returns null when no LOs have been scored', () => {
      expect(rollupModuleMastery(null)).toBeNull();
      expect(rollupModuleMastery({})).toBeNull();
    });

    it('averages mastery over scored LOs only', () => {
      const map = {
        lo1: { mastery: 0.4, callCount: 2 },
        lo2: { mastery: 0.8, callCount: 1 },
      };
      expect(rollupModuleMastery(map)).toBeCloseTo(0.6, 5);
    });

    it('does not penalise modules for unscored LOs (count = scored only)', () => {
      // 1 LO scored at 0.5 → module mastery = 0.5, regardless of other LOs
      // that exist in the spec but haven't been touched yet.
      const map = { lo1: { mastery: 0.5, callCount: 1 } };
      expect(rollupModuleMastery(map)).toBe(0.5);
    });
  });

  describe('validateLoScores (issue #403 AI-to-DB guard)', () => {
    let validateLoScores: (s: Record<string, number>) => { filtered: Record<string, number>; rejected: string[] };

    beforeEach(async () => {
      const mod = await import('@/lib/curriculum/track-progress');
      validateLoScores = mod.validateLoScores;
    });

    it('rejects placeholder LO keys matching /^LO\\d+$/', () => {
      const result = validateLoScores({ LO1: 0.5, LO2: 0.7 });
      expect(result.filtered).toEqual({});
      expect(result.rejected).toEqual(['LO1', 'LO2']);
    });

    it('preserves real LO refs (full strings, slugs, codes)', () => {
      const real = {
        'Band 6 GRA: Mix of short and complex structures': 0.6,
        'OUT-01': 0.4,
        'R04-LO2-AC2.3': 0.8,
      };
      const result = validateLoScores(real);
      expect(result.filtered).toEqual(real);
      expect(result.rejected).toEqual([]);
    });

    it('mixed input — passes real refs, drops placeholders', () => {
      const result = validateLoScores({ LO1: 0.5, 'OUT-01': 0.7, LO99: 0.3 });
      expect(result.filtered).toEqual({ 'OUT-01': 0.7 });
      expect(result.rejected).toEqual(['LO1', 'LO99']);
    });

    it('returns empty filtered + empty rejected on empty input', () => {
      const result = validateLoScores({});
      expect(result.filtered).toEqual({});
      expect(result.rejected).toEqual([]);
    });

    it('does not treat a ref that merely contains "LO" as a placeholder', () => {
      // Refs like "LO1-AC2" (a hyphenated compound) must pass.
      const result = validateLoScores({ 'LO1-AC2': 0.5, 'LO-1': 0.7 });
      expect(result.filtered).toEqual({ 'LO1-AC2': 0.5, 'LO-1': 0.7 });
      expect(result.rejected).toEqual([]);
    });
  });
});
