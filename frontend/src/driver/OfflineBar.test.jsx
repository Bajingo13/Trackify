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

const net = vi.hoisted(() => ({ value: "online", listeners: new Set() }));
vi.mock("./netStatus", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (fn) => { net.listeners.add(fn); return () => net.listeners.delete(fn); };
  return { useNetStatus: () => useSyncExternalStore(subscribe, () => net.value) };
});
const setNet = (value) => act(() => { net.value = value; net.listeners.forEach((fn) => fn()); });

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
    net.value = "online";
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
    expect(screen.getByText(/1 location update saved on this phone/)).toBeInTheDocument();
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

    expect(screen.getByRole("alert")).toHaveTextContent("Not accepted");
    expect(screen.getByRole("alert")).toHaveTextContent("This trip is already closed.");
    expect(screen.getByRole("alert")).toHaveTextContent("It was not filed.");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await settle();
    expect(state.dismiss).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows No Connection while offline, and clears once the server answers", async () => {
    state.queue = { total: 0, pings: 0, records: 0 };
    net.value = "offline";
    render(<OfflineBar />);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("No Connection");
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();

    // unstable is still connected: the bar is for no internet at all
    await setNet("unstable");
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends saved work as soon as the connection is confirmed again", async () => {
    net.value = "offline";
    render(<OfflineBar />);
    await settle();
    state.flush.mockClear();

    await setNet("online");
    await settle();
    expect(state.flush).toHaveBeenCalledTimes(1);
  });
});
