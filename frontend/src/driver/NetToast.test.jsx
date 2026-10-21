import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ value: "online", listeners: new Set() }));
vi.mock("./netStatus", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (fn) => { net.listeners.add(fn); return () => net.listeners.delete(fn); };
  return { useNetStatus: () => useSyncExternalStore(subscribe, () => net.value) };
});
const setNet = (value) => act(() => { net.value = value; net.listeners.forEach((fn) => fn()); });

import NetToast, { QUIET_MS } from "./NetToast";

describe("slow connection notice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    net.value = "online";
  });
  afterEach(() => vi.useRealTimers());

  it("pops up when the link turns unstable, then goes away by itself", () => {
    render(<NetToast />);
    expect(screen.queryByRole("status")).toBeNull();
    setNet("unstable");
    expect(screen.getByRole("status")).toHaveTextContent("Slow Connection");
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not repeat while the link stays slow, or on a quick flap", () => {
    render(<NetToast />);
    setNet("unstable");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();

    setNet("unstable"); // unchanged: no new notice
    expect(screen.queryByRole("status")).toBeNull();

    setNet("online");
    setNet("unstable"); // flapping within two minutes
    expect(screen.queryByRole("status")).toBeNull();

    setNet("online");
    act(() => { vi.advanceTimersByTime(QUIET_MS); });
    setNet("unstable"); // a new episode, later on
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stays quiet when the phone is fully offline (the bar says that)", () => {
    render(<NetToast />);
    setNet("offline");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
