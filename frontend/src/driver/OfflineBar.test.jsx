import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queue: { total: 1, pings: 1, records: 0 },
  listener: null,
  flush: vi.fn(),
  refused: [],
  dismiss: vi.fn(),
}));

vi.mock("./offlineQueue", () => ({
  isOnline: () => true,
  onQueueChange: (listener) => {
    state.listener = listener;
    return () => { state.listener = null; };
  },
  pendingCount: () => Promise.resolve({ ...state.queue }),
  refusedWork: () => [...state.refused],
  dismissRefused: (...args) => {
    state.dismiss(...args);
    state.refused = [];
    state.listener?.();
  },
}));

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  flushOutbox: (...args) => state.flush(...args),
}));

import OfflineBar from "./OfflineBar";

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("driver outbox status", () => {
  beforeEach(() => {
    state.queue = { total: 1, pings: 1, records: 0 };
    state.listener = null;
    state.refused = [];
    state.dismiss.mockReset();
    state.flush.mockReset().mockResolvedValue({ sent: 0, dropped: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a ping-only backlog and offers a manual retry", async () => {
    render(<OfflineBar />);
    await settle();

    // A backend outage can queue GPS while navigator.onLine stays true. Hiding
    // ping-only work would tell the driver dispatch is current when it is not.
    expect(screen.getByText("1 location update saved on this phone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send now" })).toBeInTheDocument();
  });

  it("retries a server-only outage with bounded exponential backoff", async () => {
    vi.useFakeTimers();
    render(<OfflineBar />);
    await settle();
    expect(state.flush).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(state.flush).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(state.flush).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state.flush).toHaveBeenCalledTimes(3);
  });

  it("tells the driver when saved work was refused, even with nothing left to send", async () => {
    state.queue = { total: 0, pings: 0, records: 0 };
    state.refused = [{ kind: "expense", queuedAt: Date.now(), reason: "This trip is already closed." }];
    render(<OfflineBar />);
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("A saved expense was not accepted");
    expect(screen.getByRole("alert")).toHaveTextContent("This trip is already closed.");
    expect(screen.getByRole("alert")).toHaveTextContent("It was not filed.");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await settle();
    expect(state.dismiss).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
