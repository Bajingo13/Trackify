import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ photo: vi.fn() }));
vi.mock("../../services/fleet/driverService", () => ({
  getDriverPhoto: (...args) => state.photo(...args),
}));

import DriverFace from "./DriverFace";

describe("the driver's picture on Live Tracking", () => {
  // braces matter: a returned function would be run as a cleanup after each test
  beforeEach(() => { state.photo.mockReset(); });

  it("shows initials, and asks the server for nothing, when the driver has no picture", () => {
    const { container } = render(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto={false} />);
    expect(container.querySelector(".tk-driver-face")).toHaveTextContent("JD");
    expect(container.querySelector("img")).toBeNull();
    expect(state.photo).not.toHaveBeenCalled();
  });

  it("shows the picture the driver uploaded", async () => {
    state.photo.mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto version="t1" />);
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA"));
    expect(state.photo).toHaveBeenCalledWith(4, "t1");
  });

  it("fetches again when the driver saves a new picture, so the old one is not shown", async () => {
    state.photo.mockResolvedValueOnce("data:old").mockResolvedValueOnce("data:new");
    const { container, rerender } = render(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto version="t1" />);
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "data:old"));

    rerender(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto version="t2" />);
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "data:new"));
  });

  it("goes back to initials when the picture is removed", async () => {
    state.photo.mockResolvedValue("data:old");
    const { container, rerender } = render(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto version="t1" />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());

    rerender(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto={false} version="t2" />);
    await waitFor(() => expect(container.querySelector("img")).toBeNull());
    expect(container.querySelector(".tk-driver-face")).toHaveTextContent("JD");
  });

  it("keeps the initials when the picture cannot be read", async () => {
    state.photo.mockRejectedValue(new Error("forbidden"));
    const { container } = render(<DriverFace driverId={4} name="Juan Dela Cruz" hasPhoto version="t1" />);
    // let the rejected request settle, then check what is on screen
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(state.photo).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".tk-driver-face")).toHaveTextContent("JD");
  });
});
