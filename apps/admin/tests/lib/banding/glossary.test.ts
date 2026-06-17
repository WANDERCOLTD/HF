/**
 * Tests for `lib/banding/glossary.ts` — the acronym lookup behind
 * `components/shared/Acronym.tsx`.
 *
 * Pins the two non-obvious behaviours of `lookupAcronym`:
 *
 *   1. Literal keys resolve directly (IELTS criteria, banding tiers).
 *   2. The `OUT-NN` / `SKILL-NN` ref shapes are resolved by REGEX, not by
 *      literal key — `OUT-01` must map onto the shared `OUT-NN` definition,
 *      case-insensitively, while a bare unknown key returns undefined.
 *
 * The regex branch is the load-bearing bit: a consumer passing a concrete
 * ref ("SKILL-03") must get the family tooltip, not a miss.
 */

import { describe, it, expect } from "vitest";
import { lookupAcronym, ACRONYM_GLOSSARY } from "@/lib/banding/glossary";

describe("lookupAcronym — literal keys", () => {
  it("resolves IELTS Speaking criteria short-codes", () => {
    expect(lookupAcronym("FC")?.full).toBe("Fluency & Coherence");
    expect(lookupAcronym("LR")?.full).toBe("Lexical Resource");
    expect(lookupAcronym("GRA")?.full).toBe("Grammatical Range & Accuracy");
    expect(lookupAcronym("P")?.full).toBe("Pronunciation");
  });

  it("resolves banding tier names", () => {
    expect(lookupAcronym("Emerging")).toBeDefined();
    expect(lookupAcronym("Secure")?.full).toBe("Secure tier");
  });
});

describe("lookupAcronym — ref-shape regex branch", () => {
  it("maps a concrete OUT-NN ref onto the shared definition", () => {
    const concrete = lookupAcronym("OUT-01");
    expect(concrete).toBeDefined();
    expect(concrete).toBe(ACRONYM_GLOSSARY["OUT-NN"]);
  });

  it("maps a concrete SKILL-NN ref onto the shared definition", () => {
    const concrete = lookupAcronym("SKILL-03");
    expect(concrete).toBe(ACRONYM_GLOSSARY["SKILL-NN"]);
  });

  it("matches the ref shape case-insensitively", () => {
    expect(lookupAcronym("out-7")).toBe(ACRONYM_GLOSSARY["OUT-NN"]);
    expect(lookupAcronym("skill-12")).toBe(ACRONYM_GLOSSARY["SKILL-NN"]);
  });

  it("does not match a ref shape with no numeric suffix", () => {
    expect(lookupAcronym("OUT-")).toBeUndefined();
    expect(lookupAcronym("SKILL")).toBeUndefined();
  });
});

describe("lookupAcronym — misses", () => {
  it("returns undefined for an unknown key", () => {
    expect(lookupAcronym("ZZZ")).toBeUndefined();
  });

  it("returns undefined for an empty key without throwing", () => {
    expect(lookupAcronym("")).toBeUndefined();
  });
});
