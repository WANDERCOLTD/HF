import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response),
);

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockClear();
});

describe("JourneyInspectorPanel — Slice C (#1721) bucket-stacking", () => {
  it("shows empty state when no bucket selected", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId={null} />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-journey-inspector-empty")).toBeInTheDocument();
  });

  it("stacks every setting in the selected bucket", () => {
    render(
      <JourneySettingMutatorProvider
        courseId="c1"
        playbookConfig={{ sessionFlow: { welcomeMessage: "hi" } }}
      >
        <JourneyInspectorPanel selectedBucketId="B_call1_opening" />
      </JourneySettingMutatorProvider>,
    );
    // The bucket container should be present.
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-B_call1_opening"),
    ).toBeInTheDocument();
    // welcomeMessage lives in B_call1_opening; its row should mount.
    expect(
      screen.getByTestId("hf-journey-inspector-row-welcomeMessage"),
    ).toBeInTheDocument();
  });

  it("renders the bucket header with caption for a populated bucket", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId="A_intake" />
      </JourneySettingMutatorProvider>,
    );
    // A_intake → "Sign-up & pre-call profile".
    expect(screen.getByText(/Sign-up & pre-call profile/)).toBeInTheDocument();
  });
});

// #2243 (U? of #2185) — Teaching tab is a tuner, not a per-module
// authoring surface. When the consumer passes `excludeModuleScope`, the
// Inspector drops every `scope: "module"` contract from the rendered
// bucket. The Modules tab is the canonical editor for per-module
// settings (it supplies the `selectedModuleId` arraySelector). Without
// this filter, the Teaching tab Inspector renders empty
// array-editors for module-scope contracts ("No entries yet") because
// the array-keyed read path lands without a selector → the inline cue
// cards on the Playbook are unreachable.
describe("JourneyInspectorPanel — #2243 excludeModuleScope filter", () => {
  it("drops module-scope rows from a mixed-scope bucket", () => {
    // A_intake mixes course-scope and module-scope settings; the only
    // module-scope contract is `moduleProfileFieldsToCapture`.
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId="A_intake" excludeModuleScope />
      </JourneySettingMutatorProvider>,
    );
    // Bucket renders as a single (course-only) stack — no `course` /
    // `module` subgroups.
    expect(
      screen.queryByTestId("hf-journey-subgroup-module-A_intake"),
    ).toBeNull();
    expect(
      screen.queryByTestId("hf-journey-subgroup-course-A_intake"),
    ).toBeNull();
    // The module-scope row does NOT mount.
    expect(
      screen.queryByTestId(
        "hf-journey-inspector-row-moduleProfileFieldsToCapture",
      ),
    ).toBeNull();
    // The bucket container itself IS present (course-scope settings render).
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-A_intake"),
    ).toBeInTheDocument();
  });

  it("shows the modules-tab hint when a bucket is all-module-scope", () => {
    // E_learner_visual is the bucket the operator's screenshot showed —
    // it carries `moduleCueCardPool`, `moduleTopicPool`, and
    // `modulePinFocusArea`, all `scope: "module"`. With excludeModuleScope,
    // the visible set is empty → the hint fires.
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel
          selectedBucketId="E_learner_visual"
          excludeModuleScope
        />
      </JourneySettingMutatorProvider>,
    );
    expect(
      screen.getByTestId(
        "hf-journey-inspector-module-only-E_learner_visual",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Modules tab/)).toBeInTheDocument();
    // The would-be broken array-editor row never mounts.
    expect(
      screen.queryByTestId("hf-journey-inspector-row-moduleCueCardPool"),
    ).toBeNull();
  });

  it("does NOT drop module-scope rows when excludeModuleScope is false (default contract)", () => {
    // Contract pin — the default still renders the mixed-scope
    // subgroups so any future consumer that DOES supply an
    // arraySelector (e.g. wizard / Modules-tab-equivalent) continues to
    // get the full bucket. Today Teaching + Journey + Scoring all
    // explicitly pass `excludeModuleScope`; the default path is
    // exercised by no production consumer but the contract is pinned.
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId="A_intake" />
      </JourneySettingMutatorProvider>,
    );
    // A_intake → mixed → renders both subgroups.
    expect(
      screen.getByTestId("hf-journey-subgroup-course-A_intake"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-journey-subgroup-module-A_intake"),
    ).toBeInTheDocument();
    // The module-scope row mounts.
    expect(
      screen.getByTestId(
        "hf-journey-inspector-row-moduleProfileFieldsToCapture",
      ),
    ).toBeInTheDocument();
  });
});

// #2243 follow-on — pin that all three tab consumers (Teaching, Journey,
// Scoring) thread `excludeModuleScope` through to JourneyInspectorPanel.
// Source-level grep is the durable structural pin: a future refactor
// that silently drops the prop on any of these mount points fails CI.
// ModuleInspectorPanel is excluded — it supplies its own
// selectedModuleId/arraySelector context and DOES render module-scope.
describe("JourneyInspectorPanel consumers — #2243 excludeModuleScope wiring", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  const CONSUMERS = [
    "components/teaching-tab/CourseTeachingTab.tsx",
    "components/journey-tab/CourseJourneyTab.tsx",
    "components/scoring-tab/CourseScoringTab.tsx",
  ];

  for (const relPath of CONSUMERS) {
    it(`${relPath} mounts <JourneyInspectorPanel> with excludeModuleScope`, () => {
      const absPath = path.resolve(__dirname, "../../..", relPath);
      const source = fs.readFileSync(absPath, "utf8");
      // The mount must reference both the component and the prop.
      expect(source).toContain("JourneyInspectorPanel");
      expect(source).toContain("excludeModuleScope");
      // Belt-and-braces — the prop is between the component name and
      // the JSX close. A future refactor that imports the component
      // but accidentally renames or comments out the prop fails this
      // pin.
      const mountRegex =
        /<JourneyInspectorPanel\b[\s\S]*?excludeModuleScope[\s\S]*?\/>/;
      expect(source).toMatch(mountRegex);
    });
  }
});
