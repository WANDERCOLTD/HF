import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { WriteGateLockChip } from "@/components/journey-tab/WriteGateLockChip";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

afterEach(() => cleanup());

const baseContract: JourneySettingContract = {
  id: "someSetting",
  group: "G2",
  educatorLabel: "Some setting",
  storagePath: "config.someSetting",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

describe("WriteGateLockChip — Slice C3 (#1738)", () => {
  it("renders nothing when writeGate is absent", () => {
    const { container } = render(<WriteGateLockChip contract={baseContract} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a lock chip when writeGate === 'operator-only'", () => {
    render(
      <WriteGateLockChip
        contract={{ ...baseContract, writeGate: "operator-only" }}
      />,
    );
    expect(
      screen.getByTestId("hf-writegate-lock-someSetting"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Operator-only/)).toBeInTheDocument();
  });

  it("carries a tooltip referring to the chain-contract boundary", () => {
    render(
      <WriteGateLockChip
        contract={{ ...baseContract, writeGate: "operator-only" }}
      />,
    );
    const chip = screen.getByTestId("hf-writegate-lock-someSetting");
    expect(chip.getAttribute("title")).toMatch(/chain-contract/);
  });
});
