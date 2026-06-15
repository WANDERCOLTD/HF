import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { SettingsTabVoiceLens } from "@/components/journey-tab/SettingsTabVoiceLens";

vi.mock("@/components/voice/VoiceConfigSection", () => ({
  VoiceConfigSection: ({ scope, scopeId }: { scope: string; scopeId: string }) => (
    <div data-testid="hf-vcs-mock">
      VoiceConfigSection({scope},{scopeId})
    </div>
  ),
}));

afterEach(() => cleanup());

describe("SettingsTabVoiceLens — Phase 6 (#1708)", () => {
  it("mounts VoiceConfigSection scoped to the course", () => {
    render(<SettingsTabVoiceLens courseId="course-42" />);
    expect(screen.getByTestId("hf-settings-voice-lens")).toBeInTheDocument();
    expect(screen.getByTestId("hf-vcs-mock")).toBeInTheDocument();
    expect(screen.getByTestId("hf-vcs-mock").textContent).toContain("course");
    expect(screen.getByTestId("hf-vcs-mock").textContent).toContain("course-42");
  });

  it("renders the retirement breadcrumb explaining the move from Design > Voice Flow", () => {
    render(<SettingsTabVoiceLens courseId="course-42" />);
    expect(screen.getByText(/Previously lived on Design/)).toBeInTheDocument();
  });
});
