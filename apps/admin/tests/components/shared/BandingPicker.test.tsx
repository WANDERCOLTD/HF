/**
 * Tests for `<BandingPicker>` — the per-playbook skill-tier-mapping picker.
 *
 * Combines coverage from #1647 (source-derived preset) and #1657 (Generic
 * SYSTEM-default flip).
 *
 * Pins:
 *   1. detectPresetId — Generic (null) / IELTS / CEFR / 5-Level / Custom / Source-derived
 *   2. Source-derived render branch shows `current.tierLabels` + `current.tierBands`
 *   3. Source-derived radio is hidden when `current.tierLabels` is absent
 *   4. Save handler short-circuits (no fetch) when source-derived is selected
 *   5. Save handler writes null when Generic is selected (the new clear-to-fallback)
 *   6. Save handler writes explicit IELTS mapping when IELTS is selected
 *   7. Microcopy mentions HF's neutral 4-tier scheme (post-#1657)
 *   8. CTO mapping with 5-Level numbers + Foundation labels detects as
 *      source-derived, NOT 5-Level — pins the #1647 / #1635 fingerprint
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BandingPicker } from "@/components/shared/BandingPicker";
import { TIER_PRESETS } from "@/lib/banding/presets";

const CTO_MAPPING = {
  thresholds: TIER_PRESETS["5-level"].mapping.thresholds,
  tierBands: TIER_PRESETS["5-level"].mapping.tierBands,
  tierLabels: {
    approachingEmerging: "Foundation",
    emerging: "Developing",
    developing: "Practitioner",
    secure: "Distinction",
  },
};

const HAND_EDITED_NUMBERS_ONLY = {
  thresholds: {
    approachingEmerging: 0.2,
    emerging: 0.4,
    developing: 0.6,
    secure: 0.9,
  },
  tierBands: {
    approachingEmerging: 1,
    emerging: 2,
    developing: 3,
    secure: 5,
  },
};

describe("<BandingPicker> detectPresetId via initial radio selection", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("generic preset selected when current is null (post-#1657)", () => {
    render(<BandingPicker courseId="c1" current={undefined} />);
    expect(
      (screen.getByDisplayValue("generic") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByDisplayValue("ielts-speaking") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("ielts-speaking preset selected when current matches IELTS numbers + labels", () => {
    const ielts = TIER_PRESETS["ielts-speaking"];
    render(
      <BandingPicker
        courseId="c1"
        current={{
          thresholds: ielts.mapping.thresholds,
          tierBands: ielts.mapping.tierBands,
          tierLabels: ielts.tierLabels,
        }}
      />,
    );
    expect(
      (screen.getByDisplayValue("ielts-speaking") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("cefr preset selected when current matches CEFR numbers + labels", () => {
    const cefr = TIER_PRESETS["cefr"];
    render(
      <BandingPicker
        courseId="c1"
        current={{
          thresholds: cefr.mapping.thresholds,
          tierBands: cefr.mapping.tierBands,
          tierLabels: cefr.tierLabels,
        }}
      />,
    );
    expect((screen.getByDisplayValue("cefr") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("5-level preset selected when current matches 5-Level numbers + labels", () => {
    const five = TIER_PRESETS["5-level"];
    render(
      <BandingPicker
        courseId="c1"
        current={{
          thresholds: five.mapping.thresholds,
          tierBands: five.mapping.tierBands,
          tierLabels: five.tierLabels,
        }}
      />,
    );
    expect(
      (screen.getByDisplayValue("5-level") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("source-derived preset selected for CTO mapping (5-Level numbers + Foundation labels) — #1647 fingerprint", () => {
    render(<BandingPicker courseId="c1" current={CTO_MAPPING} />);
    expect(
      (screen.getByDisplayValue("source-derived") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByDisplayValue("5-level") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("custom preset selected for hand-edited mapping with no tierLabels", () => {
    render(<BandingPicker courseId="c1" current={HAND_EDITED_NUMBERS_ONLY} />);
    expect(
      (screen.getByDisplayValue("custom") as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("<BandingPicker> source-derived render branch", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("renders CTO labels + bands from current, not from registry placeholder", () => {
    const { container } = render(
      <BandingPicker courseId="c1" current={CTO_MAPPING} />,
    );
    const sourceRadio = container.querySelector(
      'input[value="source-derived"]',
    );
    const wrapper = sourceRadio?.closest("label");
    expect(wrapper).toBeTruthy();
    const text = wrapper!.textContent ?? "";
    expect(text).toContain("Foundation");
    expect(text).toContain("Developing");
    expect(text).toContain("Practitioner");
    expect(text).toContain("Distinction");
    expect(text).toContain("band 1");
    expect(text).toContain("band 4");
    expect(text).not.toContain("Novice");
    expect(text).not.toContain("Beginner");
  });

  it("hides the source-derived radio entirely when current has no tierLabels", () => {
    const { container } = render(
      <BandingPicker courseId="c1" current={HAND_EDITED_NUMBERS_ONLY} />,
    );
    expect(container.querySelector('input[value="source-derived"]')).toBeNull();
  });

  it("hides the source-derived radio when current is undefined", () => {
    const { container } = render(
      <BandingPicker courseId="c1" current={undefined} />,
    );
    expect(container.querySelector('input[value="source-derived"]')).toBeNull();
  });
});

describe("<BandingPicker> save handler", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response),
    );
  });

  it("short-circuits without fetch when source-derived is selected", async () => {
    const onSaved = vi.fn();
    render(
      <BandingPicker courseId="c1" current={CTO_MAPPING} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByText(/save banding/i));
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("writes skillTierMapping: null when Generic is selected (clear-to-fallback)", async () => {
    render(<BandingPicker courseId="c1" current={undefined} />);
    fireEvent.click(screen.getByText(/save banding/i));
    await new Promise((r) => setTimeout(r, 0));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ skillTierMapping: null });
  });

  it("writes explicit IELTS mapping with Band 7 label when IELTS is selected", async () => {
    render(<BandingPicker courseId="c1" current={undefined} />);
    fireEvent.click(screen.getByDisplayValue("ielts-speaking"));
    fireEvent.click(screen.getByText(/save banding/i));
    await new Promise((r) => setTimeout(r, 0));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.skillTierMapping).toBeTruthy();
    expect(body.skillTierMapping.tierBands.secure).toBe(7);
    expect(body.skillTierMapping.tierLabels.secure).toBe("Band 7");
  });

  it("calls fetch for CEFR selections too", async () => {
    render(<BandingPicker courseId="c1" current={CTO_MAPPING} />);
    fireEvent.click(screen.getByDisplayValue("cefr"));
    fireEvent.click(screen.getByText(/save banding/i));
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("<BandingPicker> #1657 microcopy", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("mentions HF's neutral 4-tier scheme (not 'Default is IELTS')", () => {
    const { container } = render(<BandingPicker courseId="c1" current={undefined} />);
    const text = container.textContent ?? "";
    expect(text).toContain("HF");
    expect(text).toContain("neutral 4-tier");
    expect(text).not.toContain("Default is IELTS Speaking");
  });
});
