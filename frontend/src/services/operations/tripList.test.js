import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../apiClient", () => ({ get: (...a) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));

import {
  getTripsPage, getAllTrips, getAllTripPages, getTripSummary, getTripStats,
  groupStatusCounts, MAX_TRIPS_PER_REQUEST,
} from "./tripService";

const row = (id) => ({ trip_ticket_id: id, ticket_no: `TT-${id}`, status: "draft", customer_name: "Acme", origin: "A", destination: "B" });
const page = (ids, { page: p = 1, limit = 100, total = ids.length, totalPages = 1 } = {}) =>
  ({ data: ids.map(row), pagination: { page: p, limit, total, totalPages } });
const urlOf = (call = get.mock.calls.at(-1)) => new URL(call[0], "http://x");

beforeEach(() => get.mockReset());

describe("getTripsPage — what is asked of the server", () => {
  it("sends only the filters that are set", async () => {
    get.mockResolvedValue(page([]));
    await getTripsPage({ status: "in_transit", priority: "all", barangay: "all", search: "  ", page: 2, limit: 20 });
    const q = urlOf().searchParams;
    expect(urlOf().pathname).toBe("/operations/trips");
    expect(q.get("status")).toBe("in_transit");
    expect(q.get("page")).toBe("2");
    expect(q.get("limit")).toBe("20");
    expect(q.has("priority")).toBe(false);   // "all" is no filter
    expect(q.has("barangay")).toBe(false);
    expect(q.has("search")).toBe(false);     // whitespace is no search
  });

  it("sends every filter when they are all set, trimmed", async () => {
    get.mockResolvedValue(page([]));
    await getTripsPage({ status: "approved,assigned", priority: "high", barangay: " Sasa ", search: " acme ", from: "2026-10-01", to: "2026-10-09" });
    const q = urlOf().searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      status: "approved,assigned", priority: "high", barangay: "Sasa", search: "acme", from: "2026-10-01", to: "2026-10-09", limit: "20",
    });
  });

  it("never asks for more than the server returns", async () => {
    get.mockResolvedValue(page([]));
    await getTripsPage({ limit: 1000 });
    expect(urlOf().searchParams.get("limit")).toBe(String(MAX_TRIPS_PER_REQUEST));
    await getTripsPage({ limit: 0 });
    expect(urlOf().searchParams.get("limit")).toBe("20");
    await getTripsPage({ limit: -5 });
    expect(urlOf().searchParams.get("limit")).toBe("1");
  });

  it("passes the abort signal on", async () => {
    get.mockResolvedValue(page([]));
    const signal = new AbortController().signal;
    await getTripsPage({ signal });
    expect(get.mock.calls[0][1]).toEqual({ signal });
  });

  it("returns mapped rows with the server's pagination as numbers", async () => {
    get.mockResolvedValue({ data: [row(7)], pagination: { page: "2", limit: "20", total: "134", totalPages: "7" } });
    const r = await getTripsPage({ page: 2 });
    expect(r.rows[0]).toMatchObject({ id: 7, ticketNo: "TT-7", customer: "Acme" });
    expect(r.pagination).toEqual({ page: 2, limit: 20, total: 134, totalPages: 7 });
  });

  it("copes with a response that has no pagination or data", async () => {
    get.mockResolvedValue({});
    expect(await getTripsPage()).toEqual({ rows: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } });
  });
});

describe("getAllTrips", () => {
  it("is one request's worth, as a plain array", async () => {
    get.mockResolvedValue(page([1, 2]));
    const rows = await getAllTrips({ limit: 500 });
    expect(rows).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
    expect(urlOf().searchParams.get("limit")).toBe("100");
  });
});

describe("getAllTripPages — the export", () => {
  it("follows every page until the total is reached", async () => {
    get
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => i + 1), { page: 1, total: 230, totalPages: 3 }))
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => i + 101), { page: 2, total: 230, totalPages: 3 }))
      .mockResolvedValueOnce(page(Array.from({ length: 30 }, (_, i) => i + 201), { page: 3, total: 230, totalPages: 3 }));
    const progress = vi.fn();
    const out = await getAllTripPages({ status: "draft" }, { onProgress: progress });
    expect(out.rows).toHaveLength(230);
    expect(out.total).toBe(230);
    expect(out.truncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.map((c) => urlOf(c).searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(get.mock.calls.every((c) => urlOf(c).searchParams.get("status") === "draft")).toBe(true);
    expect(progress.mock.calls.map((c) => c[0])).toEqual([100, 200, 230]);
  });

  it("stops at the cap and says it did", async () => {
    get.mockImplementation(async (url) => {
      const p = Number(new URL(url, "http://x").searchParams.get("page"));
      return page(Array.from({ length: 100 }, (_, i) => (p - 1) * 100 + i + 1), { page: p, total: 1000, totalPages: 10 });
    });
    const out = await getAllTripPages({}, { max: 250 });
    expect(out.rows).toHaveLength(250);
    expect(out.total).toBe(1000);
    expect(out.truncated).toBe(true);
    expect(get.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("returns nothing, without looping, when nothing matches", async () => {
    get.mockResolvedValue(page([], { total: 0, totalPages: 0 }));
    const out = await getAllTripPages({});
    expect(out).toEqual({ rows: [], total: 0, truncated: false });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("cannot loop forever if the server keeps returning pages", async () => {
    get.mockResolvedValue(page([1, 2, 3], { total: 999999, totalPages: 1 }));
    await getAllTripPages({});
    expect(get).toHaveBeenCalledTimes(1); // totalPages says there is no page 2
  });
});

describe("the counts", () => {
  it("groups the server's per-status counts the way the screens show them", () => {
    const g = groupStatusCounts({
      draft: 3, validated: 1, for_validation: 2, for_approval: 4, approved: 5, assigned: 1, accepted: 1, released: 2,
      in_transit: 6, delivered: 7, operationally_closed: 9, rejected: 1, cancelled: 2,
    }, 43);
    expect(g).toEqual({
      total: 43, draft: 3, pending: 7, approved: 9, inTransit: 6, delivered: 7, closed: 9, rejected: 1, cancelled: 2,
    });
  });

  it("treats a status the server did not report as zero", () => {
    expect(groupStatusCounts({}, 0)).toMatchObject({ total: 0, pending: 0, inTransit: 0 });
    expect(groupStatusCounts(undefined, undefined).total).toBe(0);
  });

  it("getTripSummary reads the summary endpoint", async () => {
    get.mockResolvedValue({ data: { total: 5, counts: { draft: 5 }, barangays: ["Sasa"] } });
    expect(await getTripSummary()).toEqual({ total: 5, counts: { draft: 5 }, barangays: ["Sasa"] });
    expect(urlOf().pathname).toBe("/operations/trips/summary");
  });

  it("getTripSummary tolerates a missing body", async () => {
    get.mockResolvedValue({});
    expect(await getTripSummary()).toEqual({ total: 0, counts: {}, barangays: [] });
  });

  it("getTripStats downloads no trips — one summary request", async () => {
    get.mockResolvedValue({ data: { total: 150, counts: { in_transit: 120, delivered: 30 }, barangays: [] } });
    const s = await getTripStats();
    expect(get).toHaveBeenCalledTimes(1);
    expect(urlOf().pathname).toBe("/operations/trips/summary");
    expect(s).toMatchObject({ total: 150, inTransit: 120, delivered: 30 }); // past the old 100-row ceiling
  });
});
