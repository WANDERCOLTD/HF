import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyField } from "@/components/journey-controls/JourneyField";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import { CONTROL_TYPES } from "@/lib/journey/setting-contracts";

afterEach(() => cleanup());

function baseContract(
  overrides: Partial<JourneySettingContract> = {},
): JourneySettingContract {
  return {
    id: "test_id",
    group: "G1",
    educatorLabel: "Test setting",
    storagePath: "config.test",
    control: "toggle",
    cascadeSources: [],
    composeImpact: { sections: [], kinds: [], requiresReprompt: false },
    previewLocators: [],
    ...overrides,
  };
}

describe("JourneyField — dispatcher (Phase 1 #1682)", () => {
  it("smoke-renders every ControlType without crashing", () => {
    for (const control of CONTROL_TYPES) {
      const contract = baseContract({ id: `id_${control}`, control });
      const { container } = render(
        <JourneyField
          contract={contract}
          value={undefined}
          onSave={vi.fn(() => Promise.resolve())}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
        />,
      );
      // FieldShell row always present, keyed by contract.id
      expect(container.querySelector(`[data-testid="hf-jf-row-id_${control}"]`)).not.toBeNull();
      cleanup();
    }
  });

  it("renders the educatorLabel and helpText", () => {
    const contract = baseContract({
      id: "label_test",
      educatorLabel: "Opening line",
      helpText: "First line the learner hears.",
      control: "text",
    });
    render(
      <JourneyField
        contract={contract}
        value="hello"
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByText("Opening line")).toBeInTheDocument();
    expect(screen.getByText("First line the learner hears.")).toBeInTheDocument();
  });

  it("renders cascade source label when cascadeSources non-empty", () => {
    const contract = baseContract({
      id: "casc",
      control: "toggle",
      cascadeSources: [{ level: "domain", storagePath: "domain.x" }],
    });
    render(
      <JourneyField
        contract={contract}
        value={false}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByText(/from domain/)).toBeInTheDocument();
  });

  it("does not render cascade source when cascadeSources empty", () => {
    const contract = baseContract({
      id: "no_casc",
      control: "toggle",
      cascadeSources: [],
    });
    render(
      <JourneyField
        contract={contract}
        value={false}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.queryByText(/from /)).toBeNull();
  });
});
