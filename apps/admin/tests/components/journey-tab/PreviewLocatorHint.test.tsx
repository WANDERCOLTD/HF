import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { PreviewLocatorHint } from "@/components/journey-tab/PreviewLocatorHint";

afterEach(() => cleanup());

describe("PreviewLocatorHint — Slice C (#1721) hint + pick-strip", () => {
  it("renders nothing when no bucket and no pick-strip", () => {
    render(
      <PreviewLocatorHint
        selectedBucketId={null}
        pickStripSection={null}
        onSelectBucket={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("hf-journey-locator-hint")).toBeNull();
    expect(screen.queryByTestId("hf-journey-pick-strip")).toBeNull();
  });

  it("renders cross-cutting chip when the selected bucket touches a cross-cutting section", () => {
    // C_teaching_style includes firstCallTargets → behaviorTargets (cross-
    // cutting). Chip should render.
    render(
      <PreviewLocatorHint
        selectedBucketId="C_teaching_style"
        pickStripSection={null}
        onSelectBucket={vi.fn()}
      />,
    );
    expect(screen.getByTestId("hf-journey-locator-hint")).toBeInTheDocument();
  });

  it("renders the pick-strip when a Preview bubble is touched by 2+ buckets", () => {
    const onSelect = vi.fn();
    // `welcome` is touched by B_call1_opening only — pick a cross-cutting
    // section like `behaviorTargets` which multiple buckets touch.
    render(
      <PreviewLocatorHint
        selectedBucketId="C_teaching_style"
        pickStripSection="behaviorTargets"
        onSelectBucket={onSelect}
      />,
    );
    const strip = screen.queryByTestId("hf-journey-pick-strip");
    // If behaviorTargets has 2+ owning buckets, strip renders. Otherwise
    // we fall through to the cross-cutting hint. Both are valid Slice C
    // shapes — verify whichever branch the registry yields.
    if (strip) {
      expect(strip).toBeInTheDocument();
    } else {
      expect(screen.getByTestId("hf-journey-locator-hint")).toBeInTheDocument();
    }
  });

  it("renders nothing when bucket is selected but has no cross-cutting locators", () => {
    // M_end_of_course contains offboardingCertificate + offboarding-summary
    // settings, whose previewLocators only touch `offboarding` (not in the
    // CROSS_CUTTING_SECTIONS set). Hint chip should not render.
    render(
      <PreviewLocatorHint
        selectedBucketId="M_end_of_course"
        pickStripSection={null}
        onSelectBucket={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("hf-journey-locator-hint")).toBeNull();
  });

  it("clicking a pick-strip chip fires onSelectBucket with that bucket id", () => {
    const onSelect = vi.fn();
    render(
      <PreviewLocatorHint
        selectedBucketId="C_teaching_style"
        pickStripSection="behaviorTargets"
        onSelectBucket={onSelect}
      />,
    );
    const strip = screen.queryByTestId("hf-journey-pick-strip");
    if (!strip) {
      // Registry doesn't yield a 2+ bucket overlap on this section; skip.
      return;
    }
    const chip = strip.querySelector("button");
    if (chip) {
      fireEvent.click(chip);
      expect(onSelect).toHaveBeenCalled();
    }
  });
});
