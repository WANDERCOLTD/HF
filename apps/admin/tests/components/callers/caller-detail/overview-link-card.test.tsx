import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { OverviewLinkCard } from "@/components/callers/caller-detail/cards/OverviewLinkCard";

describe("OverviewLinkCard", () => {
  it("renders title, subtitle, summary, and CTA", () => {
    const onClick = vi.fn();
    const { getByRole, container } = render(
      <OverviewLinkCard
        title="Skill growth"
        subtitle="Lives on Uplift now."
        summary={<span data-testid="summary">tile</span>}
        linkLabel="Open Uplift"
        onClick={onClick}
      />,
    );

    expect(container.textContent).toContain("Skill growth");
    expect(container.textContent).toContain("Lives on Uplift now.");
    expect(container.querySelector("[data-testid='summary']")).not.toBeNull();
    const btn = getByRole("button", { name: /Open Uplift/i });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders without subtitle or summary", () => {
    const { container } = render(
      <OverviewLinkCard
        title="Progress"
        linkLabel="Open"
        onClick={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("Progress");
    expect(container.querySelector(".hf-overview-link-subtitle")).toBeNull();
    expect(container.querySelector(".hf-overview-link-summary")).toBeNull();
  });
});
