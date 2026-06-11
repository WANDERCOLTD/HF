/**
 * Identity-spec cascade rendering helpers (#1472).
 *
 * Pins the {source, archetype} → caption + envelope shape rules used by
 * `<IdentityHeader>` inside PreviewLens.tsx. Component-level mount tests
 * for PreviewLens would require a much bigger harness (session-flow
 * fetch + sidetray + dry-run polling); these helpers are pure and fully
 * isolatable.
 */

import { describe, it, expect } from "vitest";

import {
  identitySpecEnvelope,
  identityCaption,
} from "@/app/x/courses/[courseId]/_components/PreviewLens";

describe("identitySpecEnvelope", () => {
  it("returns SYSTEM/empty envelope when source is null", () => {
    const env = identitySpecEnvelope(null, "Tutor Spec");
    expect(env.source).toBe("SYSTEM");
    expect(env.layers).toHaveLength(0);
    expect(env.value).toBeNull();
  });

  it("returns SYSTEM/empty envelope when name is null", () => {
    const env = identitySpecEnvelope("PLAYBOOK", null);
    expect(env.source).toBe("SYSTEM");
    expect(env.layers).toHaveLength(0);
  });

  it("returns PLAYBOOK envelope (not inherited) for source=PLAYBOOK", () => {
    const env = identitySpecEnvelope("PLAYBOOK", "Identity Spec");
    expect(env.source).toBe("PLAYBOOK");
    expect(env.value).toBe("Identity Spec");
    expect(env.isInherited).toBe(false);
    expect(env.layers[0].scopeLabel).toBe("Course");
  });

  it("returns DOMAIN envelope (inherited) for source=DOMAIN", () => {
    const env = identitySpecEnvelope("DOMAIN", "FoodSafety Identity");
    expect(env.source).toBe("DOMAIN");
    expect(env.isInherited).toBe(true);
    expect(env.layers[0].scopeLabel).toBe("Domain");
  });

  it("returns SYSTEM envelope (inherited) for source=SYSTEM", () => {
    const env = identitySpecEnvelope("SYSTEM", "Default Tutor");
    expect(env.source).toBe("SYSTEM");
    expect(env.isInherited).toBe(true);
    expect(env.layers[0].scopeLabel).toBe("System default");
  });
});

describe("identityCaption", () => {
  it("PLAYBOOK source → 'Persona: <label> from Course'", () => {
    expect(identityCaption("PLAYBOOK", "TUT-001")).toBe(
      "Persona: tutor from Course",
    );
  });

  it("DOMAIN source → 'Persona: <label> from Domain'", () => {
    expect(identityCaption("DOMAIN", "COACH-001")).toBe(
      "Persona: coach from Domain",
    );
  });

  it("SYSTEM source includes '(no override at Course/Domain)' note", () => {
    expect(identityCaption("SYSTEM", "TUT-001")).toBe(
      "Persona: tutor from System default (no override at Course/Domain)",
    );
  });

  it("Unknown archetype slug falls back to 'agent'", () => {
    expect(identityCaption("PLAYBOOK", "UNKNOWN-999")).toBe(
      "Persona: agent from Course",
    );
  });

  it("Null archetype slug falls back to 'agent'", () => {
    expect(identityCaption("DOMAIN", null)).toBe(
      "Persona: agent from Domain",
    );
  });

  it("No source → 'Persona: <label>' without layer suffix", () => {
    expect(identityCaption(null, "TUT-001")).toBe("Persona: tutor");
  });
});
