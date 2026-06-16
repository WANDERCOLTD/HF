import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PreviewLocatorHint } from "@/components/journey-tab/PreviewLocatorHint";

afterEach(() => cleanup());

describe("PreviewLocatorHint — #1698", () => {
  it("renders nothing when no settingId", () => {
    render(<PreviewLocatorHint selectedSettingId={null} />);
    expect(screen.queryByTestId("hf-journey-locator-hint")).toBeNull();
  });

  it("renders nothing for a discrete-bubble setting (e.g. welcomeMessage → welcome)", () => {
    render(<PreviewLocatorHint selectedSettingId="welcomeMessage" />);
    expect(screen.queryByTestId("hf-journey-locator-hint")).toBeNull();
  });

  it("renders cross-cutting hint for behaviorTargets-linked settings", () => {
    render(<PreviewLocatorHint selectedSettingId="firstCallTargets" />);
    expect(screen.getByTestId("hf-journey-locator-hint")).toBeInTheDocument();
    // The hint string from G2 firstCallTargets is "first-call slider block"
    expect(screen.getByText(/first-call slider block/)).toBeInTheDocument();
  });

  it("renders the persona-style fallback for settings with no previewLocators", () => {
    // interruptSensitivity has previewLocators=[{section: 'personality'}] (cross-cutting)
    render(<PreviewLocatorHint selectedSettingId="interruptSensitivity" />);
    expect(screen.getByTestId("hf-journey-locator-hint")).toBeInTheDocument();
  });

  it("renders the no-locator caption for runtime/scoring settings", () => {
    // skillScoringEmaHalfLife has previewLocators=[] + kinds=[scoring-weight]
    render(<PreviewLocatorHint selectedSettingId="skillScoringEmaHalfLife" />);
    expect(screen.getByTestId("hf-journey-locator-hint")).toBeInTheDocument();
    expect(screen.getByText(/scoring/i)).toBeInTheDocument();
  });
});
