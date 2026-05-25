import { describe, it, expect } from "vitest";
import { parsePageContext, buildPageContextBlock } from "@/app/api/chat/page-context";

describe("parsePageContext (#809)", () => {
  it("returns undefined for nullish / non-object input", () => {
    expect(parsePageContext(undefined)).toBeUndefined();
    expect(parsePageContext(null)).toBeUndefined();
    expect(parsePageContext("oops")).toBeUndefined();
    expect(parsePageContext(42)).toBeUndefined();
  });

  it("returns undefined when page is missing or empty", () => {
    expect(parsePageContext({})).toBeUndefined();
    expect(parsePageContext({ page: "" })).toBeUndefined();
    expect(parsePageContext({ page: 123, params: {} })).toBeUndefined();
  });

  it("parses a minimal payload with only page", () => {
    expect(parsePageContext({ page: "/x/courses/abc" })).toEqual({
      page: "/x/courses/abc",
      params: {},
    });
  });

  it("parses activeTab when present", () => {
    expect(
      parsePageContext({ page: "/x/courses/abc", params: { activeTab: "design" } }),
    ).toEqual({
      page: "/x/courses/abc",
      params: { activeTab: "design" },
    });
  });

  it("filters non-string entries out of visibleSections", () => {
    const result = parsePageContext({
      page: "/x/courses/abc",
      params: { visibleSections: ["felt-progress", 1, null, "", "first-call"] },
    });
    expect(result?.params.visibleSections).toEqual(["felt-progress", "first-call"]);
  });

  it("drops an empty visibleSections array", () => {
    const result = parsePageContext({
      page: "/x/courses/abc",
      params: { visibleSections: [] },
    });
    expect(result?.params.visibleSections).toBeUndefined();
  });

  it("ignores empty activeTab", () => {
    const result = parsePageContext({
      page: "/x/courses/abc",
      params: { activeTab: "" },
    });
    expect(result?.params.activeTab).toBeUndefined();
  });
});

describe("buildPageContextBlock (#809)", () => {
  it("returns empty string when pageContext is undefined", () => {
    expect(buildPageContextBlock(undefined)).toBe("");
  });

  it("returns empty string when page is empty", () => {
    expect(buildPageContextBlock({ page: "", params: {} })).toBe("");
  });

  it("renders the page line only when no params are present", () => {
    const block = buildPageContextBlock({ page: "/x/courses/abc", params: {} });
    expect(block).toContain("## Page context (what the user is looking at)");
    expect(block).toContain("Current page: /x/courses/abc");
    expect(block).not.toContain("Active tab");
    expect(block).not.toContain("Active section");
  });

  it("renders activeTab in the second line", () => {
    const block = buildPageContextBlock({
      page: "/x/courses/abc",
      params: { activeTab: "design" },
    });
    expect(block).toContain("Current page: /x/courses/abc");
    expect(block).toContain("Active tab: design");
  });

  it("joins visibleSections with commas", () => {
    const block = buildPageContextBlock({
      page: "/x/courses/abc",
      params: { activeTab: "design", visibleSections: ["felt-progress", "first-call"] },
    });
    expect(block).toContain("Active tab: design");
    expect(block).toContain("Active section: felt-progress, first-call");
  });
});
