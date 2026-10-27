import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../services/publicTrackService", () => ({ getPublicTracking: (...a) => state.get(...a) }));

import TrackPage from "./TrackPage";

const view = (extra = {}) => ({
  company: "Astrea Freight", customer: "Mercury Drug", tripNo: "TT-2026-000031",
  origin: "Davao City", destination: "Tagum City", stage: "on_the_way", statusLabel: "On the way",
  scheduledArrival: "2026-10-14T15:00:00", departedAt: "2026-10-14T08:00:00", arrivedAt: null,
  pause: null, pastPauses: [], asOf: "2026-10-14T09:00:00", ...extra,
});

const show = () =>
  render(
    <MemoryRouter initialEntries={["/track/abcdefghijklmnopqrstuvwx"]}>
      <Routes><Route path="/track/:token" element={<TrackPage />} /></Routes>
    </MemoryRouter>,
  );

describe("the customer's tracking page", () => {
  beforeEach(() => state.get.mockReset());

  it("shows the delivery, where it is going, and how far along it is", async () => {
    state.get.mockResolvedValue({ view: view() });
    show();

    expect(await screen.findByRole("heading", { name: "Delivery TT-2026-000031" })).toBeInTheDocument();
    expect(screen.getByText("Astrea Freight")).toBeInTheDocument();
    expect(screen.getByText("Davao City")).toBeInTheDocument();
    expect(screen.getByText("Tagum City")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("On the way");
    const steps = screen.getByRole("list", { name: "Progress" });
    expect(within(steps).getByText("On the way").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByText("Scheduled").closest("li")).toHaveAttribute("data-state", "done");
    expect(within(steps).getByText("Delivered").closest("li")).toHaveAttribute("data-state", "next");
    expect(state.get).toHaveBeenCalledWith("abcdefghijklmnopqrstuvwx", expect.anything());
  });

  it("explains a stop in the office's words, and still shows the delivery as on the road", async () => {
    state.get.mockResolvedValue({
      view: view({
        stage: "paused", statusLabel: "Paused",
        pause: { reason: "breakdown", reasonLabel: "Vehicle breakdown", message: "A mechanic is on the way.", startedAt: "2026-10-14T08:30:00", active: true },
      }),
    });
    show();

    const why = await screen.findByRole("region", { name: "Why the delivery has stopped" });
    expect(within(why).getByText("Vehicle breakdown")).toBeInTheDocument();
    expect(within(why).getByText("A mechanic is on the way.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Paused");
    expect(within(screen.getByRole("list", { name: "Progress" })).getByText("On the way").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("lists earlier stops once the delivery is moving again", async () => {
    state.get.mockResolvedValue({
      view: view({ pastPauses: [{ reasonLabel: "Delivery delay", startedAt: "2026-10-14T08:30:00", endedAt: "2026-10-14T09:10:00" }] }),
    });
    show();
    const past = await screen.findByRole("region", { name: "Earlier stops" });
    expect(within(past).getByText("Delivery delay")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Why the delivery has stopped" })).toBeNull();
  });

  it("shows a finished delivery as delivered, with when", async () => {
    state.get.mockResolvedValue({ view: view({ stage: "delivered", statusLabel: "Delivered", arrivedAt: "2026-10-14T14:20:00" }) });
    show();
    expect(await screen.findByRole("status")).toHaveTextContent("Delivered");
    expect(screen.getAllByText("Delivered").length).toBeGreaterThan(1);
    expect(screen.queryByText("Expected")).toBeNull();
  });

  it("shows a called-off delivery without a progress bar", async () => {
    state.get.mockResolvedValue({ view: view({ stage: "cancelled", statusLabel: "Cancelled" }) });
    show();
    expect(await screen.findByRole("status")).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("list", { name: "Progress" })).toBeNull();
  });

  it("shows a load that came back as not delivered, without a progress bar or an expected time", async () => {
    state.get.mockResolvedValue({ view: view({ stage: "not_delivered", statusLabel: "Not delivered", scheduledArrival: "2026-10-14T15:00:00" }) });
    show();
    expect(await screen.findByRole("status")).toHaveTextContent("Not delivered");
    expect(screen.queryByRole("list", { name: "Progress" })).toBeNull();
    expect(screen.queryByText("Expected")).toBeNull();
    expect(screen.queryByText("Delivered")).toBeNull();
  });

  it("says a link that no longer works is gone, and tells them who to ask", async () => {
    state.get.mockResolvedValue({ gone: true });
    show();
    expect(await screen.findByRole("heading", { name: "This tracking link is no longer available" })).toBeInTheDocument();
    expect(screen.getByText(/ask the company/)).toBeInTheDocument();
  });

  it("offers to try again when the first load fails", async () => {
    state.get.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue({ view: view() });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(await screen.findByRole("heading", { name: /Delivery TT-/ })).toBeInTheDocument();
  });

  it("keeps the last update on screen when a refresh fails, and says so", async () => {
    state.get.mockResolvedValue({ view: view() });
    show();
    expect(await screen.findByRole("heading", { name: /Delivery TT-/ })).toBeInTheDocument();

    // the network goes away after the page has loaded; coming back to the tab asks again
    state.get.mockRejectedValueOnce(new Error("Network down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last update");
    expect(screen.getByRole("heading", { name: /Delivery TT-/ })).toBeInTheDocument();
  });

  it("keeps the page out of search results while it is open", async () => {
    state.get.mockResolvedValue({ view: view() });
    const { unmount } = show();
    await screen.findByRole("heading", { name: /Delivery TT-/ });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("never shows the driver, their notes, or where the truck is", async () => {
    state.get.mockResolvedValue({ view: view({ stage: "paused", statusLabel: "Paused", pause: { reasonLabel: "Delivery delay", message: "Traffic.", startedAt: null, active: true } }) });
    const { container } = show();
    await screen.findByRole("heading", { name: /Delivery TT-/ });
    expect(container.textContent).not.toMatch(/driver|plate|gps|latitude/i);
  });
});
