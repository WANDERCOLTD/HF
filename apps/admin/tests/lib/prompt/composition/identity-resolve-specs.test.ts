/**
 * #608-C — resolveSpecs SYSTEM IDENTITY fallback guard.
 *
 * Verifies:
 * - Playbook-resolved IDENTITY wins over any SYSTEM-scope IDENTITY archetype
 *   (ADVISOR-001, TUT-001, etc.); the archetype must never enter the
 *   resolved-spec snapshot when a playbook identity exists.
 * - The voice fallback continues to fire when only the identity is set on
 *   the playbook (regression coverage for the original behaviour).
 * - When the playbook has neither, the SYSTEM fallback still picks both.
 *
 * Pre-#608-C the outer guard `if (!identitySpec || !voiceSpec)` iterated
 * every system spec, relying on the inner `!identitySpec` check to skip
 * overwriting an existing identity. The fix adds a defensive `continue`
 * at the iteration level so the contract is visible without reading both
 * branches and any future loop-body change can't silently regress.
 *
 * See: gh issue view 608
 *      lib/prompt/composition/transforms/identity.ts
 */
import { describe, it, expect } from "vitest";
import { resolveSpecs } from "@/lib/prompt/composition/transforms/identity";
import type { PlaybookData, SystemSpecData } from "@/lib/prompt/composition/types";

// ── Fixture builders ─────────────────────────────────────────

const playbookIdentitySpec: SystemSpecData = {
  id: "spec-ielts-identity",
  slug: "spec-ielts-speaking-practice-identity",
  name: "IELTS Speaking Practice Identity",
  description: "Course-scoped identity for IELTS Prep Lab",
  specRole: "IDENTITY",
  outputType: "IDENTITY",
  config: { roleStatement: "You are an IELTS speaking coach." },
  domain: "generic",
  extendsAgent: "ADVISOR-001",
};

const playbookVoiceSpec: SystemSpecData = {
  id: "spec-ielts-voice",
  slug: "spec-ielts-voice",
  name: "IELTS Voice",
  description: null,
  specRole: "VOICE",
  outputType: "VOICE",
  config: { tone: "encouraging" },
  domain: "voice",
};

const systemAdvisorSpec: SystemSpecData = {
  id: "spec-advisor-001",
  slug: "spec-advisor-001",
  name: "ADVISOR-001",
  description: "Generic archetype for extendsAgent inheritance",
  specRole: "IDENTITY",
  outputType: "IDENTITY",
  config: { roleStatement: "You are a precise, evidence-based advisor." },
  domain: "generic",
};

const systemTutSpec: SystemSpecData = {
  id: "spec-tut-001",
  slug: "spec-tut-001",
  name: "TUT-001",
  description: "Tutor archetype",
  specRole: "IDENTITY",
  outputType: "IDENTITY",
  config: { roleStatement: "You are a Socratic tutor." },
  domain: "generic",
};

const systemVoiceSpec: SystemSpecData = {
  id: "spec-system-voice",
  slug: "spec-system-voice",
  name: "System Voice",
  description: null,
  specRole: "IDENTITY",
  outputType: "VOICE",
  config: { tone: "neutral" },
  domain: "voice",
};

function playbookWith(items: Array<{ spec: SystemSpecData }>): PlaybookData {
  return {
    id: "pb-test",
    name: "Test Playbook",
    status: "PUBLISHED",
    domain: { id: "d-test", name: "Test Domain", description: null },
    items,
  };
}

// ─────────────────────────────────────────────────────────────
// #608-C — playbook identity wins over SYSTEM IDENTITY archetypes
// ─────────────────────────────────────────────────────────────
describe("#608-C — resolveSpecs identity fallback guard", () => {
  it("playbook IDENTITY wins over SYSTEM ADVISOR-001 (no leak)", () => {
    const playbooks = [playbookWith([{ spec: playbookIdentitySpec }])];
    const systemSpecs = [systemAdvisorSpec, systemVoiceSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
    expect(result.identitySpec?.name).toBe("IELTS Speaking Practice Identity");
    // The advisor archetype must NEVER appear in the resolved snapshot
    expect(result.identitySpec?.slug).not.toBe("spec-advisor-001");
    expect(result.identitySpec?.name).not.toBe("ADVISOR-001");
  });

  it("playbook IDENTITY wins over multiple SYSTEM IDENTITY archetypes", () => {
    const playbooks = [playbookWith([{ spec: playbookIdentitySpec }])];
    const systemSpecs = [systemAdvisorSpec, systemTutSpec, systemVoiceSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
    expect([result.identitySpec?.slug]).not.toContain("spec-advisor-001");
    expect([result.identitySpec?.slug]).not.toContain("spec-tut-001");
  });

  it("voice fallback still fires when playbook has only IDENTITY (regression)", () => {
    const playbooks = [playbookWith([{ spec: playbookIdentitySpec }])];
    const systemSpecs = [systemAdvisorSpec, systemVoiceSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
    expect(result.voiceSpec?.slug).toBe("spec-system-voice");
  });

  it("playbook IDENTITY + VOICE both set → no SYSTEM fallback runs", () => {
    const playbooks = [
      playbookWith([{ spec: playbookIdentitySpec }, { spec: playbookVoiceSpec }]),
    ];
    const systemSpecs = [systemAdvisorSpec, systemVoiceSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
    expect(result.voiceSpec?.slug).toBe("spec-ielts-voice");
  });

  it("no playbook IDENTITY → SYSTEM IDENTITY fallback still picks (happy-path regression)", () => {
    const playbooks: PlaybookData[] = [];
    const systemSpecs = [systemAdvisorSpec, systemVoiceSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-advisor-001");
    expect(result.voiceSpec?.slug).toBe("spec-system-voice");
  });

  it("no playbook IDENTITY + only SYSTEM IDENTITY (no voice) → identity from system, voice null", () => {
    const playbooks: PlaybookData[] = [];
    const systemSpecs = [systemAdvisorSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-advisor-001");
    expect(result.voiceSpec).toBeNull();
  });

  it("playbook IDENTITY + only SYSTEM IDENTITY-archetype (no voice) → playbook wins, voice null, archetype never picked", () => {
    const playbooks = [playbookWith([{ spec: playbookIdentitySpec }])];
    const systemSpecs = [systemAdvisorSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
    expect(result.voiceSpec).toBeNull();
  });

  it("first playbook's identity wins when multiple playbooks each have IDENTITY", () => {
    const otherIdentity: SystemSpecData = {
      ...playbookIdentitySpec,
      id: "spec-other",
      slug: "spec-other-identity",
      name: "Other Identity",
    };
    const playbooks = [
      playbookWith([{ spec: playbookIdentitySpec }]),
      playbookWith([{ spec: otherIdentity }]),
    ];
    const systemSpecs: SystemSpecData[] = [];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.slug).toBe("spec-ielts-speaking-practice-identity");
  });

  it("preserves extendsAgent on the playbook IDENTITY (needed by mergeIdentitySpec downstream)", () => {
    const playbooks = [playbookWith([{ spec: playbookIdentitySpec }])];
    const systemSpecs = [systemAdvisorSpec];

    const result = resolveSpecs(playbooks, systemSpecs);

    expect(result.identitySpec?.extendsAgent).toBe("ADVISOR-001");
  });
});
