import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing identity.ts (which imports @/lib/prisma)
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    analysisSpec: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx) => tx ?? mockPrisma }));

import { resolveSpecs, resolveVoiceSpecFallback, mergeIdentitySpec } from "@/lib/prompt/composition/transforms/identity";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  PlaybookData,
  SystemSpecData,
  ResolvedSpecs,
} from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/identity";

// --- helpers ---

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: {
      caller: { id: "c1", name: "Paul", email: null, phone: null, externalId: null, domain: null },
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 5,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "identity",
    name: "Identity",
    priority: 1,
    dataSource: "_assembled",
    activateWhen: { condition: "always" },
    fallback: { action: "omit" },
    transform: "extractIdentitySpec",
    outputKey: "identity",
  };
}

function makePlaybook(items: Array<Partial<SystemSpecData>> = []): PlaybookData {
  return {
    id: "pb-1",
    name: "Test Playbook",
    status: "ACTIVE",
    domain: { id: "d1", name: "QM", description: null },
    items: items.map((spec) => ({
      spec: {
        id: spec.id || "spec-1",
        slug: spec.slug || "TUT-001",
        name: spec.name || "Test Spec",
        description: spec.description || null,
        specRole: spec.specRole || "IDENTITY",
        outputType: spec.outputType || "PROMPT",
        config: spec.config || {},
        domain: spec.domain || null,
        extendsAgent: spec.extendsAgent || null,
      },
    })),
  };
}

// =====================================================
// resolveSpecs() — pure function
// =====================================================

describe("resolveSpecs", () => {
  it("returns null specs when no playbooks or system specs", () => {
    const result = resolveSpecs([], []);
    expect(result.identitySpec).toBeNull();
    expect(result.voiceSpec).toBeNull();
  });

  it("picks IDENTITY spec from playbook", () => {
    const pb = makePlaybook([{ specRole: "IDENTITY", name: "Tutor", config: { role: "teacher" } }]);
    const result = resolveSpecs([pb], []);
    expect(result.identitySpec).not.toBeNull();
    expect(result.identitySpec!.name).toBe("Tutor");
    expect(result.identitySpec!.config).toEqual({ role: "teacher" });
  });

  it("ignores CONTENT spec from playbook (removed in ADR-002)", () => {
    const pb = makePlaybook([{ specRole: "CONTENT", name: "Curriculum", config: { modules: [] } }]);
    const result = resolveSpecs([pb], []);
    // Content spec no longer resolved — curriculum data comes from DB
    expect(result.identitySpec).toBeNull();
  });

  it("picks VOICE spec from playbook (specRole=VOICE)", () => {
    const pb = makePlaybook([{ specRole: "VOICE", name: "Voice Guide", config: { pace: "slow" } }]);
    const result = resolveSpecs([pb], []);
    expect(result.voiceSpec).not.toBeNull();
    expect(result.voiceSpec!.name).toBe("Voice Guide");
  });

  it("picks VOICE spec from IDENTITY spec with domain=voice", () => {
    const pb = makePlaybook([{ specRole: "IDENTITY", domain: "voice", name: "Voice Identity", config: {} }]);
    const result = resolveSpecs([pb], []);
    expect(result.voiceSpec).not.toBeNull();
    expect(result.voiceSpec!.name).toBe("Voice Identity");
    // Should NOT be picked as identitySpec (domain=voice excludes it)
    expect(result.identitySpec).toBeNull();
  });

  it("first playbook wins on conflicts", () => {
    const pb1 = makePlaybook([{ specRole: "IDENTITY", name: "First" }]);
    const pb2 = makePlaybook([{ specRole: "IDENTITY", name: "Second" }]);
    const result = resolveSpecs([pb1, pb2], []);
    expect(result.identitySpec!.name).toBe("First");
  });

  it("falls back to system specs when playbook has no match", () => {
    const systemSpec: SystemSpecData = {
      id: "sys-1",
      slug: "TUT-001",
      name: "System Tutor",
      description: "Fallback tutor",
      specRole: "IDENTITY",
      outputType: "PROMPT",
      config: { fallback: true },
      domain: null,
    };
    const result = resolveSpecs([], [systemSpec]);
    expect(result.identitySpec).not.toBeNull();
    expect(result.identitySpec!.name).toBe("System Tutor");
  });

  it("playbook spec takes priority over system spec", () => {
    const pb = makePlaybook([{ specRole: "IDENTITY", name: "Playbook Tutor" }]);
    const systemSpec: SystemSpecData = {
      id: "sys-1",
      slug: "TUT-001",
      name: "System Tutor",
      description: null,
      specRole: "IDENTITY",
      outputType: "PROMPT",
      config: {},
      domain: null,
    };
    const result = resolveSpecs([pb], [systemSpec]);
    expect(result.identitySpec!.name).toBe("Playbook Tutor");
  });

  it("resolves identity and voice from one playbook (content removed ADR-002)", () => {
    const pb = makePlaybook([
      { specRole: "IDENTITY", name: "Tutor", domain: null },
      { specRole: "CONTENT", name: "Curriculum" },
      { specRole: "VOICE", name: "Voice" },
    ]);
    const result = resolveSpecs([pb], []);
    expect(result.identitySpec!.name).toBe("Tutor");
    expect(result.voiceSpec!.name).toBe("Voice");
  });
});

