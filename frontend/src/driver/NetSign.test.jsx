import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NetSign, { EXIT_MS, MORPH_MS, InlineSign } from "./NetSign";

describe("connection sign", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the label and detail directly without a dropdown", () => {
    const { container } = render(<NetSign icon="wifiOff" label="No Connection" detail="Your route still works." minimizable />);
    expect(screen.getByText("Your route still works.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /No Connection/ })).toBeNull();
    expect(container.querySelector(".dr-sign-caret")).toBeNull();
  });

  it("minimizes to its icon and comes back on a tap", () => {
    const { container, rerender } = render(<NetSign icon="wifiOff" label="No Connection" minimizable />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(container.querySelector(".dr-sign[data-minimizing]")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { vi.advanceTimersByTime(MORPH_MS); });
    expect(container.querySelector(".dr-sign-mini")).not.toBeNull();
    rerender(<NetSign icon="wifiOff" label="No Connection" detail="Still offline." minimizable />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No Connection. Show" }));
    expect(screen.getByRole("status")).toHaveTextContent("No Connection");
    expect(container.querySelector(".dr-sign[data-restoring]")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(MORPH_MS); });
    expect(container.querySelector(".dr-sign[data-restoring]")).toBeNull();
  });

  it("stays minimized across a page remount until its icon is clicked", () => {
    const key = "break:7:41";
    const storageKey = `trackify-notice-mini:${key}`;
    sessionStorage.removeItem(storageKey);
    const notice = <NetSign icon="clock" label="Time for a break" detail="Rest for 15 minutes." minimizable rememberKey={key} />;
    const first = render(notice);

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    act(() => { vi.advanceTimersByTime(MORPH_MS); });
    first.unmount();

    render(notice);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Time for a break. Show" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Time for a break. Show" }));
    expect(screen.getByRole("status")).toHaveTextContent("Time for a break");
    sessionStorage.removeItem(storageKey);
  });

  it("fades out before it leaves, reporting nothing while it does", () => {
    const { rerender, container } = render(<NetSign icon="wifiOff" label="No Connection" />);
    rerender(<NetSign show={false} icon="wifiOff" label="No Connection" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".dr-sign[data-leaving]")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(container.querySelector(".dr-sign")).toBeNull();
  });

  it("closes through onClose, and carries one action", () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    render(<NetSign icon="signalLow" label="Slow Connection" onClose={onClose} action={{ label: "Send now", onClick: onAction }} />);
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAction).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("has an inline form with the same label", () => {
    render(<InlineSign icon="wifiOff" label="No Connection">Sending this needs the internet.</InlineSign>);
    expect(screen.getByRole("note")).toHaveTextContent("No Connection · Sending this needs the internet.");
  });
});
