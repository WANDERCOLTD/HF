import { describe, it, expect } from "vitest";
import { inferScopeFromUrl } from "@/lib/chat/scope-infer";

describe("inferScopeFromUrl", () => {
  it("course URL → PLAYBOOK scope", () => {
    const r = inferScopeFromUrl("/x/courses/abc123");
    expect(r).toEqual({ ok: true, layer: "PLAYBOOK", scopeIds: { playbookId: "abc123" } });
  });

  it("course URL with trailing path → PLAYBOOK scope (id captured to next slash)", () => {
    const r = inferScopeFromUrl("/x/courses/abc123/edit");
    expect(r).toEqual({ ok: true, layer: "PLAYBOOK", scopeIds: { playbookId: "abc123" } });
  });

  it("course URL with query string → PLAYBOOK scope", () => {
    const r = inferScopeFromUrl("/x/courses/abc123?tab=design");
    expect(r).toEqual({ ok: true, layer: "PLAYBOOK", scopeIds: { playbookId: "abc123" } });
  });

  it("caller URL → CALLER scope", () => {
    const r = inferScopeFromUrl("/x/callers/xyz789");
    expect(r).toEqual({ ok: true, layer: "CALLER", scopeIds: { callerId: "xyz789" } });
  });

  it("domain URL → DOMAIN scope", () => {
    const r = inferScopeFromUrl("/x/domains/dom1");
    expect(r).toEqual({ ok: true, layer: "DOMAIN", scopeIds: { domainId: "dom1" } });
  });

  it("non-scoped admin page → ask for scope (NO silent default)", () => {
    const r = inferScopeFromUrl("/x/help/demos");
    expect(r).toEqual({ ok: false, reason: "Specify a scope, e.g. @bertie or ^OCEAN" });
  });

  it("undefined route → ask for scope", () => {
    const r = inferScopeFromUrl(undefined);
    expect(r.ok).toBe(false);
  });

  it("null route → ask for scope", () => {
    const r = inferScopeFromUrl(null);
    expect(r.ok).toBe(false);
  });

  it("non-scoped admin page → no silent default (operator must be explicit)", () => {
    const r = inferScopeFromUrl("/x/help/demos");
    expect(r.ok).toBe(false);
  });
});
