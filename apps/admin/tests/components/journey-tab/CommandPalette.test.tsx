import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  CommandPalette,
  COMMAND_PALETTE_INDEX_SIZE,
} from "@/components/journey-tab/CommandPalette";
import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";

afterEach(() => cleanup());

describe("CommandPalette — Phase 5 (#1706)", () => {
  it("renders nothing when open=false", () => {
    render(<CommandPalette open={false} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("hf-cmdk-panel")).toBeNull();
  });

  it("renders the panel + input when open=true", () => {
    render(<CommandPalette open onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByTestId("hf-cmdk-panel")).toBeInTheDocument();
    expect(screen.getByTestId("hf-cmdk-input")).toBeInTheDocument();
  });

  it("indexes all 74 settings (63 journey + 11 voice)", () => {
    // #1701 (Theme 1) added 6 G8 entries → journey 45 → 51 → palette 56 → 62.
    // #1747 (Theme 7) added talkTimeBudgets (G7) → journey 51 → 52 → palette 62 → 63.
    // Lane 3 PR1 added 3 A_intake (G1) entries → journey 52 → 55 → palette 63 → 66.
    expect(JOURNEY_SETTINGS.length).toBe(63);
    expect(VOICE_SETTINGS.length).toBe(11);
    expect(COMMAND_PALETTE_INDEX_SIZE).toBe(74);
  });

  it("typing narrows results by substring on educatorLabel", () => {
    render(<CommandPalette open onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByTestId("hf-cmdk-input"), {
      target: { value: "Mode" },
    });
    expect(screen.getByTestId("hf-cmdk-result-firstCallMode")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-cmdk-result-welcomeMessage")).toBeNull();
  });

  it("renders the empty-state when no match", () => {
    render(<CommandPalette open onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByTestId("hf-cmdk-input"), {
      target: { value: "zzz_no_match_zzz" },
    });
    expect(screen.getByTestId("hf-cmdk-empty")).toBeInTheDocument();
  });

  it("Enter on a result calls onSelect with its id + onClose", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onSelect={onSelect} />);
    fireEvent.change(screen.getByTestId("hf-cmdk-input"), {
      target: { value: "welcomeMessage" },
    });
    fireEvent.keyDown(screen.getByTestId("hf-cmdk-panel"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("welcomeMessage");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking a result row also calls onSelect", () => {
    const onSelect = vi.fn();
    render(<CommandPalette open onClose={vi.fn()} onSelect={onSelect} />);
    fireEvent.change(screen.getByTestId("hf-cmdk-input"), {
      target: { value: "welcomeMessage" },
    });
    fireEvent.click(screen.getByTestId("hf-cmdk-result-welcomeMessage"));
    expect(onSelect).toHaveBeenCalledWith("welcomeMessage");
  });

  it("Esc calls onClose", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("hf-cmdk-panel"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click closes", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("hf-cmdk-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });
});
