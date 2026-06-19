/**
 * Tests for `<AgentTunerNlpGate>` — the runtime gate that conditionally
 * mounts the AgentTuner UI based on `config.agentTunerNlpEnabled`.
 *
 * Pins (#2056, sub-epic G of #2049):
 *  1. Gate renders children when the flag is true.
 *  2. Gate renders NOTHING (null) when the flag is false / undefined / null.
 *  3. Opt-in semantics — a freshly-seeded playbook with no flag does NOT
 *     surface the AgentTuner.
 *
 * Verified by the matching writeGate enforcement on the
 * `journey-setting` PATCH route (`writeGate: "operator-only"` per
 * `setting-contracts.entries.ts:1012`) — non-operator sessions cannot
 * toggle the flag in the first place; the gate trusts the persisted
 * value.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AgentTunerNlpGate } from "@/components/shared/AgentTunerNlpGate";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const childTestId = "agent-tuner-child";
const child = <div data-testid={childTestId}>tuner-mount</div>;

describe("<AgentTunerNlpGate>", () => {
  it("renders children when agentTunerNlpEnabled is true", () => {
    const { queryByTestId } = render(
      <AgentTunerNlpGate
        playbookConfig={{ agentTunerNlpEnabled: true } as PlaybookConfig}
      >
        {child}
      </AgentTunerNlpGate>,
    );
    expect(queryByTestId(childTestId)).not.toBeNull();
  });

  it("renders nothing when agentTunerNlpEnabled is false", () => {
    const { queryByTestId } = render(
      <AgentTunerNlpGate
        playbookConfig={{ agentTunerNlpEnabled: false } as PlaybookConfig}
      >
        {child}
      </AgentTunerNlpGate>,
    );
    expect(queryByTestId(childTestId)).toBeNull();
  });

  it("renders nothing when agentTunerNlpEnabled is unset (opt-in default)", () => {
    const { queryByTestId } = render(
      <AgentTunerNlpGate playbookConfig={{} as PlaybookConfig}>
        {child}
      </AgentTunerNlpGate>,
    );
    expect(queryByTestId(childTestId)).toBeNull();
  });

  it("renders nothing when playbookConfig is null", () => {
    const { queryByTestId } = render(
      <AgentTunerNlpGate playbookConfig={null}>{child}</AgentTunerNlpGate>,
    );
    expect(queryByTestId(childTestId)).toBeNull();
  });

  it("renders nothing when playbookConfig is undefined", () => {
    const { queryByTestId } = render(
      <AgentTunerNlpGate playbookConfig={undefined}>{child}</AgentTunerNlpGate>,
    );
    expect(queryByTestId(childTestId)).toBeNull();
  });
});

describe("AgentTunerNlpGate — writeGate contract spot-verify", () => {
  it("contract carries writeGate operator-only (defence in depth)", async () => {
    // Spot-verify the writeGate per the task brief. The PATCH route's
    // writeGate check is the structural enforcement; this test pins the
    // contract metadata so a refactor that drops the writeGate also
    // fails CI here.
    const { JOURNEY_SETTINGS } = await import(
      "@/lib/journey/setting-contracts.entries"
    );
    const contract = JOURNEY_SETTINGS.find((s) => s.id === "agentTunerNlpEnabled");
    expect(contract).toBeDefined();
    expect(contract!.writeGate).toBe("operator-only");
  });
});
