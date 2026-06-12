import { describe, it, expect } from "vitest";
import { parseScopeTokens } from "@/lib/chat/scope-prefix-parser";

describe("parseScopeTokens", () => {
  describe("single trailing token extraction", () => {
    it("extracts @caller token", () => {
      const r = parseScopeTokens("set response-length 0.2 @bertie");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toEqual({ kind: "caller", name: "bertie" });
      expect(r.stripped).toBe("set response-length 0.2");
    });

    it("extracts ^playbook token", () => {
      const r = parseScopeTokens("set response-length 0.2 ^OCEAN");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toEqual({ kind: "playbook", name: "OCEAN" });
      expect(r.stripped).toBe("set response-length 0.2");
    });

    it("extracts ~domain token", () => {
      const r = parseScopeTokens("set response-length 0.2 ~education");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toEqual({ kind: "domain", name: "education" });
      expect(r.stripped).toBe("set response-length 0.2");
    });

    it("extracts #system token", () => {
      const r = parseScopeTokens("set response-length 0.2 #system");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toEqual({ kind: "system" });
      expect(r.stripped).toBe("set response-length 0.2");
    });

    it("preserves trailing whitespace before token", () => {
      const r = parseScopeTokens("apply demo preset    @bertie");
      expect(r.scopeToken).toEqual({ kind: "caller", name: "bertie" });
      expect(r.stripped).toBe("apply demo preset");
    });

    it("allows dashes and underscores in token names", () => {
      const r = parseScopeTokens("set warmth 0.5 ^big-five_v2");
      expect(r.scopeToken).toEqual({ kind: "playbook", name: "big-five_v2" });
    });
  });

  describe("rejects multi-token messages", () => {
    it("two scope tokens → error", () => {
      const r = parseScopeTokens("set warmth 0.5 @bertie ^OCEAN");
      expect(r.error).toMatch(/Too many scope tokens/);
      expect(r.scopeToken).toBeNull();
      expect(r.stripped).toBe("set warmth 0.5 @bertie ^OCEAN");
    });

    it("token in middle plus token at end → error", () => {
      const r = parseScopeTokens("the @cat ate ~food");
      expect(r.error).toMatch(/Too many scope tokens/);
    });
  });

  describe("no token cases", () => {
    it("plain message → identity", () => {
      const r = parseScopeTokens("set response-length 0.2");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toBeNull();
      expect(r.stripped).toBe("set response-length 0.2");
    });

    it("empty string → identity", () => {
      const r = parseScopeTokens("");
      expect(r.error).toBeNull();
      expect(r.scopeToken).toBeNull();
    });

    it("null/undefined → identity", () => {
      const r = parseScopeTokens(undefined as unknown as string);
      expect(r.error).toBeNull();
      expect(r.scopeToken).toBeNull();
    });

    it("token NOT preceded by whitespace is not extracted", () => {
      const r = parseScopeTokens("email@bertie");
      expect(r.scopeToken).toBeNull();
      expect(r.stripped).toBe("email@bertie");
    });
  });

  describe("slash-command bypass", () => {
    it("/command message passes through unchanged", () => {
      const r = parseScopeTokens("/wizard help @bertie");
      expect(r.scopeToken).toBeNull();
      expect(r.error).toBeNull();
      expect(r.stripped).toBe("/wizard help @bertie");
    });

    it("/command with leading whitespace still bypasses", () => {
      const r = parseScopeTokens("  /course-ref show @bertie");
      expect(r.scopeToken).toBeNull();
      expect(r.stripped).toBe("  /course-ref show @bertie");
    });
  });
});
