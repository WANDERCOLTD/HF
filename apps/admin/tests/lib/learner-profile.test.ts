/**
 * Tests for learner/profile.ts (contract-driven learner profile)
 *
 * Covers:
 * - buildStorageKey uses ContractRegistry async getters
 * - updateLearnerProfile stores attributes with contract-defined keys
 * - getLearnerProfile reads attributes using contract-defined prefix
 * - resetLearnerProfile deletes by contract-defined prefix
 * - Throws when LEARNER_PROFILE_V1 contract not loaded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
const mockPrisma = {
  callerAttribute: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
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

// Contract data matching LEARNER_PROFILE_V1
const LEARNER_KEY_PATTERN = 'learner_profile:{category}:{key}';
const LEARNER_STORAGE_KEYS = {
  learningStyle: 'learning_style',
  pacePreference: 'pace_preference',
  interactionStyle: 'interaction_style',
  priorKnowledge: 'prior_knowledge:{domain}',
  preferredModality: 'preferred_modality',
  questionFrequency: 'question_frequency',
  sessionLength: 'session_length',
  feedbackStyle: 'feedback_style',
  lastUpdated: 'last_updated',
};

function setupContractMocks() {
  mockGetKeyPattern.mockResolvedValue(LEARNER_KEY_PATTERN);
  mockGetStorageKeys.mockResolvedValue(LEARNER_STORAGE_KEYS);
}

describe('learner/profile.ts', () => {
  let updateLearnerProfile: Function;
  let getLearnerProfile: Function;
  let resetLearnerProfile: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupContractMocks();
    mockPrisma.callerAttribute.upsert.mockResolvedValue({});
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.deleteMany.mockResolvedValue({ count: 0 });

    const mod = await import('@/lib/learner/profile');
    updateLearnerProfile = mod.updateLearnerProfile;
    getLearnerProfile = mod.getLearnerProfile;
    resetLearnerProfile = mod.resetLearnerProfile;
  });

  describe('updateLearnerProfile', () => {
    it('calls ContractRegistry async getters for key pattern', async () => {
      await updateLearnerProfile('caller-1', { learningStyle: 'visual' });

      expect(mockGetKeyPattern).toHaveBeenCalledWith('LEARNER_PROFILE_V1');
      expect(mockGetStorageKeys).toHaveBeenCalledWith('LEARNER_PROFILE_V1');
    });

    it('stores learning style with contract-defined key', async () => {
      await updateLearnerProfile('caller-1', { learningStyle: 'visual' });

      // Should upsert learning style + lastUpdated
      const learningStyleCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].create.stringValue === 'visual'
      );
      expect(learningStyleCall).toBeDefined();
      expect(learningStyleCall![0].where.callerId_key_scope.scope).toBe('LEARNER_PROFILE');
    });

    it('stores pace preference with contract-defined key', async () => {
      await updateLearnerProfile('caller-1', { pacePreference: 'slow' });

      const paceCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].create.stringValue === 'slow'
      );
      expect(paceCall).toBeDefined();
    });

    it('stores prior knowledge with domain-specific keys', async () => {
      await updateLearnerProfile('caller-1', {
        priorKnowledge: { physics: 'advanced', math: 'intermediate' },
      });

      const knowledgeCalls = mockPrisma.callerAttribute.upsert.mock.calls.filter(
        (c: any) => c[0].create.stringValue === 'advanced' || c[0].create.stringValue === 'intermediate'
      );
      expect(knowledgeCalls).toHaveLength(2);
    });

    it('always updates lastUpdated timestamp', async () => {
      await updateLearnerProfile('caller-1', { learningStyle: 'visual' });

      // Should have at least 2 upserts: learningStyle + lastUpdated
      expect(mockPrisma.callerAttribute.upsert.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('uses default confidence of 0.7', async () => {
      await updateLearnerProfile('caller-1', { learningStyle: 'visual' });

      const learningStyleCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].create.stringValue === 'visual'
      );
      expect(learningStyleCall![0].create.confidence).toBe(0.7);
    });

    it('accepts custom confidence', async () => {
      await updateLearnerProfile('caller-1', { learningStyle: 'visual' }, 0.95);

      const learningStyleCall = mockPrisma.callerAttribute.upsert.mock.calls.find(
        (c: any) => c[0].create.stringValue === 'visual'
      );
      expect(learningStyleCall![0].create.confidence).toBe(0.95);
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);
      mockGetStorageKeys.mockResolvedValue(null);

      await expect(
        updateLearnerProfile('caller-1', { learningStyle: 'visual' })
      ).rejects.toThrow('LEARNER_PROFILE_V1 contract not loaded');
    });
  });

  describe('getLearnerProfile', () => {
    it('reads profile using contract-defined prefix', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: 'learner_profile:learning_style:learning_style', stringValue: 'visual' },
        { key: 'learner_profile:pace:pace_preference', stringValue: 'moderate' },
        { key: 'learner_profile:prior_knowledge:physics', stringValue: 'advanced' },
        { key: 'learner_profile:metadata:last_updated', stringValue: '2026-02-12T10:00:00Z' },
      ]);

      const profile = await getLearnerProfile('caller-1');

      expect(profile.learningStyle).toBe('visual');
      expect(profile.pacePreference).toBe('moderate');
      expect(profile.priorKnowledge).toEqual({ physics: 'advanced' });
      expect(profile.lastUpdated).toBe('2026-02-12T10:00:00Z');
    });

    it('returns null fields when no attributes exist', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);

      const profile = await getLearnerProfile('caller-1');

      expect(profile.learningStyle).toBeNull();
      expect(profile.pacePreference).toBeNull();
      expect(profile.interactionStyle).toBeNull();
      expect(profile.priorKnowledge).toEqual({});
      expect(profile.preferredModality).toBeNull();
      expect(profile.questionFrequency).toBeNull();
      expect(profile.sessionLength).toBeNull();
      expect(profile.feedbackStyle).toBeNull();
      expect(profile.lastUpdated).toBeNull();
    });

    it('queries with correct prefix from contract', async () => {
      mockPrisma.callerAttribute.findMany.mockResolvedValue([]);

      await getLearnerProfile('caller-1');

      expect(mockPrisma.callerAttribute.findMany).toHaveBeenCalledWith({
        where: {
          callerId: 'caller-1',
          scope: 'LEARNER_PROFILE',
          key: { startsWith: 'learner_profile:' },
        },
      });
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);

      await expect(getLearnerProfile('caller-1')).rejects.toThrow(
        'LEARNER_PROFILE_V1 contract not loaded'
      );
    });
  });

  describe('resetLearnerProfile', () => {
    it('deletes all attributes with contract-defined prefix', async () => {
      await resetLearnerProfile('caller-1');

      expect(mockPrisma.callerAttribute.deleteMany).toHaveBeenCalledWith({
        where: {
          callerId: 'caller-1',
          scope: 'LEARNER_PROFILE',
          key: { startsWith: 'learner_profile:' },
        },
      });
    });

    it('throws when contract not loaded', async () => {
      mockGetKeyPattern.mockResolvedValue(null);

      await expect(resetLearnerProfile('caller-1')).rejects.toThrow(
        'LEARNER_PROFILE_V1 contract not loaded'
      );
    });
  });
});
