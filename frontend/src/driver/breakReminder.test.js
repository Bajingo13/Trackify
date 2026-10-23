import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { breakState, drivenLabel, DRIVE_LIMIT_MS, readBreak, SNOOZE_MS, useBreakReminder, writeBreak } from "./breakReminder";

const T0 = new Date(2026, 9, 23, 6, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

describe("when a break is due", () => {
  it("not before four hours on the road, and from then on", () => {
    expect(breakState({ since: T0 }, T0 + DRIVE_LIMIT_MS - 60000).due).toBe(false);
    expect(breakState({ since: T0 }, T0 + DRIVE_LIMIT_MS).due).toBe(true);
  });

  it("not while snoozed", () => {
    const clock = { since: T0, snoozeUntil: T0 + 5 * HOUR };
    expect(breakState(clock, T0 + 4.5 * HOUR).due).toBe(false);
    expect(breakState(clock, T0 + 5 * HOUR).due).toBe(true);
  });

  it("never without a clock", () => {
    expect(breakState(null, T0)).toEqual({ due: false, drivenMs: 0 });
  });

  it("says the time the way a person would", () => {
    expect(drivenLabel(4 * HOUR)).toBe("4 h");
    expect(drivenLabel(4 * HOUR + 12 * 60000)).toBe("4 h 12 min");
  });

  it("survives storage that is junk or blocked", () => {
    localStorage.setItem("trackify-driver-break:7:41", "{nope");
    expect(readBreak(7, 41)).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => writeBreak(7, 41, { since: T0 })).not.toThrow();
    setItem.mockRestore();
  });
});

describe("the reminder on a run", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  it("starts the clock when the run is first seen on the road, and is due four hours later", () => {
    const { result } = renderHook(() => useBreakReminder(7, 41, true, false));
    expect(readBreak(7, 41)).toMatchObject({ since: T0 });
    expect(result.current.due).toBe(false);

    advance(DRIVE_LIMIT_MS);
    expect(result.current.due).toBe(true);
    expect(drivenLabel(result.current.drivenMs)).toBe("4 h");
  });

  it("keeps counting across a reopen of the app, rather than starting over", () => {
    const first = renderHook(() => useBreakReminder(7, 41, true, false));
    advance(3 * HOUR);
    first.unmount();

    const { result } = renderHook(() => useBreakReminder(7, 41, true, false));
    advance(HOUR);
    expect(result.current.due).toBe(true);
  });

  it("starts over when the driver has rested", () => {
    const { result } = renderHook(() => useBreakReminder(7, 41, true, false));
    advance(DRIVE_LIMIT_MS);
    act(() => result.current.rested());
    expect(result.current.due).toBe(false);

    advance(DRIVE_LIMIT_MS - 60000);
    expect(result.current.due).toBe(false);
    advance(60000);
    expect(result.current.due).toBe(true);
  });

  it("Later puts it away for half an hour, then asks again", () => {
    const { result } = renderHook(() => useBreakReminder(7, 41, true, false));
    advance(DRIVE_LIMIT_MS);
    act(() => result.current.later());
    expect(result.current.due).toBe(false);

    advance(SNOOZE_MS - 60000);
    expect(result.current.due).toBe(false);
    advance(60000);
    expect(result.current.due).toBe(true);
  });

  it("counts an approved pause as rest, and counts again from the resume", () => {
    let resting = false;
    const { result, rerender } = renderHook(() => useBreakReminder(7, 41, true, resting));
    advance(3 * HOUR);

    resting = true;
    rerender();
    advance(2 * HOUR);
    expect(result.current.due).toBe(false);

    resting = false;
    rerender();
    advance(3 * HOUR);
    expect(result.current.due).toBe(false);
    advance(HOUR);
    expect(result.current.due).toBe(true);
  });

  it("does nothing for a run that is not on the road", () => {
    const { result } = renderHook(() => useBreakReminder(7, 41, false, false));
    advance(10 * HOUR);
    expect(result.current.due).toBe(false);
    expect(readBreak(7, 41)).toBeNull();
  });

  it("keeps each driver's and each run's clock apart", () => {
    renderHook(() => useBreakReminder(7, 41, true, false));
    expect(readBreak(7, 42)).toBeNull();
    expect(readBreak(8, 41)).toBeNull();
  });
});
