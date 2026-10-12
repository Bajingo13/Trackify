import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTripsPage = vi.fn();
const getTripSummary = vi.fn();
vi.mock("../../services/operations/tripService", async () => {
  const actual = await vi.importActual("../../services/operations/tripService");
  return { ...actual, getTripsPage: (...a) => getTripsPage(...a), getTripSummary: (...a) => getTripSummary(...a) };
});

import useTripList, { PAGE_SIZE } from "./useTripList";

const trip = (id) => ({ id, ticketNo: `TT-${id}` });
const result = (ids, { page = 1, total = ids.length, totalPages = Math.ceil(total / PAGE_SIZE) } = {}) =>
  ({ rows: ids.map(trip), pagination: { page, limit: PAGE_SIZE, total, totalPages } });
const lastQuery = () => getTripsPage.mock.calls.at(-1)[0];

beforeEach(() => {
  getTripsPage.mockReset().mockResolvedValue(result([1, 2, 3]));
  getTripSummary.mockReset().mockResolvedValue({ counts: { in_transit: 4 }, total: 4, barangays: ["Sasa"] });
});

describe("useTripList", () => {
  it("loads the first page and the counts", async () => {
    const { result: r } = renderHook(() => useTripList());
    expect(r.current.loading).toBe(true);
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.rows.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(r.current.stats.inTransit).toBe(4);
    expect(r.current.barangays).toEqual(["Sasa"]);
    expect(lastQuery()).toMatchObject({ page: 1, limit: PAGE_SIZE, status: "all", search: "" });
  });

  it("asks for the next page when the page changes", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    act(() => r.current.setPage(3));
    await waitFor(() => expect(lastQuery().page).toBe(3));
  });

  it("goes back to page 1 when a filter changes", async () => {
    getTripsPage.mockResolvedValue(result([1], { total: 100 }));
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    act(() => r.current.setPage(4));
    await waitFor(() => expect(lastQuery().page).toBe(4));
    act(() => r.current.setFilter("status", "delivered"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1, status: "delivered" }));
    expect(r.current.page).toBe(1);
  });

  it("changing a filter to the value it already has asks nothing new", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    const calls = getTripsPage.mock.calls.length;
    act(() => r.current.setFilter("priority", "all"));
    await new Promise((res) => setTimeout(res, 30));
    expect(getTripsPage.mock.calls.length).toBe(calls);
  });

  it("waits for a pause in typing before searching", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    const calls = getTripsPage.mock.calls.length;
    act(() => r.current.setFilter("q", "a"));
    act(() => r.current.setFilter("q", "ac"));
    act(() => r.current.setFilter("q", "acm"));
    await new Promise((res) => setTimeout(res, 100));
    expect(getTripsPage.mock.calls.length).toBe(calls); // still typing: nothing sent
    await waitFor(() => expect(lastQuery().search).toBe("acm"), { timeout: 2000 });
    expect(getTripsPage.mock.calls.length).toBe(calls + 1); // one request for three keystrokes
  });

  it("abandons the request it no longer wants", async () => {
    const signals = [];
    getTripsPage.mockImplementation(({ signal }) => { signals.push(signal); return new Promise(() => {}); });
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(signals.length).toBe(1));
    act(() => r.current.setFilter("status", "draft"));
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("never lets a late answer overwrite the answer to the request that replaced it", async () => {
    let resolveFirst;
    getTripsPage
      .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValueOnce(result([9], { total: 1 }));
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(getTripsPage).toHaveBeenCalledTimes(1));
    act(() => r.current.setFilter("status", "delivered"));
    await waitFor(() => expect(r.current.rows.map((t) => t.id)).toEqual([9]));
    await act(async () => { resolveFirst(result([1, 2, 3])); });
    expect(r.current.rows.map((t) => t.id)).toEqual([9]);
  });

  it("steps back to the last real page when the page it asked for is past the end", async () => {
    // e.g. the last trips on page 3 were closed and filtered away
    getTripsPage.mockImplementation(async ({ page }) =>
      page > 2 ? result([], { page, total: 25, totalPages: 2 }) : result([page], { page, total: 25, totalPages: 2 }));
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    act(() => r.current.setPage(3));
    await waitFor(() => expect(r.current.page).toBe(2));
    await waitFor(() => expect(r.current.rows.map((t) => t.id)).toEqual([2]));
  });

  it("shows an empty list, not a loop, when nothing matches at all", async () => {
    getTripsPage.mockResolvedValue(result([], { total: 0, totalPages: 0 }));
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.rows).toEqual([]);
    expect(r.current.page).toBe(1);
    expect(getTripsPage).toHaveBeenCalledTimes(1);
  });

  it("reports a failed load and stops showing the spinner", async () => {
    const onError = vi.fn();
    getTripsPage.mockRejectedValue(new Error("Server down"));
    const { result: r } = renderHook(() => useTripList({ onError }));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Server down" }));
  });

  it("does not report a request it cancelled itself as a failure", async () => {
    const onError = vi.fn();
    getTripsPage.mockImplementation(({ signal }) => new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const { result: r, unmount } = renderHook(() => useTripList({ onError }));
    await waitFor(() => expect(getTripsPage).toHaveBeenCalled());
    act(() => r.current.setFilter("status", "draft"));
    unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the counts if only the summary fails", async () => {
    getTripSummary.mockRejectedValue(new Error("nope"));
    const onError = vi.fn();
    const { result: r } = renderHook(() => useTripList({ onError }));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.rows).toHaveLength(3);
    expect(onError).not.toHaveBeenCalled();
    expect(r.current.stats.total).toBe(0);
  });

  it("reload fetches the page and the counts again", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    const [pages, sums] = [getTripsPage.mock.calls.length, getTripSummary.mock.calls.length];
    act(() => r.current.reload());
    await waitFor(() => expect(getTripsPage.mock.calls.length).toBe(pages + 1));
    expect(getTripSummary.mock.calls.length).toBe(sums + 1);
  });

  it("knows when a detail filter is active, and clearing keeps the status tab and the search", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.detailFiltersActive).toBe(false);
    act(() => { r.current.setFilter("status", "approved"); r.current.setFilter("priority", "high"); r.current.setFilter("q", "acme"); });
    expect(r.current.detailFiltersActive).toBe(true);
    act(() => r.current.clearFilters());
    expect(r.current.filters).toMatchObject({ status: "approved", q: "acme", priority: "all", barangay: "all", from: "", to: "" });
    expect(r.current.detailFiltersActive).toBe(false);
  });

  it("exposes the exact query in use, so an export can match the list", async () => {
    const { result: r } = renderHook(() => useTripList());
    await waitFor(() => expect(r.current.loading).toBe(false));
    act(() => { r.current.setFilter("barangay", "Sasa"); r.current.setFilter("from", "2026-10-01"); });
    await waitFor(() => expect(r.current.query).toMatchObject({ barangay: "Sasa", from: "2026-10-01", page: 1 }));
  });
});
