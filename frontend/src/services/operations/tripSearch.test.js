import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../apiClient", () => ({ get: (...a) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));

import { searchTrips } from "./tripService";

beforeEach(() => get.mockReset());

describe("searchTrips", () => {
  it("asks the lean search endpoint, encoded, and passes the abort signal on", async () => {
    get.mockResolvedValue({ data: [] });
    const signal = new AbortController().signal;
    await searchTrips("TT 50%&x", { limit: 5, signal });
    expect(get).toHaveBeenCalledWith("/operations/trips/search?q=TT+50%25%26x&limit=5", { signal });
  });

  it("shapes rows the way the palette expects, with a dash for a trip with no customer", async () => {
    get.mockResolvedValue({
      data: [
        { trip_ticket_id: 4, ticket_no: "TT-0004", customer_name: "Acme", origin: "A", destination: "B" },
        { trip_ticket_id: 5, ticket_no: "TT-0005", customer_name: null, origin: "C", destination: "D" },
      ],
    });
    expect(await searchTrips("TT")).toEqual([
      { id: 4, ticketNo: "TT-0004", customer: "Acme", origin: "A", destination: "B" },
      { id: 5, ticketNo: "TT-0005", customer: "—", origin: "C", destination: "D" },
    ]);
  });

  it("tolerates an empty response", async () => {
    get.mockResolvedValue({});
    expect(await searchTrips("TT")).toEqual([]);
  });
});
