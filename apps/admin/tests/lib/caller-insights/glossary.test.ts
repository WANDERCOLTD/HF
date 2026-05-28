import { describe, it, expect } from "vitest";
import {
  STATIC_GLOSSARY,
  lookupGlossary,
} from "@/lib/caller-insights/glossary";

describe("STATIC_GLOSSARY", () => {
  it("includes core non-parameter terms", () => {
    expect(STATIC_GLOSSARY).toHaveProperty("mastery");
    expect(STATIC_GLOSSARY).toHaveProperty("confidence");
    expect(STATIC_GLOSSARY).toHaveProperty("knowledge");
    expect(STATIC_GLOSSARY).toHaveProperty("momentum");
    expect(STATIC_GLOSSARY).toHaveProperty("streak");
    expect(STATIC_GLOSSARY).toHaveProperty("memories");
  });

  it("includes goal-type entries", () => {
    expect(STATIC_GLOSSARY).toHaveProperty("goal-mastery");
    expect(STATIC_GLOSSARY).toHaveProperty("goal-recency");
    expect(STATIC_GLOSSARY).toHaveProperty("goal-frequency");
  });

  it("every entry has a non-empty definition", () => {
    for (const [key, entry] of Object.entries(STATIC_GLOSSARY)) {
      expect(entry.label, `entry ${key} label`).toBeTruthy();
      expect(entry.definition, `entry ${key} definition`).toBeTruthy();
    }
  });
});

describe("lookupGlossary", () => {
  it("returns undefined for null / undefined / unknown keys", () => {
    expect(lookupGlossary(STATIC_GLOSSARY, null)).toBeUndefined();
    expect(lookupGlossary(STATIC_GLOSSARY, undefined)).toBeUndefined();
    expect(lookupGlossary(STATIC_GLOSSARY, "unknown-key")).toBeUndefined();
  });

  it("matches exact keys", () => {
    expect(lookupGlossary(STATIC_GLOSSARY, "mastery")?.label).toBe("Mastery");
  });

  it("is case-insensitive", () => {
    expect(lookupGlossary(STATIC_GLOSSARY, "MASTERY")?.label).toBe("Mastery");
    expect(lookupGlossary(STATIC_GLOSSARY, "Mastery")?.label).toBe("Mastery");
  });

  it("matches a label with spaces", () => {
    expect(lookupGlossary(STATIC_GLOSSARY, "Calls Per Week")?.label).toBe(
      "Calls per week",
    );
  });
});
