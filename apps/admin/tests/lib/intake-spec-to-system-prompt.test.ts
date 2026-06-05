/**
 * Tests for `specToSystemPrompt` — the spec-driven prompt generator
 * that replaces the hand-curated SYSTEM_PROMPT in app/api/intake/chat.
 *
 * Properties under test:
 *   - All non-internal spec fields appear in the prompt (by key + label)
 *   - Internal fields (processesArt9 etc) do NOT appear
 *   - Required fields are listed before optional fields
 *   - Required vs optional is flagged in the prompt
 *   - Enum options are enumerated inline (so the AI constrains values)
 *   - The persona override flows through when supplied
 *
 * Architectural intent: when a new field is added to the spec, this
 * test verifies the prompt picks it up automatically with no parallel
 * edit in the chat route. The previous hand-curated prompt had a
 * silent-failure mode where #1124 added `phone` and the AI just
 * ignored it.
 */

import { describe, it, expect } from "vitest";
import { specToSystemPrompt } from "@/lib/intake/spec-tools";
import {
  EnrollmentIntake,
  INTERNAL_FIELDS,
  REQUIRED_FIELDS,
} from "@/lib/intake/specs/enrollment.intent";

const PROMPT = specToSystemPrompt(EnrollmentIntake, {
  excludeFields: INTERNAL_FIELDS,
  requiredFields: REQUIRED_FIELDS,
});

describe("specToSystemPrompt", () => {
  it("includes every required field as REQUIRED", () => {
    for (const key of REQUIRED_FIELDS) {
      expect(PROMPT).toContain(`\`${key}\` [REQUIRED]`);
    }
  });

  it("includes phone as an optional field (added in #1124)", () => {
    expect(PROMPT).toContain("`phone` [optional]");
  });

  it("includes the user-facing optional fields", () => {
    for (const key of [
      "displayName",
      "timezone",
      "preferredContactMethod",
      "marketingOptIn",
      "accessibilityNote",
    ]) {
      expect(PROMPT).toContain(`\`${key}\` [optional]`);
    }
  });

  it("excludes internal/derived fields", () => {
    for (const key of INTERNAL_FIELDS) {
      expect(PROMPT).not.toContain(`\`${key}\``);
    }
  });

  it("required fields appear before optional fields in the ask order", () => {
    const orderLine = PROMPT.match(/Ask in this STRICT order:.*$/m)?.[0] ?? "";
    expect(orderLine).toBeTruthy();
    const firstRequired = orderLine.indexOf("firstName");
    const phone = orderLine.indexOf("phone");
    expect(firstRequired).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(firstRequired);
  });

  it("enumerates enum options inline (e.g. ageRange band values)", () => {
    expect(PROMPT).toContain("'18-24'");
    expect(PROMPT).toContain("'65-plus'");
    expect(PROMPT).toContain("'prefer-not-to-say'");
  });

  it("tells the AI to fail-skippable on decline for optional fields", () => {
    expect(PROMPT.toLowerCase()).toContain("decline");
    expect(PROMPT).toContain("skip");
  });

  it("counts required vs optional correctly in the framing line", () => {
    const reqCount = REQUIRED_FIELDS.length;
    const optCount = Object.keys(EnrollmentIntake.fields).filter(
      (k) =>
        !(INTERNAL_FIELDS as readonly string[]).includes(k) &&
        !(REQUIRED_FIELDS as readonly string[]).includes(k),
    ).length;
    expect(PROMPT).toContain(`Capture ${reqCount} required value`);
    expect(PROMPT).toContain(`${optCount} optional`);
  });

  it("uses the default persona when none supplied", () => {
    expect(PROMPT).toContain("HumanFirst Foundation's enrolment assistant");
  });

  it("uses an override persona when supplied", () => {
    const custom = specToSystemPrompt(EnrollmentIntake, {
      excludeFields: INTERNAL_FIELDS,
      requiredFields: REQUIRED_FIELDS,
      persona: "You are a different bot.",
    });
    expect(custom).toContain("You are a different bot.");
    expect(custom).not.toContain("HumanFirst Foundation's enrolment assistant");
  });

  it("returns just the persona when the spec has no askable fields", () => {
    const result = specToSystemPrompt(EnrollmentIntake, {
      excludeFields: Object.keys(EnrollmentIntake.fields),
      requiredFields: [],
      persona: "Minimal.",
    });
    expect(result).toBe("Minimal.");
  });
});
