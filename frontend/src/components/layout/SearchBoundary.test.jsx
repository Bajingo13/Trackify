import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchBoundary from "./SearchBoundary";

function Broken() { throw new Error("Failed to fetch dynamically imported module"); }

describe("SearchBoundary", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("renders its child when nothing is wrong", () => {
    render(<SearchBoundary onClose={() => {}}><p>palette</p></SearchBoundary>);
    expect(screen.getByText("palette")).toBeInTheDocument();
  });

  it("replaces a palette that failed to load with a way forward, not a blank page", () => {
    const onClose = vi.fn();
    render(<SearchBoundary onClose={onClose}><Broken /></SearchBoundary>);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Search couldn't load");
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers a reload", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<SearchBoundary onClose={() => {}}><Broken /></SearchBoundary>);
    fireEvent.click(screen.getByText("Reload page"));
    expect(reload).toHaveBeenCalled();
  });
});
