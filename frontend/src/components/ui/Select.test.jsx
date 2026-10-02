import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Select from "./Select";

const OPTIONS = [
  { value: "fuel", label: "Fuel" },
  { value: "toll", label: "Toll" },
  { value: "parking", label: "Parking" },
];

describe("shared Select", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Escape closes the list without closing the dialog around it", () => {
    // The Modal listens for Escape on the document; a handled Escape must stop here.
    const dialogEscape = vi.fn();
    const onKey = (e) => { if (e.key === "Escape") dialogEscape(); };
    document.addEventListener("keydown", onKey);
    try {
      render(<Select aria-label="Category" defaultValue="fuel" options={OPTIONS} />);
      const trigger = screen.getByRole("combobox", { name: "Category" });
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(dialogEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onKey);
    }
  });

  it("Escape with the list closed is left for the dialog", () => {
    const dialogEscape = vi.fn();
    const onKey = (e) => { if (e.key === "Escape") dialogEscape(); };
    document.addEventListener("keydown", onKey);
    try {
      render(<Select aria-label="Category" defaultValue="fuel" options={OPTIONS} />);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Category" }), { key: "Escape" });
      expect(dialogEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onKey);
    }
  });

  it("opening from the keyboard starts on the current choice, so Down then Enter picks the next", () => {
    const onChange = vi.fn();
    render(<Select aria-label="Category" value="fuel" onChange={onChange} options={OPTIONS} />);
    const trigger = screen.getByRole("combobox", { name: "Category" });
    // All in one go, with no render in between for an effect to catch up.
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("toll");
  });

  it("a named Select carries its value into a form", () => {
    const { container } = render(
      <form><Select name="category" defaultValue="fuel" aria-label="Category" options={OPTIONS} /></form>
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Parking" }));
    expect(new FormData(container.querySelector("form")).get("category")).toBe("parking");
  });
});
