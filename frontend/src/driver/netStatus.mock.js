import { act } from "@testing-library/react";
import { useSyncExternalStore } from "react";

/**
 * netStatus for component tests: no probe, no timers, online unless a test
 * says otherwise. Use it with
 *
 *   vi.mock("./netStatus", () => import("./netStatus.mock"));
 *   import { setNet } from "./netStatus";
 *
 * Without it the real probe runs against jsdom, fails, and every send button
 * in the screen under test turns itself off.
 */
let state = "online";
const listeners = new Set();

export const getNetState = () => state;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useNetStatus = () => useSyncExternalStore(subscribe, getNetState, getNetState);
export const reportSuccess = () => {};
export const reportFailure = () => {};
export const checkNow = () => Promise.resolve(state);
export const resetNetStatus = (next = "online") => { state = next; };

/** Change the state as a test, re-rendering whatever is subscribed. */
export function setNet(next) {
  act(() => {
    state = next;
    listeners.forEach((fn) => fn());
  });
}
