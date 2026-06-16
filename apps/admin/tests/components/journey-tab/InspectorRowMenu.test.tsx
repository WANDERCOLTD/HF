import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";

import { InspectorRowMenu } from "@/components/journey-tab/InspectorRowMenu";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Welcome message",
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

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response),
  );
  // jsdom clipboard mock
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderInProvider(ui: React.ReactNode) {
  return render(
    <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
      {ui}
    </JourneySettingMutatorProvider>,
  );
}

describe("InspectorRowMenu — Lane 2 RHS usability pass", () => {
  it("renders nothing when readonly / no courseId", () => {
    const { container } = render(
      <JourneySettingMutatorProvider courseId={null} playbookConfig={{}}>
        <InspectorRowMenu contract={contract} value="hi" />
      </JourneySettingMutatorProvider>,
    );
    expect(container.querySelector('[data-testid="hf-inspector-row-menu-welcomeMessage"] .hf-inspector-row-menu-button')).toBeNull();
  });

  it("renders the overflow trigger ⋯ button when wired", () => {
    renderInProvider(<InspectorRowMenu contract={contract} value="hi" />);
    expect(
      screen.getByTestId("hf-inspector-row-menu-trigger-welcomeMessage"),
    ).toBeInTheDocument();
  });

  it("opens the menu and exposes Edit as JSON / Copy current / Copy path actions", () => {
    renderInProvider(<InspectorRowMenu contract={contract} value="hi" />);
    fireEvent.click(
      screen.getByTestId("hf-inspector-row-menu-trigger-welcomeMessage"),
    );
    expect(
      screen.getByTestId("hf-inspector-row-menu-edit-json-welcomeMessage"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-inspector-row-menu-copy-value-welcomeMessage"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-inspector-row-menu-copy-path-welcomeMessage"),
    ).toBeInTheDocument();
  });

  it("Copy storage path copies the contract's storagePath to clipboard", () => {
    renderInProvider(<InspectorRowMenu contract={contract} value="hi" />);
    fireEvent.click(
      screen.getByTestId("hf-inspector-row-menu-trigger-welcomeMessage"),
    );
    fireEvent.click(
      screen.getByTestId("hf-inspector-row-menu-copy-path-welcomeMessage"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "sessionFlow.welcomeMessage",
    );
  });

  it("Edit as JSON opens the JSON modal", () => {
    renderInProvider(<InspectorRowMenu contract={contract} value="hi" />);
    fireEvent.click(
      screen.getByTestId("hf-inspector-row-menu-trigger-welcomeMessage"),
    );
    fireEvent.click(
      screen.getByTestId("hf-inspector-row-menu-edit-json-welcomeMessage"),
    );
    // The JsonEditorModal renders by setting body content; just verify
    // some content from the modal title or textarea is reachable.
    // The exact testid depends on JsonEditorModal — generic content
    // check.
    expect(document.body.textContent).toMatch(/Welcome message/);
  });
});
