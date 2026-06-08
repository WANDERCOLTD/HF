import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

describe("Front-of-house home", () => {
  it("renders the HumanFirst heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { name: /HumanFirst — Front of House/i })
    ).toBeInTheDocument();
  });
});
