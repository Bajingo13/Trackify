import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NetSign, { EXIT_MS, InlineSign } from "./NetSign";

describe("connection sign", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a short label, and the detail only when opened", () => {
    render(<NetSign icon="wifiOff" label="No Connection" detail="Your route still works." minimizable />);
    const toggle = screen.getByRole("button", { name: /No Connection/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Your route still works.")).toBeInTheDocument();
  });

  it("minimizes to its icon and comes back on a tap", () => {
    render(<NetSign icon="wifiOff" label="No Connection" minimizable />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No Connection. Show" }));
    expect(screen.getByRole("status")).toHaveTextContent("No Connection");
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
