import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import { CascadeTraceBreadcrumb } from "@/components/journey-tab/CascadeTraceBreadcrumb";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import type { Effective } from "@/lib/cascade/layer-types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Default mock returns ok+empty body so the mutator-provider's own
  // /api/courses/[id]/design fetch doesn't NPE. Per-test mocks override.
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response),
  );
});

const baseContract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Opening line",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

function renderInProvider(
  ui: React.ReactNode,
  opts: { courseId: string | null } = { courseId: "course-1" },
) {
  return render(
    <JourneySettingMutatorProvider courseId={opts.courseId} playbookConfig={{}}>
      {ui}
    </JourneySettingMutatorProvider>,
  );
}

describe("CascadeTraceBreadcrumb — Slice C2 (#1737) hook integration", () => {
  it("renders nothing when cascadeSources is empty AND no courseId scope", () => {
    const { container } = renderInProvider(
      <CascadeTraceBreadcrumb contract={baseContract} />,
      { courseId: null },
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the static chain when courseId missing (no scope to resolve)", () => {
    renderInProvider(
      <CascadeTraceBreadcrumb
        contract={{
          ...baseContract,
          cascadeSources: [
            { level: "domain", storagePath: "domain.welcomeMessage" },
            { level: "group", storagePath: "config.sessionFlow.welcomeMessage" },
          ],
        }}
      />,
      { courseId: null },
    );
    expect(screen.getByTestId("hf-cascade-trace-welcomeMessage")).toBeInTheDocument();
    expect(screen.getByTestId("hf-cascade-trace-layer-domain")).toBeInTheDocument();
  });

  it("falls back to static chain when hook reports unresolvable (400 from route)", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          ok: false,
          error: 'Unknown cascade knob key: "welcomeMessage"',
        }),
    } as Response);

    renderInProvider(
      <CascadeTraceBreadcrumb
        contract={{
          ...baseContract,
          cascadeSources: [
            { level: "domain", storagePath: "domain.welcomeMessage" },
            { level: "group", storagePath: "config.sessionFlow.welcomeMessage" },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("hf-cascade-trace-welcomeMessage"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("hf-cascade-trace-layer-domain")).toBeInTheDocument();
  });

  it("renders the live CascadeValue chip when the route resolves", async () => {
    const envelope: Effective<string> = {
      value: "Welcome to your IELTS prep journey",
      source: "DOMAIN",
      layers: [
        {
          layer: "DOMAIN",
          scopeId: "dom-1",
          scopeLabel: "Education",
          value: "Welcome to your IELTS prep journey",
          setAt: null,
          setBy: null,
        },
      ],
      isInherited: true,
      recommendedLayerForEdit: "PLAYBOOK",
    };
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(envelope),
    } as Response);

    renderInProvider(
      <CascadeTraceBreadcrumb
        contract={{
          ...baseContract,
          cascadeKnobKey: "welcomeMessage",
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("hf-cascade-trace-welcomeMessage"),
      ).toBeInTheDocument();
    });
    // The CascadeValue chip wraps the stringified winner.
    expect(screen.getByText(/Welcome to your IELTS prep/)).toBeInTheDocument();
  });

  it("uses contract.cascadeKnobKey when present, falls back to contract.id", async () => {
    // #1842 added `isResolvableKnob` pre-filter to useEffectiveValue. A
    // knob that isn't in `FAMILIES` short-circuits to {unresolvable: true}
    // before fetch is ever called. To pin the cascadeKnobKey-over-id
    // routing, use a known-resolvable family member (`voiceProvider`) so
    // the hook actually issues the network call.
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          ok: false,
          error: 'mock 400 — assertion is about the URL only',
        }),
    } as Response);

    renderInProvider(
      <CascadeTraceBreadcrumb
        contract={{
          ...baseContract,
          id: "someContractId",
          cascadeKnobKey: "voiceProvider",
          cascadeSources: [
            { level: "group", storagePath: "config.someField" },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    });
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("knobKey=voiceProvider");
  });
});
