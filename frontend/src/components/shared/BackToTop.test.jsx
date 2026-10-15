import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BackToTop from "./BackToTop";
import DriverBackToTop from "../../driver/BackToTop";

describe("back to top (office)", () => {
  afterEach(() => { window.scrollY = 0; });

  it("is hidden at the top of the page, appears once scrolled, and scrolls smoothly back", () => {
    window.scrollTo = vi.fn();
    render(<BackToTop />);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();

    act(() => { window.scrollY = 900; window.dispatchEvent(new Event("scroll")); });
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    act(() => { window.scrollY = 0; window.dispatchEvent(new Event("scroll")); });
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("does not animate for someone who asked their system for less motion", () => {
    window.scrollTo = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<BackToTop />);
    act(() => { window.scrollY = 900; window.dispatchEvent(new Event("scroll")); });
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    delete window.matchMedia;
  });
});

describe("back to top (driver app)", () => {
  it("watches the screen it is in, not the page, and returns that screen to the top", () => {
    const { container } = render(<div className="dr-scroll" data-testid="screen"><DriverBackToTop /></div>);
    const screenEl = container.querySelector(".dr-scroll");
    screenEl.scrollTo = vi.fn();
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();

    act(() => { screenEl.scrollTop = 600; screenEl.dispatchEvent(new Event("scroll")); });
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(screenEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
