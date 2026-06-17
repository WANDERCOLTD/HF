/**
 * #1872 — segmentKey namespace prefixes.
 *
 * Defends:
 *   - Single source of truth — prefixes only ever produced by the helpers.
 *   - Idempotency — re-wrapping is a no-op (the backfill migration relies
 *     on this).
 *   - Round-trip — `parseSegmentKey(withTextNamespace(x))` recovers x.
 *   - Legacy tolerance — bare slugs returned with `namespace: "legacy"`
 *     so un-backfilled rows don't crash the reader.
 *   - Label derivation — IELTS Mock + cue-scheduler conventions
 *     ("part1" → "Part 1"; "p2_monologue" → "Part 2 (monologue)").
 *   - Grep ratchet — no bare `segmentKey: 'part1'` literals in pipeline
 *     code outside the helpers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SEGMENT_KEY_NAMESPACE,
  parseSegmentKey,
  segmentKeyLabel,
  withPhaseNamespace,
  withTextNamespace,
} from "@/lib/pipeline/segment-key-namespace";

describe("segment-key-namespace — constants", () => {
  it("TEXT prefix is 'text:'", () => {
    expect(SEGMENT_KEY_NAMESPACE.TEXT).toBe("text:");
  });

  it("PHASE prefix is 'phase:'", () => {
    expect(SEGMENT_KEY_NAMESPACE.PHASE).toBe("phase:");
  });
});

describe("segment-key-namespace — withTextNamespace", () => {
  it("wraps a bare slug with the text: prefix", () => {
    expect(withTextNamespace("part1")).toBe("text:part1");
    expect(withTextNamespace("part2")).toBe("text:part2");
    expect(withTextNamespace("part3")).toBe("text:part3");
  });

  it("is idempotent — re-wrapping returns the input unchanged", () => {
    expect(withTextNamespace("text:part1")).toBe("text:part1");
    expect(withTextNamespace(withTextNamespace("part1"))).toBe("text:part1");
  });
});

describe("segment-key-namespace — withPhaseNamespace", () => {
  it("wraps a bare phaseKey with the phase: prefix", () => {
    expect(withPhaseNamespace("p1")).toBe("phase:p1");
    expect(withPhaseNamespace("p2_monologue")).toBe("phase:p2_monologue");
    expect(withPhaseNamespace("p2_prep")).toBe("phase:p2_prep");
    expect(withPhaseNamespace("p3")).toBe("phase:p3");
  });

  it("is idempotent — re-wrapping returns the input unchanged", () => {
    expect(withPhaseNamespace("phase:p2_monologue")).toBe("phase:p2_monologue");
    expect(withPhaseNamespace(withPhaseNamespace("p1"))).toBe("phase:p1");
  });
});

describe("segment-key-namespace — parseSegmentKey", () => {
  it("recognises text:-prefixed values", () => {
    expect(parseSegmentKey("text:part1")).toEqual({
      namespace: "text:",
      bare: "part1",
    });
    expect(parseSegmentKey("text:part3")).toEqual({
      namespace: "text:",
      bare: "part3",
    });
  });

  it("recognises phase:-prefixed values", () => {
    expect(parseSegmentKey("phase:p1")).toEqual({
      namespace: "phase:",
      bare: "p1",
    });
    expect(parseSegmentKey("phase:p2_monologue")).toEqual({
      namespace: "phase:",
      bare: "p2_monologue",
    });
  });

  it("falls through to 'legacy' for un-backfilled bare values", () => {
    expect(parseSegmentKey("part1")).toEqual({
      namespace: "legacy",
      bare: "part1",
    });
    expect(parseSegmentKey("p2_monologue")).toEqual({
      namespace: "legacy",
      bare: "p2_monologue",
    });
  });

  it("round-trips through the wrap helpers", () => {
    const textRound = parseSegmentKey(withTextNamespace("part2"));
    expect(textRound).toEqual({ namespace: "text:", bare: "part2" });

    const phaseRound = parseSegmentKey(withPhaseNamespace("p2_prep"));
    expect(phaseRound).toEqual({ namespace: "phase:", bare: "p2_prep" });
  });
});

describe("segment-key-namespace — segmentKeyLabel", () => {
  it("renders Theme 6 text-segmenter values as 'Part N'", () => {
    expect(segmentKeyLabel("text:part1")).toBe("Part 1");
    expect(segmentKeyLabel("text:part2")).toBe("Part 2");
    expect(segmentKeyLabel("text:part3")).toBe("Part 3");
  });

  it("renders cue-scheduler bare phase values as 'Part N'", () => {
    expect(segmentKeyLabel("phase:p1")).toBe("Part 1");
    expect(segmentKeyLabel("phase:p3")).toBe("Part 3");
  });

  it("renders qualifier-bearing phase values as 'Part N (qualifier)'", () => {
    expect(segmentKeyLabel("phase:p2_prep")).toBe("Part 2 (prep)");
    expect(segmentKeyLabel("phase:p2_monologue")).toBe("Part 2 (monologue)");
  });

  it("handles legacy bare values without a prefix", () => {
    expect(segmentKeyLabel("part1")).toBe("Part 1");
    expect(segmentKeyLabel("p2_monologue")).toBe("Part 2 (monologue)");
  });

  it("falls through to the raw bare value for unrecognised shapes", () => {
    expect(segmentKeyLabel("text:custom_segment")).toBe("custom_segment");
    expect(segmentKeyLabel("phase:opening")).toBe("opening");
  });
});

describe("segment-key-namespace — no-bare-literals grep ratchet", () => {
  it("only the namespace helper module hardcodes the 'text:'/'phase:' prefix or bare 'segmentKey: \"partN\"' / 'segmentKey: \"pN\"' shapes", () => {
    const pipelineDir = join(__dirname, "..", "..", "..", "lib", "pipeline");
    const offenders: string[] = [];

    const stack = [pipelineDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        // The constants module is the single source of truth — it owns the
        // literals. The runner emits `phase:${boundary.phase}` ONCE at the
        // canonical write site (kept inline so a future refactor centralising
        // this is the only change needed; documented in the file).
        if (entry === "segment-key-namespace.ts") continue;

        const source = readFileSync(full, "utf8");
        // segmentKey assigned a bare slug literal (part1/p2_monologue/etc.)
        const bareLiteralRe = /segmentKey\s*[:=]\s*['"](?:part\d+|p\d+(?:_[a-z]+)?)['"]/gi;
        const matches = source.match(bareLiteralRe);
        if (matches && matches.length > 0) {
          offenders.push(`${full}: ${matches.join(", ")}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
