/**
 * Tests for `buildComposeTrace::sectionsAffectedByKey` — #1556 (S1 of EPIC #1555).
 *
 * Covers:
 *  - Trace includes `sectionsAffectedByKey` field
 *  - Field is a Record<string, ComposeSectionKey>
 *  - Field contains entries for keys from all three affecting-keys lists
 *  - All values are valid ComposeSectionKey members
 *  - Map is a structural merge of the three key→section maps
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { mediaAsset: { findMany: vi.fn().mockResolvedValue([]) } },
}));

vi.mock("@/lib/config", () => ({
  config: { specs: { onboarding: "ONBOARDING-001" } },
}));

import { buildComposeTrace } from "@/lib/prompt/composition/buildComposeTrace";
import type {
  LoadedDataContext,
  ResolvedSpecs,
} from "@/lib/prompt/composition/types";
import {
  COMPOSE_SECTION_KEYS,
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS,
  COMPOSE_AFFECTING_DOMAIN_FIELDS,
  COMPOSE_AFFECTING_SPEC_FIELDS,
} from "@/lib/compose";

// Cast through `unknown` rather than `any` — the trace builder reads a small
// subset of LoadedDataContext fields, so a partial fixture covers the
// observable shape without spelling out every field on the type.
function minimalLoadedData(): LoadedDataContext {
  return {
    memories: [],
    personality: null,
    learnerProfile: null,
    recentCalls: [],
    behaviorTargets: [],
    callerTargets: [],
    callerAttributes: [],
    goals: [],
    playbooks: [],
    systemSpecs: [],
    subjectSources: { subjects: [] },
    curriculumAssertions: [],
    curriculumQuestions: [],
    curriculumVocabulary: [],
    courseInstructions: [],
    openActions: [],
    visualAids: [],
    caller: null,
    onboardingSpec: null,
  } as unknown as LoadedDataContext;
}

function minimalResolvedSpecs(): ResolvedSpecs {
  return {} as ResolvedSpecs;
}

describe("buildComposeTrace::sectionsAffectedByKey — #1556", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits sectionsAffectedByKey field in the trace", async () => {
    const trace = await buildComposeTrace(
      {
        loadedData: minimalLoadedData(),
        resolvedSpecs: minimalResolvedSpecs(),
        sectionsActivated: [],
        sectionsSkipped: [],
      },
      { lookupMediaSources: false },
    );

    expect(trace.sectionsAffectedByKey).toBeDefined();
    expect(typeof trace.sectionsAffectedByKey).toBe("object");
  });

  it("includes entries for every key in the three affecting-keys lists", async () => {
    const trace = await buildComposeTrace(
      {
        loadedData: minimalLoadedData(),
        resolvedSpecs: minimalResolvedSpecs(),
        sectionsActivated: [],
        sectionsSkipped: [],
      },
      { lookupMediaSources: false },
    );

    for (const key of COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS) {
      expect(trace.sectionsAffectedByKey[key]).toBeDefined();
    }
    for (const key of COMPOSE_AFFECTING_DOMAIN_FIELDS) {
      expect(trace.sectionsAffectedByKey[key]).toBeDefined();
    }
    for (const key of COMPOSE_AFFECTING_SPEC_FIELDS) {
      expect(trace.sectionsAffectedByKey[key]).toBeDefined();
    }
  });

  it("section values are all valid ComposeSectionKey members", async () => {
    const trace = await buildComposeTrace(
      {
        loadedData: minimalLoadedData(),
        resolvedSpecs: minimalResolvedSpecs(),
        sectionsActivated: [],
        sectionsSkipped: [],
      },
      { lookupMediaSources: false },
    );

    const validSections = new Set<string>(COMPOSE_SECTION_KEYS);
    for (const section of Object.values(trace.sectionsAffectedByKey)) {
      expect(validSections.has(section)).toBe(true);
    }
  });

  it("trace shape preserves existing fields (no regression)", async () => {
    const trace = await buildComposeTrace(
      {
        loadedData: minimalLoadedData(),
        resolvedSpecs: minimalResolvedSpecs(),
        sectionsActivated: ["welcome", "onboarding"],
        sectionsSkipped: ["nps"],
      },
      { lookupMediaSources: false },
    );

    expect(trace.loadersFired).toBeDefined();
    expect(trace.loadersEmpty).toBeDefined();
    expect(trace.assertionsExcluded).toBeDefined();
    expect(trace.mediaPalette).toBeDefined();
    expect(trace.sectionsActivatedCount).toBe(2);
    expect(trace.sectionsSkippedCount).toBe(1);
  });
});
