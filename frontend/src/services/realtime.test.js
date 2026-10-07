import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("./apiClient", () => ({
  post: vi.fn(() => Promise.resolve({ data: { ticket: "t" } })),
}));
vi.mock("./apiOrigin", () => ({ API_ORIGIN: "http://localhost:5000" }));

const sockets = [];
class FakeSocket {
  constructor() { sockets.push(this); }
  close() { this.onclose?.(); }
}

describe("useRealtime onReconnect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    sockets.length = 0;
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connected(onReconnect) {
    const { useRealtime } = await import("./realtime");
    const view = renderHook(() => useRealtime(() => {}, () => {}, onReconnect));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    return view;
  }

  it("does not fire on the first connect", async () => {
    const onReconnect = vi.fn();
    await connected(onReconnect);
    act(() => sockets[0].onopen());
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("fires once when the socket opens again after a drop", async () => {
    const onReconnect = vi.fn();
    await connected(onReconnect);
    act(() => sockets[0].onopen());
    act(() => sockets[0].onclose());
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(sockets).toHaveLength(2);
    act(() => sockets[1].onopen());
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
