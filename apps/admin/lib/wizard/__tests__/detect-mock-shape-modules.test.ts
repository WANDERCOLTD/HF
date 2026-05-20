import { describe, it, expect } from "vitest";
import {
  detectMockShapeCovers,
  resolveCoversModulesForSlug,
} from "@/lib/wizard/detect-mock-shape-modules";

describe("resolveCoversModulesForSlug", () => {
  it("returns part1/part2/part3 for a 'mock' module when all parts are siblings", () => {
    const slugs = ["part1", "part2", "part3", "mock"];
    expect(resolveCoversModulesForSlug("mock", slugs)).toEqual(["part1", "part2", "part3"]);
  });

  it("accepts mock-shape slug aliases", () => {
    const slugs = ["part1", "part2", "part3", "full-mock"];
    expect(resolveCoversModulesForSlug("full-mock", slugs)).toEqual(["part1", "part2", "part3"]);
  });

  it("returns undefined when the slug is not a mock-shape", () => {
    const slugs = ["part1", "part2", "part3", "mock"];
    expect(resolveCoversModulesForSlug("part2", slugs)).toBeUndefined();
  });

  it("returns undefined when a required part sibling is missing", () => {
    const slugs = ["part1", "part2", "mock"]; // part3 absent
    expect(resolveCoversModulesForSlug("mock", slugs)).toBeUndefined();
  });

  it("returns undefined for a non-IELTS curriculum without any part-N siblings", () => {
    const slugs = ["foundation", "intermediate", "advanced"];
    expect(resolveCoversModulesForSlug("mock", slugs)).toBeUndefined();
  });

  it("is case-sensitive on the mock slug — caller must normalise first", () => {
    // Modules are slugified on the author side; the helper trusts that.
    const slugs = ["part1", "part2", "part3", "Mock"];
    expect(resolveCoversModulesForSlug("Mock", slugs)).toBeUndefined();
  });
});

describe("detectMockShapeCovers", () => {
  it("returns a map keyed only by mock-shape modules", () => {
    const modules = [
      { slug: "part1" },
      { slug: "part2" },
      { slug: "part3" },
      { slug: "mock" },
    ];
    const result = detectMockShapeCovers(modules);
    expect(result.size).toBe(1);
    expect(result.get("mock")).toEqual(["part1", "part2", "part3"]);
    expect(result.get("part2")).toBeUndefined();
  });

  it("returns empty map when no mock-shape exists (regression guard for non-IELTS courses)", () => {
    const modules = [{ slug: "intro" }, { slug: "core" }, { slug: "capstone" }];
    const result = detectMockShapeCovers(modules);
    expect(result.size).toBe(0);
  });

  it("returns empty map when mock exists but part siblings are incomplete", () => {
    const modules = [{ slug: "part1" }, { slug: "part2" }, { slug: "mock" }]; // no part3
    const result = detectMockShapeCovers(modules);
    expect(result.size).toBe(0);
  });

  it("handles multiple mock-shape modules (rare but possible)", () => {
    const modules = [
      { slug: "part1" },
      { slug: "part2" },
      { slug: "part3" },
      { slug: "mock" },
      { slug: "full-mock" },
    ];
    const result = detectMockShapeCovers(modules);
    expect(result.get("mock")).toEqual(["part1", "part2", "part3"]);
    expect(result.get("full-mock")).toEqual(["part1", "part2", "part3"]);
  });
});
