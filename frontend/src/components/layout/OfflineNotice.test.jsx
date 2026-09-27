import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OfflineNotice from "./OfflineNotice";

describe("staff console offline notice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is silent while online, warns when the connection drops, and clears when it returns", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineNotice />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status")).toHaveTextContent("You're offline.");

    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns straight away if the page opens offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing you save will reach Trackify");
  });
});
