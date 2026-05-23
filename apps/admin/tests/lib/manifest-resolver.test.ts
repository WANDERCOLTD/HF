import { describe, it, expect } from "vitest";
import { resolveManifestItem, getAllManifestItemIds } from "@/lib/tours/manifest-resolver";

describe("resolveManifestItem", () => {
  it("returns href/label/icon for a known item", () => {
    const result = resolveManifestItem("manage-callers");
    // manage-callers now lives in tour-anchors.json (post #7f49c460 sidebar
    // prune + #706 tour-anchors fix). Href/label/icon unchanged; sectionId
    // is the tour-anchor section, not the old "manage" section.
    expect(result).toEqual({
      href: "/x/callers",
      label: "Callers",
      icon: "User",
      sectionId: "_tour-anchors",
    });
  });

  it("returns null for an unknown item", () => {
    expect(resolveManifestItem("nonexistent")).toBeNull();
  });

  it("applies role variant when role matches", () => {
    const base = resolveManifestItem("manage-cohorts");
    expect(base?.href).toBe("/x/cohorts");
    expect(base?.label).toBe("Classrooms");

    const withRole = resolveManifestItem("manage-cohorts", "EDUCATOR");
    expect(withRole?.href).toBe("/x/educator/classrooms");
    // EDUCATOR variant only overrides href, label falls back to base
    expect(withRole?.label).toBe("Classrooms");
    expect(withRole?.icon).toBe("School");
  });

  it("returns base values when role has no variant", () => {
    const result = resolveManifestItem("manage-callers", "ADMIN");
    expect(result?.href).toBe("/x/callers");
    expect(result?.label).toBe("Callers");
  });
});

describe("getAllManifestItemIds", () => {
  it("returns all manifest items", () => {
    const ids = getAllManifestItemIds();
    // Post #7f49c460 sidebar prune + #706 tour-anchors: visible sidebar has
    // ~6 items, tour-anchors registers ~15 more. Total ~21. Lower bound
    // catches accidental deletion of the tour-anchors registry.
    expect(ids.length).toBeGreaterThan(15);
    expect(ids).toContain("manage-callers");
    expect(ids).toContain("domains");
    expect(ids).toContain("stu-progress");
    expect(ids).toContain("ai-config");
  });

  it("all IDs are unique", () => {
    const ids = getAllManifestItemIds();
    expect(ids.length).toBe(new Set(ids).size);
  });
});
