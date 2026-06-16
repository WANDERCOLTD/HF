/**
 * Round-trip pin for #1700 Theme 6 / story #1702.
 *
 * Exercises the contract the per-part Mock scorer
 * (`route.ts::runPerSegmentScoring`) relies on: a Mock-shaped transcript →
 * real heuristic segmentation (`segmentMockTranscript`) → one
 * `writeCallScore` per (segment × criterion), each carrying the segment slug
 * as `segmentKey`. The route's own AI scoring is not exercised here (that
 * needs a live engine); this pins the segmentation → writer hand-off, which
 * is the surface #1702 changes.
 *
 * Asserts:
 *   - 12 CallScore writes (4 IELTS criteria × 3 parts) for a Mock call, each
 *     stamped with the correct segmentKey ("part1" / "part2" / "part3").
 *   - A non-Mock (single-segment) write carries no segmentKey → null default.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callScore: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { writeCallScore } from "@/lib/measurement/write-call-score";
import { segmentMockTranscript } from "@/lib/curriculum/segment-mock-transcript";

const mockedFindFirst = prisma.callScore.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.callScore.create as unknown as ReturnType<typeof vi.fn>;

const IELTS_CRITERIA = [
  "skill_fluency_and_coherence_fc",
  "skill_pronunciation_p",
  "skill_lexical_resource_lr",
  "skill_grammatical_range_and_accuracy_gra",
];

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
}

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedCreate.mockReset();
  mockedFindFirst.mockResolvedValue(null);
  mockedCreate.mockResolvedValue({ id: "score-new" });
});

describe("per-part segmentKey round-trip (#1702)", () => {
  it("writes 12 rows (4 criteria × 3 parts), each stamped with its segment slug", async () => {
    const transcript = [
      "Assistant: Hi! Let's start with Part 1. Tell me about where you live.",
      "User: I live in Warsaw, Poland.",
      "Assistant: Now let's move to Part 2. Here's your cue card. You should say:",
      "User: I want to talk about my morning routine...",
      "Assistant: Now we'll discuss this topic more broadly. What do people think about routines?",
      "User: Most people prefer fixed schedules.",
    ].join("\n\n");

    // #1785 — segmenter is course-agnostic; production pipeline reads cues
    // from `CurriculumModule.segmentCues`. This test mirrors the IELTS seed
    // so the heuristic path matches part1/part2/part3 deterministically.
    const IELTS_CUES: Record<string, string[]> = {
      part1: [
        "\\b(let'?s\\s+(?:start|begin)\\s+with\\s+part\\s*1|part\\s*1\\s*\\.\\s*[A-Z]|now\\s+(?:in|for)\\s+part\\s*1|i'?ll?\\s+ask\\s+you\\s+some\\s+(?:general|familiar)\\s+questions)",
      ],
      part2: [
        "\\b(now\\s+(?:let'?s\\s+)?(?:move\\s+(?:on\\s+)?to|move\\s+into|turn\\s+to|go\\s+to)\\s+part\\s*2|let'?s\\s+(?:start|begin)\\s+part\\s*2|here'?s?\\s+your\\s+(?:cue\\s+card|topic\\s+card)|i'?ll?\\s+(?:now\\s+)?(?:give|hand)\\s+you\\s+(?:a|your)\\s+(?:cue|topic)\\s+card|you'?ll?\\s+have\\s+(?:one\\s+minute|1\\s+minute)\\s+to\\s+prepare|describe\\s+a\\s+[a-z]+\\s+(?:you|that)|you\\s+should\\s+say)",
      ],
      part3: [
        "\\b(now\\s+(?:let'?s\\s+)?(?:move\\s+(?:on\\s+)?to|move\\s+into|turn\\s+to|go\\s+to)\\s+part\\s*3|let'?s\\s+(?:start|begin)\\s+part\\s*3|i'?d?\\s+like\\s+to\\s+(?:discuss|talk\\s+about)\\s+(?:some\\s+)?(?:more\\s+)?(?:general|abstract|broader)|let'?s\\s+(?:now\\s+)?(?:discuss|talk\\s+about)\\s+(?:this|the\\s+topic)\\s+more\\s+(?:broadly|generally|abstractly)|now\\s+we'?ll?\\s+discuss|now\\s+(?:i'?d?\\s+like\\s+to\\s+)?(?:explore|consider)\\s+(?:some\\s+)?broader)",
      ],
    };

    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      slugToCues: IELTS_CUES,
      engine: "claude",
      log: makeLog(),
    });
    expect(segments.map((s) => s.slug)).toEqual(["part1", "part2", "part3"]);

    // Mirror the route's per-(segment × criterion) write loop.
    const slugToModuleId: Record<string, string> = {
      part1: "mod-part1",
      part2: "mod-part2",
      part3: "mod-part3",
    };
    for (const segment of segments) {
      for (const parameterId of IELTS_CRITERIA) {
        await writeCallScore({
          callId: "call-mock-1",
          callerId: "caller-1",
          parameterId,
          analysisSpecId: "spec-ielts",
          moduleId: slugToModuleId[segment.slug],
          segmentKey: segment.slug,
          score: 0.7,
          confidence: 0.8,
          evidence: [`Segment: ${segment.slug}`],
        });
      }
    }

    expect(mockedCreate).toHaveBeenCalledTimes(12);

    // Tally segmentKey distribution across the 12 writes.
    const byKey: Record<string, number> = {};
    for (const call of mockedCreate.mock.calls) {
      const key = call[0].data.segmentKey as string;
      byKey[key] = (byKey[key] ?? 0) + 1;
    }
    expect(byKey).toEqual({ part1: 4, part2: 4, part3: 4 });

    // Every row's moduleId matches its segmentKey's module.
    for (const call of mockedCreate.mock.calls) {
      const { segmentKey, moduleId } = call[0].data;
      expect(moduleId).toBe(slugToModuleId[segmentKey]);
    }
  });

  it("non-Mock (single-segment) write carries no segmentKey → null default", async () => {
    await writeCallScore({
      callId: "call-assessment-1",
      callerId: "caller-1",
      parameterId: "skill_fluency_and_coherence_fc",
      analysisSpecId: "spec-ielts",
      moduleId: "mod-assessment",
      score: 0.6,
      confidence: 0.8,
      evidence: ["AI batched analysis"],
    });

    expect(mockedCreate).toHaveBeenCalledOnce();
    expect("segmentKey" in mockedCreate.mock.calls[0]![0].data).toBe(false);
  });
});
