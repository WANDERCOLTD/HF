import { describe, it, expect } from "vitest";
import {
  appendToken,
  buildEntityContext,
  greetingTrigger,
  toHistory,
  type ChatMessage,
} from "@/lib/chat";

const base: ChatMessage[] = [
  { id: "m1", role: "user", content: "hello" },
  { id: "m2", role: "assistant", content: "" },
];

describe("appendToken", () => {
  it("appends a token only to the matching message", () => {
    const a = appendToken(base, "m2", "Hi");
    const b = appendToken(a, "m2", " there");
    expect(b.find((m) => m.id === "m2")?.content).toBe("Hi there");
    expect(b.find((m) => m.id === "m1")?.content).toBe("hello");
  });

  it("is immutable", () => {
    const next = appendToken(base, "m2", "x");
    expect(next).not.toBe(base);
    expect(base[1].content).toBe("");
  });
});

describe("toHistory", () => {
  it("drops empty messages and keeps role + content", () => {
    const h = toHistory(base);
    expect(h).toEqual([{ role: "user", content: "hello" }]);
  });

  it("reconstructs a full turn order", () => {
    const convo: ChatMessage[] = [
      { id: "1", role: "user", content: "a" },
      { id: "2", role: "assistant", content: "b" },
      { id: "3", role: "user", content: "c" },
    ];
    expect(toHistory(convo).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("buildEntityContext", () => {
  it("binds a chat turn to a caller", () => {
    expect(buildEntityContext("c7", "Chloe Bennett")).toEqual([
      { type: "caller", id: "c7", label: "Chloe Bennett" },
    ]);
  });

  it("falls back to the id when no name, and is empty without a caller", () => {
    expect(buildEntityContext("c7")).toEqual([{ type: "caller", id: "c7", label: "c7" }]);
    expect(buildEntityContext()).toEqual([]);
  });
});

describe("greetingTrigger", () => {
  it("uses the caller's adapted first line when present", () => {
    expect(greetingTrigger("Hi Amelia, ready for Part 2?")).toContain("Hi Amelia, ready for Part 2?");
  });
  it("falls back to a generic warm greeting", () => {
    expect(greetingTrigger(null).toLowerCase()).toContain("greet");
  });
});
