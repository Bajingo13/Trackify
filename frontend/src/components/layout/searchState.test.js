import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { closeSearch, isSearchShortcut, openSearch, shortcutLabel, useSearchOpen } from "./searchState";

describe("search palette state", () => {
  it("opens, stays open when asked again, and closes", () => {
    const { result } = renderHook(() => useSearchOpen());
    expect(result.current).toBe(false);
    act(() => { openSearch(); openSearch(); });
    expect(result.current).toBe(true);
    act(() => closeSearch());
    expect(result.current).toBe(false);
  });
  it("survives the component that shows it being rebuilt", () => {
    act(() => openSearch());
    const again = renderHook(() => useSearchOpen());
    expect(again.result.current).toBe(true);
    act(() => closeSearch());
  });
});

describe("the search shortcut", () => {
  const key = (over) => ({ key: "k", ctrlKey: true, ...over });
  it("is Ctrl or ⌘ plus K", () => {
    expect(isSearchShortcut(key())).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: false, metaKey: true, key: "K" }))).toBe(true);
  });
  it("leaves other combinations alone", () => {
    expect(isSearchShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(key({ key: "j" }))).toBe(false);
    expect(isSearchShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ altKey: true }))).toBe(false);
    expect(isSearchShortcut({ ctrlKey: true })).toBe(false);
  });
  it("ignores auto-repeat and keys something else already handled", () => {
    expect(isSearchShortcut(key({ repeat: true }))).toBe(false);
    expect(isSearchShortcut(key({ defaultPrevented: true }))).toBe(false);
  });
  it("leaves Ctrl+K to a rich-text editor", () => {
    expect(isSearchShortcut(key({ target: { isContentEditable: true } }))).toBe(false);
  });
});

describe("shortcutLabel", () => {
  it("shows ⌘K on Apple platforms and Ctrl+K elsewhere", () => {
    expect(shortcutLabel("MacIntel")).toBe("⌘K");
    expect(shortcutLabel("iPhone")).toBe("⌘K");
    expect(shortcutLabel("Win32")).toBe("Ctrl+K");
    expect(shortcutLabel("")).toBe("Ctrl+K");
  });
});