// =====================================================
// resolveVoiceSpecFallback() — async, uses prisma
// =====================================================

describe("resolveVoiceSpecFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unchanged specs when voiceSpec already resolved", async () => {
    const specs: ResolvedSpecs = {
      identitySpec: null,
      voiceSpec: { name: "Existing Voice", config: {}, description: null },
    };
    const result = await resolveVoiceSpecFallback(specs);
    expect(result.voiceSpec!.name).toBe("Existing Voice");
  });

  it("loads voice spec from DB when not resolved", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "DB Voice Spec",
      config: { pace: "moderate" },
      description: "From database",
    });

    const specs: ResolvedSpecs = { identitySpec: null, voiceSpec: null };
    const result = await resolveVoiceSpecFallback(specs);

    expect(result.voiceSpec).not.toBeNull();
    expect(result.voiceSpec!.name).toBe("DB Voice Spec");
    expect(mockPrisma.analysisSpec.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          specRole: "IDENTITY",
          domain: "voice",
          isActive: true,
        }),
      })
    );
  });

  it("returns null voiceSpec when DB has no match", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const specs: ResolvedSpecs = { identitySpec: null, voiceSpec: null };
    const result = await resolveVoiceSpecFallback(specs);
    expect(result.voiceSpec).toBeNull();
  });
});

// =====================================================
// extractIdentitySpec transform
// =====================================================

describe("extractIdentitySpec transform", () => {
  it("is registered", () => {
    expect(getTransform("extractIdentitySpec")).toBeDefined();
  });

  it("returns null when no identity spec", () => {
    const ctx = makeContext();
    const result = getTransform("extractIdentitySpec")!(null, ctx, makeSectionDef());
    expect(result).toBeNull();
  });

  it("extracts core fields from identity spec", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: {
          name: "QM Tutor",
          config: {
            roleStatement: "A qualified tutor",
            primaryGoal: "Help learners",
            techniques: [{ name: "Socratic", description: "Ask questions", when: "Always" }],
            does: ["teach"],
            doesNot: ["judge"],
          },
          description: "Quality Management tutor",
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("extractIdentitySpec")!(null, ctx, makeSectionDef());

    expect(result.specName).toBe("QM Tutor");
    expect(result.role).toBe("A qualified tutor");
    expect(result.primaryGoal).toBe("Help learners");
    expect(result.techniques).toHaveLength(1);
    expect(result.techniques[0].name).toBe("Socratic");
    expect(result.boundaries.does).toEqual(["teach"]);
    expect(result.boundaries.doesNot).toEqual(["judge"]);
  });

  it("renames generic spec when caller has domain", () => {
    const ctx = makeContext({
      loadedData: {
        ...makeContext().loadedData,
        caller: {
          id: "c1", name: "Paul", email: null, phone: null, externalId: null,
          domain: { id: "d1", slug: "qm", name: "Quality Management", description: null },
        },
      },
      resolvedSpecs: {
        identitySpec: { name: "Generic Tutor", config: {}, description: null },
        voiceSpec: null,
      },
    });

    const result = getTransform("extractIdentitySpec")!(null, ctx, makeSectionDef());
    expect(result.specName).toBe("Quality Management Tutor Identity");
  });

  it("extracts session structure when present", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: {
          name: "Tutor",
          config: {
            opening: { instruction: "Welcome!" },
            main: { focus: "teach" },
            closing: { summary: true },
          },
          description: null,
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("extractIdentitySpec")!(null, ctx, makeSectionDef());
    expect(result.sessionStructure).not.toBeNull();
    expect(result.sessionStructure.opening.instruction).toBe("Welcome!");
  });
});

// =====================================================
// mergeIdentitySpec() — async, merges base + overlay
// =====================================================

