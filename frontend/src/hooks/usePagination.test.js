import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { pageWindow, usePagination } from "./usePagination";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("paging a list that is all in memory", () => {
  beforeEach(() => localStorage.clear());

  it("shows the first page of ten and says which rows those are", () => {
    const { result } = renderHook(() => usePagination(rows(25)));
    expect(result.current.pageItems.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.current).toMatchObject({ page: 1, pages: 3, total: 25, from: 1, to: 10, pageSize: 10 });
  });

  it("moves through the rest, and the last page holds what is left", () => {
    const { result } = renderHook(() => usePagination(rows(25)));
    act(() => result.current.setPage(3));
    expect(result.current.pageItems.map((r) => r.id)).toEqual([21, 22, 23, 24, 25]);
    expect(result.current).toMatchObject({ from: 21, to: 25 });
  });

  it("will not go past either end", () => {
    const { result } = renderHook(() => usePagination(rows(25)));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(-4));
    expect(result.current.page).toBe(1);
  });

  it("a different page size starts again at page 1, and only the offered sizes are accepted", () => {
    const { result } = renderHook(() => usePagination(rows(120)));
    act(() => result.current.setPage(4));
    act(() => result.current.setPageSize(25));
    expect(result.current).toMatchObject({ page: 1, pageSize: 25, pages: 5 });
    act(() => result.current.setPageSize(7));
    expect(result.current.pageSize).toBe(25);
  });

  it("stays inside the list when it shrinks under the reader", () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items), { initialProps: { items: rows(25) } });
    act(() => result.current.setPage(3));
    rerender({ items: rows(20) });
    expect(result.current).toMatchObject({ page: 2, pages: 2 });
    rerender({ items: [] });
    expect(result.current).toMatchObject({ page: 1, pages: 1, total: 0, from: 0, to: 0, pageItems: [] });
  });

  it("goes back to page 1 when the search or filter changes", () => {
    const { result, rerender } = renderHook(({ key }) => usePagination(rows(40), { resetKey: key }), { initialProps: { key: "a" } });
    act(() => result.current.setPage(3));
    rerender({ key: "a" });
    expect(result.current.page).toBe(3);
    rerender({ key: "b" });
    expect(result.current.page).toBe(1);
  });

  it("remembers the chosen size for next time, per list", () => {
    const first = renderHook(() => usePagination(rows(80), { storeKey: "exceptions" }));
    act(() => first.result.current.setPageSize(50));
    first.unmount();
    expect(renderHook(() => usePagination(rows(80), { storeKey: "exceptions" })).result.current.pageSize).toBe(50);
    expect(renderHook(() => usePagination(rows(80), { storeKey: "other" })).result.current.pageSize).toBe(10);
  });

  it("ignores a stored size that is no longer on offer", () => {
    localStorage.setItem("tk_pagesize_x", "13");
    expect(renderHook(() => usePagination(rows(80), { storeKey: "x" })).result.current.pageSize).toBe(10);
  });
});

describe("which page numbers to show", () => {
  it("shows all of them when there are few", () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps the ends, the current page and its neighbours, and marks the gaps", () => {
    expect(pageWindow(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, 4, "…", 12]);
    expect(pageWindow(12, 12)).toEqual([1, "…", 9, 10, 11, 12]);
  });
});
