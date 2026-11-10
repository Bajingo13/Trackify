import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TrackifyBrand from "./TrackifyBrand";

const asset = (name) => readFileSync(path.join(process.cwd(), "src/assets/brand", name), "utf8");

describe("TrackifyBrand", () => {
  it("renders one accessible, theme-aware wordmark", () => {
    const { container } = render(<TrackifyBrand />);
    expect(screen.getByRole("img", { name: "Trackify" })).toBeInTheDocument();
    expect(container.querySelectorAll(".tk-brand__image")).toHaveLength(2);
    expect(container.querySelector(".tk-brand--wordmark")).toBeInTheDocument();
  });

  it("renders the compact mark for a collapsed sidebar", () => {
    const { container } = render(<TrackifyBrand compact />);
    expect(container.querySelector(".tk-brand--mark")).toBeInTheDocument();
  });

  it("keeps every dashboard logo asset transparent", () => {
    for (const name of [
      "trackify-logo-on-light.svg",
      "trackify-logo-on-dark.svg",
      "trackify-mark-on-light.svg",
      "trackify-mark-on-dark.svg",
    ]) {
      expect(asset(name)).not.toMatch(/<rect\b/i);
    }
  });
});
