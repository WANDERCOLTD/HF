/**
 * Tests for ContractRegistry (DB-backed)
 *
 * Covers:
 * - Loading contracts from SystemSettings (DB)
 * - Cache TTL behavior (30s)
 * - Deduped loading (concurrent calls don't trigger multiple DB queries)
 * - getContract with version matching
 * - getStorageKeys, getKeyPattern, getThresholds helpers
 * - validateSpec against contract requirements
 * - Error handling for missing/malformed contracts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing registry
const mockPrisma = {
  systemSetting: {
    findMany: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

// Sample contract data
const CURRICULUM_CONTRACT = {
  contractId: 'CURRICULUM_PROGRESS_V1',
  version: '1.0',
  description: 'Curriculum progress tracking contract',
  status: 'active',
  storage: {
    keyPattern: 'curriculum:{specSlug}:{key}',
    keys: {
      currentModule: 'current_module',
      mastery: 'mastery:{moduleId}',
      lastAccessed: 'last_accessed',
    },
  },
  thresholds: {
    masteryComplete: 0.8,
    masteryMinimum: 0.4,
  },
};

const LEARNER_CONTRACT = {
  contractId: 'LEARNER_PROFILE_V1',
  version: '1.0',
  description: 'Learner profile contract',
  status: 'active',
  storage: {
    keyPattern: 'learner_profile:{category}:{key}',
    keys: {
      learningStyle: 'learning_style',
      pacePreference: 'pace_preference',
      priorKnowledge: 'prior_knowledge:{domain}',
      lastUpdated: 'last_updated',
    },
  },
};

const CONTENT_TRUST_CONTRACT = {
  contractId: 'CONTENT_TRUST_V1',
  version: '1.0',
  description: 'Content trust levels',
  status: 'active',
  metadata: {
    sourceRef: {
      trustLevel: { required: true, type: 'string', enum: ['UNVERIFIED', 'AI_ASSISTED', 'EXPERT_CURATED', 'PUBLISHED_REFERENCE', 'ACCREDITED_MATERIAL', 'REGULATORY_STANDARD'] },
      sourceUrl: { required: false, type: 'string' },
    },
  },
};

function mockDBContracts(contracts: any[]) {
  mockPrisma.systemSetting.findMany.mockResolvedValue(
    contracts.map(c => ({
      key: `contract:${c.contractId}`,
      value: JSON.stringify(c),
    }))
  );
}

describe('ContractRegistry', () => {
  let ContractRegistry: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Re-import to get fresh singleton each test
    vi.resetModules();
    const mod = await import('@/lib/contracts/registry');
    ContractRegistry = mod.ContractRegistry;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('load()', () => {
    it('loads contracts from SystemSettings DB table', async () => {
      mockDBContracts([CURRICULUM_CONTRACT, LEARNER_CONTRACT]);

      await ContractRegistry.load();
      const contracts = await ContractRegistry.listContracts();

      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledWith({
        where: { key: { startsWith: 'contract:' } },
      });
      expect(contracts).toHaveLength(2);
      expect(contracts[0].contractId).toBe('CURRICULUM_PROGRESS_V1');
      expect(contracts[1].contractId).toBe('LEARNER_PROFILE_V1');
    });

    it('handles empty DB (no contracts seeded)', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);

      await ContractRegistry.load();
      const contracts = await ContractRegistry.listContracts();

      expect(contracts).toHaveLength(0);
    });

    it('skips contracts with missing contractId or version', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'contract:GOOD', value: JSON.stringify(CURRICULUM_CONTRACT) },
        { key: 'contract:BAD1', value: JSON.stringify({ description: 'no id or version' }) },
        { key: 'contract:BAD2', value: JSON.stringify({ contractId: 'HAS_ID' }) }, // no version
      ]);

      await ContractRegistry.load();
      const contracts = await ContractRegistry.listContracts();

      expect(contracts).toHaveLength(1);
      expect(contracts[0].contractId).toBe('CURRICULUM_PROGRESS_V1');
    });

    it('skips contracts with invalid JSON', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'contract:GOOD', value: JSON.stringify(CURRICULUM_CONTRACT) },
        { key: 'contract:BAD', value: 'not valid json{{{' },
      ]);

      await ContractRegistry.load();
      const contracts = await ContractRegistry.listContracts();

      expect(contracts).toHaveLength(1);
    });

    it('handles DB query failure gracefully', async () => {
      mockPrisma.systemSetting.findMany.mockRejectedValue(new Error('DB connection failed'));

      await ContractRegistry.load();
      const contracts = await ContractRegistry.listContracts();

      // Should not throw, just log error and have empty contracts
      expect(contracts).toHaveLength(0);
    });
  });

  describe('cache & TTL', () => {
    it('does not re-query DB within TTL window (30s)', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      // First call loads
      await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');
      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledTimes(1);

      // Second call within TTL uses cache
      await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');
      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-queries DB after TTL expires', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      // First load
      await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');
      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledTimes(1);

      // Advance past TTL (30s)
      vi.advanceTimersByTime(31_000);

      // Should re-query
      await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');
      expect(mockPrisma.systemSetting.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('getContract()', () => {
    it('returns contract by ID', async () => {
      mockDBContracts([CURRICULUM_CONTRACT, LEARNER_CONTRACT]);

      const contract = await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');

      expect(contract).not.toBeNull();
      expect(contract!.contractId).toBe('CURRICULUM_PROGRESS_V1');
      expect(contract!.version).toBe('1.0');
    });

    it('returns null for unknown contract ID', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const contract = await ContractRegistry.getContract('NONEXISTENT_V1');

      expect(contract).toBeNull();
    });

    it('returns null if version does not match', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const contract = await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1', '2.0');

      expect(contract).toBeNull();
    });

    it('returns contract when version matches', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const contract = await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1', '1.0');

      expect(contract).not.toBeNull();
      expect(contract!.version).toBe('1.0');
    });
  });

  describe('getStorageKeys()', () => {
    it('returns storage keys for a contract', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const keys = await ContractRegistry.getStorageKeys('CURRICULUM_PROGRESS_V1');

      expect(keys).toEqual({
        currentModule: 'current_module',
        mastery: 'mastery:{moduleId}',
        lastAccessed: 'last_accessed',
      });
    });

    it('returns null for unknown contract', async () => {
      mockDBContracts([]);

      const keys = await ContractRegistry.getStorageKeys('NONEXISTENT');

      expect(keys).toBeNull();
    });
  });

  describe('getKeyPattern()', () => {
    it('returns key pattern for a contract', async () => {
      mockDBContracts([LEARNER_CONTRACT]);

      const pattern = await ContractRegistry.getKeyPattern('LEARNER_PROFILE_V1');

      expect(pattern).toBe('learner_profile:{category}:{key}');
    });

    it('returns null for unknown contract', async () => {
      mockDBContracts([]);

      const pattern = await ContractRegistry.getKeyPattern('NONEXISTENT');

      expect(pattern).toBeNull();
    });
  });

  describe('getThresholds()', () => {
    it('returns thresholds for a contract', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const thresholds = await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1');

      expect(thresholds).toEqual({
        masteryComplete: 0.8,
        masteryMinimum: 0.4,
      });
    });

    it('returns null for contract without thresholds', async () => {
      mockDBContracts([LEARNER_CONTRACT]);

      const thresholds = await ContractRegistry.getThresholds('LEARNER_PROFILE_V1');

      expect(thresholds).toBeNull();
    });
  });

  describe('validateSpec()', () => {
    it('validates spec against contract metadata requirements', async () => {
      mockDBContracts([CONTENT_TRUST_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        { metadata: { sourceRef: { trustLevel: 'EXPERT_CURATED' } } },
        { contractId: 'CONTENT_TRUST_V1', role: 'producer', produces: [{ field: 'trustLevel' }] }
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails validation when required metadata section is missing', async () => {
      mockDBContracts([CONTENT_TRUST_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        { metadata: {} }, // missing sourceRef section
        { contractId: 'CONTENT_TRUST_V1', role: 'consumer', consumes: [{ field: 'trustLevel', required: true }] }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required metadata section: sourceRef');
    });

    it('fails validation when required field is missing', async () => {
      mockDBContracts([CONTENT_TRUST_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        { metadata: { sourceRef: { sourceUrl: 'http://example.com' } } }, // missing trustLevel
        { contractId: 'CONTENT_TRUST_V1', role: 'producer', produces: [] }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: metadata.sourceRef.trustLevel');
    });

    it('fails validation when enum value is invalid', async () => {
      mockDBContracts([CONTENT_TRUST_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        { metadata: { sourceRef: { trustLevel: 'INVALID_LEVEL' } } },
        { contractId: 'CONTENT_TRUST_V1', role: 'producer', produces: [] }
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid value for sourceRef.trustLevel');
    });

    it('returns error when contract not found', async () => {
      mockDBContracts([]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        {},
        { contractId: 'NONEXISTENT_V1', role: 'producer' }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Contract not found: NONEXISTENT_V1');
    });

    it('warns when producer declares no produces', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        {},
        { contractId: 'CURRICULUM_PROGRESS_V1', role: 'producer', produces: [] }
      );

      expect(result.warnings).toContain('Spec declares producer role but produces nothing');
    });

    it('warns when consumer declares no consumes', async () => {
      mockDBContracts([CURRICULUM_CONTRACT]);

      const result = await ContractRegistry.validateSpec(
        'TEST-SPEC-001',
        {},
        { contractId: 'CURRICULUM_PROGRESS_V1', role: 'consumer', consumes: [] }
      );

      expect(result.warnings).toContain('Spec declares consumer role but consumes nothing');
    });
  });

  describe('listContracts()', () => {
    it('returns all loaded contracts', async () => {
      mockDBContracts([CURRICULUM_CONTRACT, LEARNER_CONTRACT, CONTENT_TRUST_CONTRACT]);

      const contracts = await ContractRegistry.listContracts();

      expect(contracts).toHaveLength(3);
      const ids = contracts.map((c: any) => c.contractId);
      expect(ids).toContain('CURRICULUM_PROGRESS_V1');
      expect(ids).toContain('LEARNER_PROFILE_V1');
      expect(ids).toContain('CONTENT_TRUST_V1');
    });
  });
});
