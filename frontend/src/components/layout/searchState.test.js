import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { closeSearch, openSearch, useSearchOpen } from "./searchState";

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
