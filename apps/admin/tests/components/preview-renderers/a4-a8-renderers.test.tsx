/**
 * A.4 InstructionsRenderer + A.8 ContentTrustRenderer — #1634.
 *
 * Pinned acceptance:
 *   1. Registry contract for both keys.
 *   2. InstructionsRenderer: 6 goal-type rows always render; dimmed
 *      treatment when goalTypesInUse is supplied; full-strength when
 *      undefined.
 *   3. InstructionsRenderer: GOAL_ADAPTATION_GUIDANCE shape (6 keys,
 *      3 strings each) — pins the mirror of the server-side map.
 *   4. ContentTrustRenderer: 3 empty states (no sources / all fresh /
 *      N warnings) render the right copy + chip variant.
 *   5. ContentTrustRenderer: severity → badge variant mapping.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ContentTrustRenderer,
  type ContentTrustRendererData,
  GOAL_ADAPTATION_GUIDANCE,
  InstructionsRenderer,
  type InstructionsRendererData,
  type GoalType,
  type FreshnessWarning,
} from "@/components/shared/preview-renderers";
import {
  getPreviewRenderer,
  registerPreviewRenderer,
} from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  registerPreviewRenderer<"instructions", InstructionsRendererData>(
    "instructions",
    InstructionsRenderer,
  );
  registerPreviewRenderer<"contentTrust", ContentTrustRendererData>(
    "contentTrust",
    ContentTrustRenderer,
  );
});

describe("A.4 + A.8 — registry contract", () => {
  it("registers both keys", () => {
    expect(getPreviewRenderer("instructions")).toBe(InstructionsRenderer);
    expect(getPreviewRenderer("contentTrust")).toBe(ContentTrustRenderer);
  });
});

describe("InstructionsRenderer — GOAL_ADAPTATION_GUIDANCE shape", () => {
  it("has exactly the 6 canonical goal types", () => {
    expect(Object.keys(GOAL_ADAPTATION_GUIDANCE).sort()).toEqual([
      "ACHIEVE",
      "CHANGE",
      "CONNECT",
      "CREATE",
      "LEARN",
      "SUPPORT",
    ]);
  });

  it("supplies 3 guidance strings (LOW / MID / HIGH) per type", () => {
    for (const t of Object.keys(GOAL_ADAPTATION_GUIDANCE) as GoalType[]) {
      const triple = GOAL_ADAPTATION_GUIDANCE[t];
      expect(triple).toHaveLength(3);
      for (const s of triple) {
        expect(typeof s).toBe("string");
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });

  it("matches the LEARN row server-side values exactly (pin)", () => {
    expect(GOAL_ADAPTATION_GUIDANCE.LEARN).toEqual([
      "Introduce concepts gently, check understanding frequently",
      "Build on prior foundations, connect to what they already know",
      "Challenge with application, prepare for mastery",
    ]);
  });
});

describe("InstructionsRenderer — render output", () => {
  it("renders all 6 type rows at full strength when goalTypesInUse is undefined", () => {
    render(
      <InstructionsRenderer
        data={{ goalTypesInUse: undefined }}
        selection={{ selectedKey: "instructions" }}
      />,
    );
    for (const t of ["LEARN", "ACHIEVE", "CHANGE", "CONNECT", "SUPPORT", "CREATE"]) {
      const row = screen.getByTestId(`hf-instructions-row-${t}`);
      expect(row.getAttribute("data-dimmed")).toBe("false");
    }
  });

  it("dims rows whose goal type is not in goalTypesInUse", () => {
    render(
      <InstructionsRenderer
        data={{ goalTypesInUse: ["LEARN", "ACHIEVE"] }}
        selection={{ selectedKey: "instructions" }}
      />,
    );
    expect(
      screen.getByTestId("hf-instructions-row-LEARN").getAttribute("data-dimmed"),
    ).toBe("false");
    expect(
      screen.getByTestId("hf-instructions-row-ACHIEVE").getAttribute("data-dimmed"),
    ).toBe("false");
    for (const t of ["CHANGE", "CONNECT", "SUPPORT", "CREATE"]) {
      expect(
        screen.getByTestId(`hf-instructions-row-${t}`).getAttribute("data-dimmed"),
      ).toBe("true");
    }
  });

  it("shows the 'in use' chip only for active types when filter is supplied", () => {
    render(
      <InstructionsRenderer
        data={{ goalTypesInUse: ["LEARN"] }}
        selection={{ selectedKey: "instructions" }}
      />,
    );
    expect(screen.getAllByText("in use").length).toBe(1);
  });

  it("omits the 'in use' chip when filter is undefined", () => {
    render(
      <InstructionsRenderer
        data={{ goalTypesInUse: undefined }}
        selection={{ selectedKey: "instructions" }}
      />,
    );
    expect(screen.queryByText("in use")).toBeNull();
  });
});

describe("ContentTrustRenderer — empty states", () => {
  it("renders 'No content sources attached' when sourceCount is 0", () => {
    render(
      <ContentTrustRenderer
        data={{ warnings: [], sourceCount: 0 }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(
      screen.getByText("No content sources attached"),
    ).toBeInTheDocument();
  });

  it("renders 'All N sources fresh' when sourceCount > 0 and warnings is empty", () => {
    render(
      <ContentTrustRenderer
        data={{ warnings: [], sourceCount: 5 }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(screen.getByText("All 5 sources fresh")).toBeInTheDocument();
  });

  it("uses singular copy when sourceCount is 1", () => {
    render(
      <ContentTrustRenderer
        data={{ warnings: [], sourceCount: 1 }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(screen.getByText("All 1 source fresh")).toBeInTheDocument();
  });
});

describe("ContentTrustRenderer — warning rendering", () => {
  it("renders one row per warning with severity badge + message", () => {
    const warnings: FreshnessWarning[] = [
      { severity: "expiring", message: "Expires in 30 days (2026-07-14)" },
      { severity: "expired", message: "Expired 5 days ago (2026-06-09)" },
    ];
    render(
      <ContentTrustRenderer
        data={{ warnings, sourceCount: 3 }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(
      screen.getByText("Content trust — 2 warnings"),
    ).toBeInTheDocument();
    expect(screen.getByText("expiring")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
  });

  it("uses singular 'warning' copy for 1", () => {
    render(
      <ContentTrustRenderer
        data={{
          warnings: [{ severity: "info", message: "Note: source is unverified" }],
          sourceCount: 1,
        }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(screen.getByText("Content trust — 1 warning")).toBeInTheDocument();
  });

  it("maps severity to badge variant (expired → error, expiring → warning, info → info)", () => {
    const { container } = render(
      <ContentTrustRenderer
        data={{
          warnings: [
            { severity: "expired", message: "x" },
            { severity: "expiring", message: "y" },
            { severity: "info", message: "z" },
          ],
          sourceCount: 3,
        }}
        selection={{ selectedKey: "contentTrust" }}
      />,
    );
    expect(container.querySelector(".hf-badge-error")).not.toBeNull();
    expect(container.querySelector(".hf-badge-warning")).not.toBeNull();
    expect(container.querySelectorAll(".hf-badge-info").length).toBeGreaterThan(
      0,
    );
  });
});