describe("mergeIdentitySpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns spec unchanged when no extendsAgent", async () => {
    const spec = { name: "Standalone", config: { roleStatement: "I teach" }, description: null };
    const result = await mergeIdentitySpec(spec);
    expect(result).toBe(spec); // Same reference, no merge
  });

  it("returns overlay as-is when base spec not found", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const overlay = {
      name: "QM Overlay",
      slug: "spec-tut-qm-001",
      config: { parameters: [{ id: "core_identity", config: { roleStatement: "QM tutor" } }] },
      description: "QM specific",
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);
    expect(result.name).toBe("QM Overlay");
    expect(result.config.parameters).toHaveLength(1);
  });

  it("merges base params with overlay — overlay replaces by id", async () => {
    // Base has 3 params: tutor_role, boundaries, interaction_style
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "Generic Tutor",
      slug: "spec-tut-001",
      config: {
        parameters: [
          { id: "tutor_role", config: { roleStatement: "Generic tutor" } },
          { id: "boundaries", config: { does: ["teach"], doesNot: ["judge"] } },
          { id: "interaction_style", config: { defaults: { warmth: 0.7 } } },
        ],
      },
      description: "Base tutor",
    });

    // Overlay replaces tutor_role and adds a new param
    const overlay = {
      name: "QM Tutor",
      slug: "spec-tut-qm-001",
      config: {
        parameters: [
          { id: "tutor_role", config: { roleStatement: "QM tutor specialist" } },
          { id: "math_guidance", config: { approach: "phenomena first" } },
        ],
      },
      description: "QM specific",
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);

    // Should have 4 params: tutor_role (replaced), boundaries (inherited), interaction_style (inherited), math_guidance (added)
    expect(result.config.parameters).toHaveLength(4);

    const paramIds = result.config.parameters.map((p: any) => p.id);
    expect(paramIds).toContain("tutor_role");
    expect(paramIds).toContain("boundaries");
    expect(paramIds).toContain("interaction_style");
    expect(paramIds).toContain("math_guidance");

    // tutor_role should be the overlay version
    const tutorRole = result.config.parameters.find((p: any) => p.id === "tutor_role");
    expect(tutorRole.config.roleStatement).toBe("QM tutor specialist");

    // boundaries should be inherited from base
    const boundaries = result.config.parameters.find((p: any) => p.id === "boundaries");
    expect(boundaries.config.does).toEqual(["teach"]);
  });

  it("flattens param configs into top-level config", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "Generic Tutor",
      slug: "spec-tut-001",
      config: {
        parameters: [
          { id: "boundaries", config: { does: ["teach"], doesNot: ["judge"] } },
        ],
      },
      description: "Base",
    });

    const overlay = {
      name: "QM",
      slug: "spec-tut-qm-001",
      config: {
        parameters: [
          { id: "core_identity", config: { roleStatement: "QM tutor" } },
        ],
      },
      description: null,
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);

    // Flattened keys should be accessible at top level
    expect(result.config.roleStatement).toBe("QM tutor"); // From overlay
    expect(result.config.does).toEqual(["teach"]); // From base
    expect(result.config.doesNot).toEqual(["judge"]); // From base
  });

  it("stacks constraints from base and overlay", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "Generic Tutor",
      slug: "spec-tut-001",
      config: {
        parameters: [],
        constraints: [
          { rule: "Never make learner feel stupid", severity: "CRITICAL" },
        ],
      },
      description: "Base",
    });

    const overlay = {
      name: "QM",
      slug: "spec-tut-qm-001",
      config: {
        parameters: [],
        constraints: [
          { rule: "Never skip mathematical proofs", severity: "WARNING" },
        ],
      },
      description: null,
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);
    expect(result.config.constraints).toHaveLength(2);
    expect(result.config.constraints[0].rule).toBe("Never make learner feel stupid");
    expect(result.config.constraints[1].rule).toBe("Never skip mathematical proofs");
  });

  it("keeps overlay name and slug", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "Generic Tutor",
      slug: "spec-tut-001",
      config: { parameters: [] },
      description: "Base",
    });

    const overlay = {
      name: "Quantum Mechanics Tutor",
      slug: "spec-tut-qm-001",
      config: { parameters: [] },
      description: "QM overlay",
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);
    expect(result.name).toBe("Quantum Mechanics Tutor");
    expect(result.slug).toBe("spec-tut-qm-001");
    expect(result.description).toBe("QM overlay");
  });

  it("uses base description when overlay has none", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValue({
      name: "Generic Tutor",
      slug: "spec-tut-001",
      config: { parameters: [] },
      description: "Base tutor description",
    });

    const overlay = {
      name: "QM Tutor",
      slug: "spec-tut-qm-001",
      config: { parameters: [] },
      description: null,
      extendsAgent: "TUT-001",
    };

    const result = await mergeIdentitySpec(overlay);
    expect(result.description).toBe("Base tutor description");
  });

  it("resolveSpecs carries slug and extendsAgent from playbook", () => {
    const pb = makePlaybook([{
      specRole: "IDENTITY",
      name: "QM Overlay",
      slug: "spec-tut-qm-001",
      config: { roleStatement: "QM tutor" },
      extendsAgent: "TUT-001",
    } as any]);
    const result = resolveSpecs([pb], []);
    expect(result.identitySpec!.slug).toBe("spec-tut-qm-001");
    expect(result.identitySpec!.extendsAgent).toBe("TUT-001");
  });

  it("resolveSpecs carries extendsAgent from system specs", () => {
    const systemSpec: SystemSpecData = {
      id: "sys-1",
      slug: "spec-tut-qm-001",
      name: "QM Tutor System",
      description: null,
      specRole: "IDENTITY",
      outputType: "COMPOSE",
      config: {},
      domain: null,
      extendsAgent: "TUT-001",
    };
    const result = resolveSpecs([], [systemSpec]);
    expect(result.identitySpec!.extendsAgent).toBe("TUT-001");
  });
});

// =====================================================
// extractContentSpec transform
// =====================================================

// extractContentSpec transform removed — Content Spec consolidated (ADR-002)
