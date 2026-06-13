/**
 * Tests for `<VariantPresetPill>` — the small pill used by the Rubric
 * Calibration lens (SP3-A) to mark variant-intrinsic mastery knobs that
 * deliberately don't cascade.
 *
 * Pins:
 *   1. Each of the 3 knob keys renders a recognisable label
 *   2. Boolean / string / null values map to readable captions
 *   3. The default-state caption ("default") is shown when value is null
 *   4. aria-label includes the "variant-intrinsic" disambiguation
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VariantPresetPill } from "@/components/shared/VariantPresetPill";

describe("<VariantPresetPill>", () => {
  it("useFreshMastery=true renders the Exam Assessment caption", () => {
    const { container } = render(
      <VariantPresetPill knob="useFreshMastery" value={true} />,
    );
    expect(container.textContent).toContain("Fresh mastery");
    expect(container.textContent).toContain("on (Exam Assessment)");
  });

  it("useFreshMastery=false renders 'off'", () => {
    const { container } = render(
      <VariantPresetPill knob="useFreshMastery" value={false} />,
    );
    expect(container.textContent).toContain("off");
  });

  it("useFreshMastery=null falls back to 'off (default)'", () => {
    const { container } = render(
      <VariantPresetPill knob="useFreshMastery" value={null} />,
    );
    expect(container.textContent).toContain("default");
  });

  it("maxMasteryTier renders the tier name capitalized", () => {
    const { container } = render(
      <VariantPresetPill knob="maxMasteryTier" value="practitioner" />,
    );
    expect(container.textContent).toContain("Mastery cap");
    expect(container.textContent).toContain("Practitioner");
  });

  it("maxMasteryTier=null renders 'none (default)'", () => {
    const { container } = render(
      <VariantPresetPill knob="maxMasteryTier" value={null} />,
    );
    expect(container.textContent).toContain("none (default)");
  });

  it("scoringMode='evidence-first' surfaces that exact label", () => {
    const { container } = render(
      <VariantPresetPill knob="scoringMode" value="evidence-first" />,
    );
    expect(container.textContent).toContain("Scoring mode");
    expect(container.textContent).toContain("evidence-first");
  });

  it("scoringMode=null falls back to 'score-first (default)'", () => {
    const { container } = render(
      <VariantPresetPill knob="scoringMode" value={null} />,
    );
    expect(container.textContent).toContain("score-first (default)");
  });

  it("aria-label disambiguates the pill as variant-intrinsic", () => {
    const { container } = render(
      <VariantPresetPill knob="useFreshMastery" value={true} />,
    );
    const el = container.querySelector(".hf-variant-preset-pill");
    expect(el?.getAttribute("aria-label")).toContain("variant-intrinsic");
  });

  it("title tooltip mentions the cascade absence", () => {
    const { container } = render(
      <VariantPresetPill knob="maxMasteryTier" value="practitioner" />,
    );
    const el = container.querySelector(".hf-variant-preset-pill");
    expect(el?.getAttribute("title")).toMatch(/no cascade/i);
  });
});
