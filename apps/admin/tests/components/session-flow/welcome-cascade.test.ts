/**
 * Welcome-message cascade UX helpers (#1471).
 *
 * Pins the source→caption + source→aria + source→placeholder rules
 * that drive `WelcomeMessageDrawer`'s badge/caption/textarea rendering.
 */

import { describe, it, expect } from "vitest";

import {
  inheritedCaptionFor,
  badgeAriaLabel,
  placeholderFor,
} from "@/components/session-flow/welcome-cascade";
import type { Effective } from "@/lib/cascade/layer-types";

const PB_ENVELOPE: Effective<string | null> = {
  value: "Hi from the Course",
  source: "PLAYBOOK",
  layers: [
    {
      layer: "PLAYBOOK",
      scopeId: "pb-1",
      scopeLabel: "OCEAN",
      value: "Hi from the Course",
      setAt: null,
      setBy: null,
    },
  ],
  isInherited: false,
  recommendedLayerForEdit: "PLAYBOOK",
};

const DOM_ENVELOPE: Effective<string | null> = {
  value: "Hi from the Domain",
  source: "DOMAIN",
  layers: [
    {
      layer: "DOMAIN",
      scopeId: "dom-1",
      scopeLabel: "Education",
      value: "Hi from the Domain",
      setAt: null,
      setBy: null,
    },
  ],
  isInherited: true,
  recommendedLayerForEdit: "PLAYBOOK",
};

const SYS_ENVELOPE: Effective<string | null> = {
  value: null,
  source: "SYSTEM",
  layers: [],
  isInherited: false,
  recommendedLayerForEdit: "PLAYBOOK",
};

describe("inheritedCaptionFor", () => {
  it("returns null when envelope is null", () => {
    expect(inheritedCaptionFor(null)).toBeNull();
  });

  it("returns null when source is PLAYBOOK (no caption needed — badge says it)", () => {
    expect(inheritedCaptionFor(PB_ENVELOPE)).toBeNull();
  });

  it("returns Domain inheritance caption when source is DOMAIN", () => {
    expect(inheritedCaptionFor(DOM_ENVELOPE)).toBe(
      "Inherited from Domain: Education",
    );
  });

  it("returns 'no override' caption when SYSTEM with empty layers", () => {
    expect(inheritedCaptionFor(SYS_ENVELOPE)).toBe(
      "No override set — AI uses its default greeting",
    );
  });

  it("returns null for SYSTEM with non-empty layers (rare; explicit system override)", () => {
    const sysWithHit: Effective<string | null> = {
      ...SYS_ENVELOPE,
      layers: [
        {
          layer: "SYSTEM",
          scopeId: null,
          scopeLabel: "System default",
          value: null,
          setAt: null,
          setBy: null,
        },
      ],
    };
    expect(inheritedCaptionFor(sysWithHit)).toBeNull();
  });
});

describe("badgeAriaLabel", () => {
  it("PLAYBOOK source → 'set on this Course'", () => {
    expect(badgeAriaLabel("PLAYBOOK")).toBe("set on this Course");
  });

  it("DOMAIN source → 'inherited from Domain'", () => {
    expect(badgeAriaLabel("DOMAIN")).toBe("inherited from Domain");
  });

  it("SYSTEM source → 'using System default'", () => {
    expect(badgeAriaLabel("SYSTEM")).toBe("using System default");
  });
});

describe("placeholderFor", () => {
  it("returns generic placeholder when envelope is null", () => {
    expect(placeholderFor(null)).toBe(
      "Welcome to the course! Let's get started…",
    );
  });

  it("surfaces Domain value as ghost text when inheriting", () => {
    expect(placeholderFor(DOM_ENVELOPE)).toBe("Hi from the Domain");
  });

  it("returns generic placeholder for PLAYBOOK source", () => {
    expect(placeholderFor(PB_ENVELOPE)).toBe(
      "Welcome to the course! Let's get started…",
    );
  });

  it("returns generic placeholder for SYSTEM source", () => {
    expect(placeholderFor(SYS_ENVELOPE)).toBe(
      "Welcome to the course! Let's get started…",
    );
  });
});
