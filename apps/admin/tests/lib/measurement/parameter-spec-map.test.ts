/**
 * Pins the parameter -> spec lineage map (#1539).
 *
 * Distinguishes the structural fix from the existing
 * `batchLoadParameters`: this loader KEEPS the spec id, slug, and
 * promptTemplate so downstream writers can stamp `analysisSpecId`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    parameter: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import { buildParameterSpecMap } from "@/lib/measurement/parameter-spec-map";

const mockedFindMany = prisma.parameter.findMany as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockedFindMany.mockReset();
});

function makeSpec(
  id: string,
  slug: string,
  paramId: string,
  opts: {
    priority?: number;
    promptTemplate?: string | null;
  } = {},
) {
  return {
    id,
    slug,
    name: slug,
    description: null,
    scope: "DOMAIN" as const,
    outputType: "MEASURE" as const,
    specType: "DOMAIN" as const,
    specRole: "EXTRACT" as const,
    domain: null,
    priority: opts.priority ?? 0,
    isActive: true,
    extendsAgent: null,
    promptTemplate: opts.promptTemplate ?? null,
    config: {} as never,
    createdAt: new Date(),
    updatedAt: new Date(),
    triggers: [
      {
        id: `${id}-trigger`,
        specId: id,
        type: "every_call" as const,
        config: {} as never,
        createdAt: new Date(),
        updatedAt: new Date(),
        actions: [
          {
            id: `${id}-action`,
            triggerId: `${id}-trigger`,
            parameterId: paramId,
            description: "score this",
            learnCategory: null,
            learnKeyPrefix: null,
            learnKeyHint: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ],
  } as never;
}

describe("buildParameterSpecMap", () => {
  it("returns a parameter row with full spec lineage", async () => {
    mockedFindMany.mockResolvedValueOnce([
      {
        parameterId: "IELTS-FLUENCY",
        name: "Fluency and Coherence",
        definition: "How smoothly the learner speaks.",
      },
    ]);
    const specs = [
      makeSpec("spec-1", "IELTS-FLUENCY-MEASURE-001", "IELTS-FLUENCY", {
        promptTemplate: "Score on IELTS Band 1-9 ...",
      }),
    ];

    const map = await buildParameterSpecMap(specs);

    expect(map.size).toBe(1);
    const row = map.get("IELTS-FLUENCY");
    expect(row).toEqual({
      parameterId: "IELTS-FLUENCY",
      name: "Fluency and Coherence",
      definition: "How smoothly the learner speaks.",
      analysisSpecId: "spec-1",
      specSlug: "IELTS-FLUENCY-MEASURE-001",
      promptTemplate: "Score on IELTS Band 1-9 ...",
      specPriority: 0,
    });
  });

  it("preserves null promptTemplate (legacy / under-specced spec)", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { parameterId: "PERS-OPEN", name: "Openness", definition: null },
    ]);
    const specs = [
      makeSpec("spec-pers", "PERS-001", "PERS-OPEN", { promptTemplate: null }),
    ];
    const map = await buildParameterSpecMap(specs);
    expect(map.get("PERS-OPEN")!.promptTemplate).toBeNull();
  });

  it("prefers the highest-priority spec on collision and logs a warning", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { parameterId: "IELTS-FLUENCY", name: "Fluency", definition: null },
    ]);
    const log = vi.fn();
    const specs = [
      makeSpec("spec-low", "GENERIC-FLUENCY", "IELTS-FLUENCY", { priority: 10 }),
      makeSpec("spec-high", "IELTS-FLUENCY-MEASURE-001", "IELTS-FLUENCY", {
        priority: 100,
        promptTemplate: "IELTS bands",
      }),
    ];
    const map = await buildParameterSpecMap(specs, { log });

    expect(map.get("IELTS-FLUENCY")!.analysisSpecId).toBe("spec-high");
    expect(map.get("IELTS-FLUENCY")!.promptTemplate).toBe("IELTS bands");
    expect(log).toHaveBeenCalledOnce();
    const [msg, meta] = log.mock.calls[0]!;
    expect(msg).toContain("collisions");
    expect(meta).toEqual({
      collisions: [
        {
          parameterId: "IELTS-FLUENCY",
          specSlugs: ["GENERIC-FLUENCY", "IELTS-FLUENCY-MEASURE-001"],
        },
      ],
    });
  });

  it("returns an empty map when no specs produce parameters", async () => {
    const specs: never[] = [];
    const map = await buildParameterSpecMap(specs);
    expect(map.size).toBe(0);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("omits parameters whose owning spec is missing rather than emitting partial rows", async () => {
    // parameter row exists but the spec list is empty — should not appear.
    mockedFindMany.mockResolvedValueOnce([
      { parameterId: "PHANTOM", name: "Phantom", definition: null },
    ]);
    const map = await buildParameterSpecMap([]);
    expect(map.size).toBe(0);
  });
});
