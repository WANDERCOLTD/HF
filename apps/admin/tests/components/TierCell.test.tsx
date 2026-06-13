/**
 * Tests for `<TierCell>` — the shared tier visual primitive.
 *
 * Pins:
 *   1. Renders the right glyph + colour + label for each tier name
 *   2. `target` prop draws the ★ marker
 *   3. `onClick` makes the cell interactive (button) with hover state
 *   4. Awaiting-evidence vs above-target are visually distinct
 *   5. Caption renders below the glyph for cohort-cell use
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TierCell, AWAITING_EVIDENCE, ABOVE_TARGET } from "@/components/shared/TierCell";

describe("<TierCell>", () => {
  it("renders the glyph for a known tier when no children supplied", () => {
    const { container } = render(<TierCell tier="developing" />);
    // ◐ is the developing glyph
    expect(container.textContent).toContain("◐");
  });

  it("respects children over the default glyph", () => {
    render(<TierCell tier="secure">12</TierCell>);
    expect(screen.getByText("12")).toBeDefined();
  });

  it("uses tier name in data-tier attribute for CSS targeting", () => {
    const { container } = render(<TierCell tier="practitioner" />);
    expect(container.querySelector('[data-tier="practitioner"]')).toBeTruthy();
  });

  it("title attribute defaults to the tier display label", () => {
    const { container } = render(<TierCell tier="distinction" />);
    const el = container.querySelector('[data-tier="distinction"]');
    expect(el?.getAttribute("title")).toBe("Distinction");
  });

  it("AWAITING_EVIDENCE renders the empty-square glyph + correct title", () => {
    const { container } = render(<TierCell tier={AWAITING_EVIDENCE} />);
    expect(container.textContent).toContain("▢");
    const el = container.querySelector(`[data-tier="${AWAITING_EVIDENCE}"]`);
    expect(el?.getAttribute("title")).toBe("Awaiting evidence");
  });

  it("ABOVE_TARGET renders the upward-arrow glyph", () => {
    const { container } = render(<TierCell tier={ABOVE_TARGET} />);
    expect(container.textContent).toContain("↑");
  });

  it("target prop draws the ★ marker", () => {
    const { container } = render(<TierCell tier="practitioner" target />);
    expect(container.querySelector('[data-target="true"]')).toBeTruthy();
    expect(container.textContent).toContain("★");
  });

  it("target=false omits the ★ marker", () => {
    const { container } = render(<TierCell tier="practitioner" />);
    expect(container.querySelector('[data-target="true"]')).toBeFalsy();
    expect(container.textContent).not.toContain("★");
  });

  it("onClick makes the cell a button + fires the handler", () => {
    const onClick = vi.fn();
    const { container } = render(<TierCell tier="developing" onClick={onClick} />);
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn?.classList.contains("hf-tier-cell--interactive")).toBe(true);
    fireEvent.click(btn!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("without onClick renders a non-interactive span (not a button)", () => {
    const { container } = render(<TierCell tier="developing" />);
    expect(container.querySelector("button")).toBeFalsy();
    expect(container.querySelector("span.hf-tier-cell")).toBeTruthy();
  });

  it("caption appears below the glyph", () => {
    render(<TierCell tier="secure" caption="11 of 17" />);
    expect(screen.getByText("11 of 17")).toBeDefined();
  });

  it("compact size class applies", () => {
    const { container } = render(<TierCell tier="secure" size="compact" />);
    expect(container.querySelector(".hf-tier-cell--compact")).toBeTruthy();
  });
});
