import { describe, it, expect } from "vitest";
import { resolvePersonaKey } from "@/lib/domain/persona-loaders";

describe("resolvePersonaKey", () => {
  it("maps V4 interaction patterns to INIT-001 persona keys", () => {
    expect(resolvePersonaKey("socratic")).toBe("tutor");
    expect(resolvePersonaKey("directive")).toBe("tutor");
    expect(resolvePersonaKey("reflective")).toBe("tutor");
    expect(resolvePersonaKey("open")).toBe("tutor");
    expect(resolvePersonaKey("advisory")).toBe("coach");
    expect(resolvePersonaKey("coaching")).toBe("coach");
    expect(resolvePersonaKey("companion")).toBe("companion");
    expect(resolvePersonaKey("facilitation")).toBe("guide");
  });

  it("passes through raw INIT-001 persona keys unchanged", () => {
    expect(resolvePersonaKey("tutor")).toBe("tutor");
    expect(resolvePersonaKey("coach")).toBe("coach");
    expect(resolvePersonaKey("guide")).toBe("guide");
    expect(resolvePersonaKey("companion")).toBe("companion");
    expect(resolvePersonaKey("conversational-guide")).toBe("conversational-guide");
    expect(resolvePersonaKey("interviewer")).toBe("interviewer");
    expect(resolvePersonaKey("storyteller")).toBe("storyteller");
  });

  it("passes through unknown values unchanged", () => {
    expect(resolvePersonaKey("unknown-value")).toBe("unknown-value");
    expect(resolvePersonaKey("")).toBe("");
  });
});
