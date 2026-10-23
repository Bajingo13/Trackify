import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({ tap: vi.fn() }));

import { readTextSize, screenTextSize, setTextSize, useTextSize } from "./textSize";
import ProfileTextSize from "./ProfileTextSize";

beforeEach(() => localStorage.clear());

describe("the text size setting", () => {
  it("is off until switched on, and keeps the choice on the phone", () => {
    expect(readTextSize()).toBe("normal");
    setTextSize("large");
    expect(readTextSize()).toBe("large");
    setTextSize("normal");
    expect(readTextSize()).toBe("normal");
    expect(localStorage.getItem("trackify-driver-text-size")).toBeNull();
  });

  it("reads a 'Larger' saved by the earlier three-step version as on", () => {
    localStorage.setItem("trackify-driver-text-size", "larger");
    expect(readTextSize()).toBe("large");
  });

  it("treats anything unknown as Normal", () => {
    localStorage.setItem("trackify-driver-text-size", "gigantic");
    expect(readTextSize()).toBe("normal");
    setTextSize("gigantic");
    expect(readTextSize()).toBe("normal");
  });

  it("still works when storage is blocked", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTextSize()).toBe("normal");
    expect(() => setTextSize("large")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it("is followed everywhere in the app the moment it changes", () => {
    const { result } = renderHook(() => useTextSize());
    expect(result.current).toBe("normal");
    act(() => setTextSize("large"));
    expect(result.current).toBe("large");
  });
});

describe("which screens it enlarges", () => {
  it("the reading screens, at the chosen size", () => {
    expect(screenTextSize(false, "large")).toBe("large");
    expect(screenTextSize(false, "normal")).toBeUndefined();
  });

  it("never a run, and so never the route map, even when switched on", () => {
    expect(screenTextSize(true, "large")).toBeUndefined();
  });

  it("is applied to the screen container only, never the whole app", () => {
    const css = readFileSync(resolve(process.cwd(), "src/driver/driver.css"), "utf8");
    const zoomRules = css.split("\n").map((line) => line.trim()).filter((line) => /\bzoom\s*:/.test(line));
    expect(zoomRules).toEqual(['.dr-screen[data-textsize="large"] { zoom: 1.15; }']);

    const app = readFileSync(resolve(process.cwd(), "src/driver/DriverApp.jsx"), "utf8");
    expect(app).toMatch(/data-textsize=\{screenTextSize\(inTrip, textSize\)\}/);
    expect(app.match(/data-textsize=/g)).toHaveLength(1);
  });
});

describe("Profile → Larger text", () => {
  it("is one switch: off to begin with, on with a tap, and off again", () => {
    render(<ProfileTextSize />);
    const toggle = screen.getByRole("switch", { name: "Larger text" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(readTextSize()).toBe("large");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(readTextSize()).toBe("normal");
  });

  it("shows on when it was switched on before", () => {
    setTextSize("large");
    render(<ProfileTextSize />);
    expect(screen.getByRole("switch", { name: "Larger text" })).toHaveAttribute("aria-checked", "true");
  });

  it("says which screens it changes, and that the route map does not", () => {
    render(<ProfileTextSize />);
    expect(screen.getByText(/Today, History, Claims, Profile and Help/)).toBeInTheDocument();
    expect(screen.getByText(/route map stays as it is/)).toBeInTheDocument();
  });
});
